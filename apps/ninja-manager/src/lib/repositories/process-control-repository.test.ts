import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createDatabaseClient, type DatabaseClient } from "@/lib/db/client";
import { migrateDatabase } from "@/lib/db/migrate";
import { auditEvidenceHash } from "@/lib/domain/audit-evidence";
import {
  createDeliveredProcessControlCommand,
  processControlCommandSchema,
  processQuitRuntimeStateDigest,
  type ProcessControlAcknowledgement,
  type ProcessQuitSafetySummary,
} from "@/lib/domain/process-control-contracts";
import { hashCanonicalPayload } from "@/lib/domain/runtime-contracts";
import type { AuthenticatedUser } from "@/lib/domain/types";
import type { AgentIdentity } from "@/lib/repositories/runtime-repository";
import {
  ProcessControlRepository,
  type LeasedProcessControlCommand,
} from "./process-control-repository";

const organizationId = "10000000-0000-4000-8000-000000000001";
const otherOrganizationId = "10000000-0000-4000-8000-000000000002";
const staffId = "20000000-0000-4000-8000-000000000001";
const otherStaffId = "20000000-0000-4000-8000-000000000002";
const clientId = "20000000-0000-4000-8000-000000000003";
const clientRecordId = "21000000-0000-4000-8000-000000000003";
const environmentId = "22000000-0000-4000-8000-000000000003";
const agentId = "30000000-0000-4000-8000-000000000001";
const otherAgentId = "30000000-0000-4000-8000-000000000002";
const credentialId = "40000000-0000-4000-8000-000000000001";
const otherCredentialId = "40000000-0000-4000-8000-000000000002";
const installationRef = `install_${"a".repeat(32)}`;
const processRef = `process_${"b".repeat(32)}`;
const stateVersion = `sha256:${"1".repeat(64)}`;
const nextStateVersion = `sha256:${"2".repeat(64)}`;

const staff: AuthenticatedUser = {
  id: staffId,
  organizationId,
  email: "staff@test.local",
  name: "Staff",
  role: "staff",
};
const otherStaff: AuthenticatedUser = {
  id: otherStaffId,
  organizationId: otherOrganizationId,
  email: "other@test.local",
  name: "Other staff",
  role: "staff",
};
const client: AuthenticatedUser = {
  id: clientId,
  organizationId,
  email: "client@test.local",
  name: "Client",
  role: "client",
};
const identity: AgentIdentity = {
  organizationId,
  agentId,
  credentialId,
  protocolVersion: "1.0",
};

const originalDeploymentEnvironment = {
  mode: process.env.NINJA_MANAGER_MODE,
  bindHost: process.env.NINJA_MANAGER_BIND_HOST,
  appUrl: process.env.APP_URL,
  port: process.env.PORT,
};

let database: DatabaseClient;
let repository: ProcessControlRepository;
let now: Date;
let keySequence: number;

function safeSummary(): ProcessQuitSafetySummary {
  return {
    armedScheduleCount: 0,
    accountCounts: { simulation: 1, evaluation: 0, funded: 0, live: 0, unknown: 0 },
    strategyCounts: { enabled: 0, unknown: 0 },
    positionCounts: { open: 0, unknown: 0 },
    orderCounts: { working: 0, transitional: 0, unknown: 0 },
    commandCounts: { inFlight: 0, indeterminate: 0 },
  };
}

function launchApprovalInput() {
  return {
    agentId,
    commandType: "LAUNCH_NINJATRADER" as const,
    expectedProcessStateVersion: stateVersion,
    target: { installationRef },
  };
}

function quitApprovalInput() {
  const summary = safeSummary();
  const observedAt = now.toISOString();
  return {
    agentId,
    commandType: "REQUEST_NINJATRADER_QUIT" as const,
    expectedProcessStateVersion: stateVersion,
    target: { installationRef, processRef },
    runtimeState: {
      observedAt,
      digest: processQuitRuntimeStateDigest(observedAt, summary),
      summary,
    },
  };
}

function nextKey(label = "request"): string {
  keySequence += 1;
  return `process-control:${label}:${String(keySequence).padStart(4, "0")}`;
}

async function queueLaunch(user = staff, key = nextKey("launch")) {
  const approval = await repository.createApproval(user, launchApprovalInput());
  const queued = await repository.enqueueApprovedCommand(user, {
    agentId,
    approvalId: approval.approvalId,
    idempotencyKey: key,
  });
  return { approval, queued, key };
}

function launchAcknowledgement(
  lease: LeasedProcessControlCommand,
  status: ProcessControlAcknowledgement["status"],
): ProcessControlAcknowledgement {
  const common = {
    protocolVersion: "process-control/1.0" as const,
    acknowledgementId: randomUUID(),
    commandId: lease.envelope.command.commandId,
    correlationId: lease.envelope.command.correlationId,
    agentId,
    leaseId: lease.leaseId,
    sequence: 1,
    commandType: "LAUNCH_NINJATRADER" as const,
    occurredAt: now.toISOString(),
  };
  if (status === "completed") {
    const evidence = {
      target: { installationRef },
      preProcessStateVersion: stateVersion,
      postProcessStateVersion: nextStateVersion,
      postObservedAt: now.toISOString(),
      preProcessState: "stopped" as const,
      postProcessState: "running" as const,
      processRef,
      matchedInstallationCount: 1,
      actuatorInvoked: true,
      mutationMayHaveOccurred: true,
      retrySafe: false,
      launchReadiness: {
        state: "ready" as const,
        observedAt: now.toISOString(),
        source: "authenticated_runtime_v2_addon_ipc" as const,
        authenticated: true as const,
        reasonCode: null,
      },
    };
    return { ...common, status, outcomeCode: "LAUNCHED", evidence, evidenceHash: hashCanonicalPayload(evidence) };
  }
  if (status === "blocked") {
    const evidence = {
      target: { installationRef },
      preProcessStateVersion: stateVersion,
      postProcessStateVersion: null,
      postObservedAt: null,
      preProcessState: "unknown" as const,
      postProcessState: "unknown" as const,
      processRef: null,
      matchedInstallationCount: 0,
      actuatorInvoked: false,
      mutationMayHaveOccurred: false,
      retrySafe: false,
    };
    return {
      ...common,
      status,
      outcomeCode: "INSTALLATION_NOT_ALLOWLISTED",
      evidence,
      evidenceHash: hashCanonicalPayload(evidence),
    };
  }
  if (status === "attention_required") {
    const evidence = {
      target: { installationRef },
      preProcessStateVersion: stateVersion,
      postProcessStateVersion: nextStateVersion,
      postObservedAt: now.toISOString(),
      preProcessState: "stopped" as const,
      postProcessState: "waiting_for_login" as const,
      processRef,
      matchedInstallationCount: 1,
      actuatorInvoked: true,
      mutationMayHaveOccurred: true,
      retrySafe: false,
      launchReadiness: {
        state: "not_ready" as const,
        observedAt: now.toISOString(),
        source: "authenticated_runtime_v2_addon_ipc" as const,
        authenticated: true as const,
        reasonCode: "LOGIN_REQUIRED" as const,
      },
    };
    return {
      ...common,
      status,
      outcomeCode: "WAITING_FOR_LOGIN",
      evidence,
      evidenceHash: hashCanonicalPayload(evidence),
    };
  }
  const evidence = {
    target: { installationRef },
    preProcessStateVersion: stateVersion,
    postProcessStateVersion: null,
    postObservedAt: null,
    preProcessState: "stopped" as const,
    postProcessState: "unknown" as const,
    processRef,
    matchedInstallationCount: 1,
    actuatorInvoked: true,
    mutationMayHaveOccurred: true,
    retrySafe: false,
  };
  return {
    ...common,
    status,
    outcomeCode: "LAUNCH_RESULT_UNKNOWN",
    evidence,
    evidenceHash: hashCanonicalPayload(evidence),
  };
}

function quitAcknowledgement(
  lease: LeasedProcessControlCommand,
): ProcessControlAcknowledgement {
  const command = lease.envelope.command;
  if (command.commandType !== "REQUEST_NINJATRADER_QUIT") throw new Error("Expected quit command");
  const evidence = {
    target: command.payload.target,
    runtimeStateDigest: command.payload.runtimeState.digest,
    runtimeObservedAt: command.payload.runtimeState.observedAt,
    preflight: command.payload.runtimeState.summary,
    blockers: [],
    preProcessStateVersion: command.expectedProcessStateVersion,
    postProcessStateVersion: command.expectedProcessStateVersion,
    postObservedAt: now.toISOString(),
    preProcessState: "stopped" as const,
    postProcessState: "stopped" as const,
    matchedProcessCount: 1,
    gracefulQuitRequested: false,
    forceKillUsed: false as const,
    cancelOrdersUsed: false as const,
    flattenPositionsUsed: false as const,
    disconnectConnectionsUsed: false as const,
    mutationMayHaveOccurred: false,
    retrySafe: true,
  };
  return {
    protocolVersion: "process-control/1.0",
    acknowledgementId: randomUUID(),
    commandId: command.commandId,
    correlationId: command.correlationId,
    agentId,
    leaseId: lease.leaseId,
    sequence: 1,
    commandType: "REQUEST_NINJATRADER_QUIT",
    status: "completed",
    outcomeCode: "ALREADY_STOPPED",
    evidence,
    evidenceHash: hashCanonicalPayload(evidence),
    occurredAt: now.toISOString(),
  };
}

beforeEach(async () => {
  process.env.NINJA_MANAGER_MODE = "LOCAL_ONLY";
  process.env.NINJA_MANAGER_BIND_HOST = "127.0.0.1";
  process.env.PORT = "3000";
  process.env.APP_URL = "http://127.0.0.1:3000";
  now = new Date("2026-07-21T19:00:00.000Z");
  keySequence = 0;
  database = createDatabaseClient(":memory:");
  await migrateDatabase(database);
  await database.query(
    "INSERT INTO organizations (id, name, slug) VALUES ($1, 'Vincere', 'vincere'), ($2, 'Other', 'other')",
    [organizationId, otherOrganizationId],
  );
  await database.query(
    [
      "INSERT INTO users (id, organization_id, email, name, password_hash, role) VALUES",
      "($1, $4, 'staff@test.local', 'Staff', 'hash', 'staff'),",
      "($2, $5, 'other@test.local', 'Other', 'hash', 'staff'),",
      "($3, $4, 'client@test.local', 'Client', 'hash', 'client')",
    ].join(" "),
    [staffId, otherStaffId, clientId, organizationId, otherOrganizationId],
  );
  await database.query(
    "INSERT INTO clients (id, organization_id, user_id, display_name, created_by) VALUES ($1, $2, $3, 'Client', $4)",
    [clientRecordId, organizationId, clientId, staffId],
  );
  await database.query(
    "INSERT INTO environments (id, organization_id, client_id, vps_provider, vps_region, ninja_version) VALUES ($1, $2, $3, 'local', 'local', '8')",
    [environmentId, organizationId, clientRecordId],
  );
  await database.query(
    [
      "INSERT INTO agent_installations",
      "(id, organization_id, environment_id, display_name, status, agent_version, protocol_version, capabilities, created_by) VALUES",
      "($1, $3, $7, 'Edith', 'online', '1.0.0', '1.0', '[]'::jsonb, $5),",
      "($2, $4, NULL, 'Other', 'online', '1.0.0', '1.0', '[]'::jsonb, $6)",
    ].join(" "),
    [agentId, otherAgentId, organizationId, otherOrganizationId, staffId, otherStaffId, environmentId],
  );
  await database.query(
    [
      "INSERT INTO agent_credentials",
      "(id, organization_id, agent_id, token_hash, token_last_four, created_by, created_at, expires_at) VALUES",
      "($1, $3, $5, $7, '1111', $9, $11, $12),",
      "($2, $4, $6, $8, '2222', $10, $11, $12)",
    ].join(" "),
    [
      credentialId,
      otherCredentialId,
      organizationId,
      otherOrganizationId,
      agentId,
      otherAgentId,
      "a".repeat(64),
      "b".repeat(64),
      staffId,
      otherStaffId,
      now,
      new Date(now.getTime() + 60 * 60_000),
    ],
  );
  repository = new ProcessControlRepository(database, () => now);
});

afterEach(async () => {
  await database.close();
  for (const [key, value] of Object.entries({
    NINJA_MANAGER_MODE: originalDeploymentEnvironment.mode,
    NINJA_MANAGER_BIND_HOST: originalDeploymentEnvironment.bindHost,
    APP_URL: originalDeploymentEnvironment.appUrl,
    PORT: originalDeploymentEnvironment.port,
  })) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("ProcessControlRepository", () => {
  it("reads request idempotency and fail-closed command safety counts within the tenant", async () => {
    const first = await queueLaunch(client, "process-control:dashboard:request-0001");

    expect(await repository.findCommandByIdempotency(client, {
      agentId,
      idempotencyKey: first.key,
      commandType: "LAUNCH_NINJATRADER",
    })).toMatchObject({
      commandId: first.queued.commandId,
      status: "queued",
      duplicate: true,
    });
    expect(await repository.getCommandSafetyCounts(client, agentId)).toEqual({
      inFlight: 1,
      indeterminate: 0,
    });

    const lease = await repository.leaseNextCommand(identity);
    expect(lease).not.toBeNull();
    now = new Date(now.getTime() + 61_000);
    expect(await repository.getCommandSafetyCounts(client, agentId)).toEqual({
      inFlight: 1,
      indeterminate: 0,
    });
    await repository.leaseNextCommand(identity);
    expect(await repository.getCommandSafetyCounts(client, agentId)).toEqual({
      inFlight: 0,
      indeterminate: 1,
    });

    await expect(repository.findCommandByIdempotency(otherStaff, {
      agentId,
      idempotencyKey: first.key,
      commandType: "LAUNCH_NINJATRADER",
    })).rejects.toThrow("Authorized agent installation not found");
  });

  it("rejects LOCAL_ONLY process control for an agent owned by another client", async () => {
    const peerUserId = "20000000-0000-4000-8000-000000000004";
    const peerClientId = "21000000-0000-4000-8000-000000000004";
    const peerEnvironmentId = "22000000-0000-4000-8000-000000000004";
    const peerAgentId = "30000000-0000-4000-8000-000000000004";
    await database.query(
      "INSERT INTO users (id, organization_id, email, name, password_hash, role) VALUES ($1, $2, 'peer@test.local', 'Peer', 'hash', 'client')",
      [peerUserId, organizationId],
    );
    await database.query(
      "INSERT INTO clients (id, organization_id, user_id, display_name, created_by) VALUES ($1, $2, $3, 'Peer', $4)",
      [peerClientId, organizationId, peerUserId, staffId],
    );
    await database.query(
      "INSERT INTO environments (id, organization_id, client_id, vps_provider, vps_region, ninja_version) VALUES ($1, $2, $3, 'local', 'local', '8')",
      [peerEnvironmentId, organizationId, peerClientId],
    );
    await database.query(
      "INSERT INTO agent_installations (id, organization_id, environment_id, display_name, status, agent_version, protocol_version, capabilities, created_by) VALUES ($1, $2, $3, 'Peer', 'online', '1.0.0', '1.0', '[]'::jsonb, $4)",
      [peerAgentId, organizationId, peerEnvironmentId, staffId],
    );

    await expect(repository.getCommandSafetyCounts(client, peerAgentId)).rejects.toMatchObject({
      code: "AGENT_NOT_FOUND",
    });
    await expect(repository.createApproval(client, {
      ...launchApprovalInput(),
      agentId: peerAgentId,
    })).rejects.toMatchObject({ code: "AGENT_NOT_FOUND" });
  });

  it("does not disclose another operator's idempotent process command", async () => {
    const first = await queueLaunch(staff, "process-control:dashboard:request-0002");
    await expect(repository.findCommandByIdempotency(client, {
      agentId,
      idempotencyKey: first.key,
      commandType: "LAUNCH_NINJATRADER",
    })).rejects.toThrow("different operator");
    await expect(repository.findCommandByIdempotency(staff, {
      agentId,
      idempotencyKey: first.key,
      commandType: "REQUEST_NINJATRADER_QUIT",
    })).rejects.toThrow("does not match the original command type");
  });

  it("constructs launch and quit commands server-side with canonical hashes and no executable surface", async () => {
    await queueLaunch();
    const quitApproval = await repository.createApproval(staff, quitApprovalInput());
    await repository.enqueueApprovedCommand(staff, {
      agentId,
      approvalId: quitApproval.approvalId,
      idempotencyKey: nextKey("quit"),
    });

    const rows = await database.query<{
      command: unknown;
      command_type: string;
      payload_hash: string;
      semantic_hash: string;
      envelope_hash: string;
      runtime_state_digest: string | null;
    }>(
      "SELECT command, command_type, payload_hash, semantic_hash, envelope_hash, runtime_state_digest FROM process_control_commands ORDER BY created_at, command_type",
    );
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      const command = processControlCommandSchema.parse(row.command);
      const delivered = createDeliveredProcessControlCommand(command);
      expect(row).toMatchObject({
        payload_hash: delivered.integrity.payloadHash,
        semantic_hash: delivered.integrity.semanticHash,
        envelope_hash: delivered.integrity.envelopeHash,
      });
      expect(JSON.stringify(command)).not.toMatch(/executable|arguments|environment|credential/i);
      if (command.commandType === "REQUEST_NINJATRADER_QUIT") {
        expect(row.runtime_state_digest).toBe(command.payload.runtimeState.digest);
      }
    }

    await expect(repository.createApproval(staff, {
      ...launchApprovalInput(),
      target: { installationRef, executablePath: "C:\\untrusted\\NinjaTrader.exe" },
    })).rejects.toThrow();
  });

  it("consumes each approval once and makes only its exact idempotent enqueue replay safe", async () => {
    const approval = await repository.createApproval(staff, launchApprovalInput());
    const key = nextKey("one-use");
    const first = await repository.enqueueApprovedCommand(staff, { agentId, approvalId: approval.approvalId, idempotencyKey: key });
    const replay = await repository.enqueueApprovedCommand(staff, { agentId, approvalId: approval.approvalId, idempotencyKey: key });
    expect(replay).toMatchObject({ duplicate: true, recordId: first.recordId, commandId: first.commandId });
    process.env.NINJA_MANAGER_MODE = "LOCAL_ONLY";
    process.env.NINJA_MANAGER_BIND_HOST = "127.0.0.1";
    process.env.PORT = "3000";
    process.env.APP_URL = "http://127.0.0.1:3000";
    await expect(repository.enqueueApprovedCommand(client, {
      agentId,
      approvalId: approval.approvalId,
      idempotencyKey: key,
    })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(repository.enqueueApprovedCommand(staff, {
      agentId,
      approvalId: approval.approvalId,
      idempotencyKey: nextKey("second-use"),
    })).rejects.toMatchObject({ code: "CONFLICT" });

    const otherApproval = await repository.createApproval(staff, launchApprovalInput());
    await expect(repository.enqueueApprovedCommand(staff, {
      agentId,
      approvalId: otherApproval.approvalId,
      idempotencyKey: key,
    })).rejects.toMatchObject({ code: "CONFLICT" });

    const [stored] = await database.query<{ consumed_at: Date; consumed_by_command_id: string }>(
      "SELECT consumed_at, consumed_by_command_id FROM process_control_approvals WHERE id = $1",
      [approval.approvalId],
    );
    expect(stored.consumed_by_command_id).toBe(first.recordId);
  });

  it("enforces tenant and deployment role boundaries", async () => {
    process.env.NINJA_MANAGER_MODE = "CENTRAL_CONNECTED";
    await expect(repository.createApproval(staff, launchApprovalInput())).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(repository.createApproval(client, launchApprovalInput())).rejects.toMatchObject({ code: "FORBIDDEN" });

    process.env.NINJA_MANAGER_MODE = "LOCAL_ONLY";
    process.env.NINJA_MANAGER_BIND_HOST = "127.0.0.1";
    process.env.PORT = "3000";
    process.env.APP_URL = "http://127.0.0.1:3000";
    await expect(repository.createApproval(otherStaff, launchApprovalInput())).rejects.toMatchObject({ code: "AGENT_NOT_FOUND" });
    const approval = await repository.createApproval(client, launchApprovalInput());
    await expect(repository.enqueueApprovedCommand(client, {
      agentId,
      approvalId: approval.approvalId,
      idempotencyKey: nextKey("local-client"),
    })).resolves.toMatchObject({ status: "queued", duplicate: false });
  });

  it("delivers one exact command once and marks an unacknowledged delivery indeterminate", async () => {
    await queueLaunch();
    const lease = await repository.leaseNextCommand(identity);
    expect(lease).toMatchObject({
      deliveryAttempt: 1,
      envelope: { command: { agentId, commandType: "LAUNCH_NINJATRADER" } },
    });
    expect(await repository.leaseNextCommand(identity)).toBeNull();
    expect(await database.query("SELECT id FROM process_control_deliveries")).toHaveLength(1);

    now = new Date(now.getTime() + 61_000);
    expect(await repository.leaseNextCommand(identity)).toBeNull();
    const [stored] = await database.query<{ status: string; delivery_attempts: number }>(
      "SELECT status, delivery_attempts FROM process_control_commands",
    );
    expect(stored).toMatchObject({ status: "indeterminate", delivery_attempts: 1 });
    expect(await database.query("SELECT id FROM process_control_deliveries")).toHaveLength(1);
  });

  it("keeps at most one process command in flight for an agent", async () => {
    const first = await queueLaunch();
    const second = await queueLaunch();
    const firstLease = await repository.leaseNextCommand(identity);
    if (!firstLease) throw new Error("Expected first process command lease");
    expect(firstLease.envelope.command.commandId).toBe(first.queued.commandId);
    expect(await repository.leaseNextCommand(identity)).toBeNull();

    now = new Date(now.getTime() + 1_000);
    await repository.recordAcknowledgement(identity, launchAcknowledgement(firstLease, "blocked"));
    const secondLease = await repository.leaseNextCommand(identity);
    expect(secondLease?.envelope.command.commandId).toBe(second.queued.commandId);
  });

  it("expires untouched queued commands without creating a delivery", async () => {
    await queueLaunch();
    now = new Date(now.getTime() + 61_000);
    expect(await repository.leaseNextCommand(identity)).toBeNull();
    const [stored] = await database.query<{ status: string; delivery_attempts: number }>(
      "SELECT status, delivery_attempts FROM process_control_commands",
    );
    expect(stored).toMatchObject({ status: "expired", delivery_attempts: 0 });
    expect(await database.query("SELECT id FROM process_control_deliveries")).toHaveLength(0);
  });

  it.each([
    "completed",
    "blocked",
    "attention_required",
    "indeterminate",
  ] as const)("stores terminal %s acknowledgement and never redelivers it", async (status) => {
    await queueLaunch();
    const lease = await repository.leaseNextCommand(identity);
    if (!lease) throw new Error("Expected process command lease");
    now = new Date(now.getTime() + 1_000);
    const acknowledgement = launchAcknowledgement(lease, status);
    await expect(repository.recordAcknowledgement(identity, acknowledgement)).resolves.toMatchObject({
      status,
      duplicate: false,
    });
    expect(await repository.leaseNextCommand(identity)).toBeNull();
    const [stored] = await database.query<{ status: string; last_ack_sequence: number }>(
      "SELECT status, last_ack_sequence FROM process_control_commands",
    );
    expect(stored).toMatchObject({ status, last_ack_sequence: 1 });
  });

  it("rejects tamper, wrong lease, sequence gaps, wrong credentials, and conflicting replay", async () => {
    await queueLaunch();
    const lease = await repository.leaseNextCommand(identity);
    if (!lease) throw new Error("Expected process command lease");
    now = new Date(now.getTime() + 1_000);
    const valid = launchAcknowledgement(lease, "completed");

    await expect(repository.recordAcknowledgement(identity, {
      ...valid,
      evidenceHash: `sha256:${"f".repeat(64)}`,
    })).rejects.toThrow(/evidence hash/i);
    await expect(repository.recordAcknowledgement(identity, {
      ...valid,
      leaseId: randomUUID(),
    })).rejects.toMatchObject({ code: "INVALID_DELIVERY" });
    await expect(repository.recordAcknowledgement(identity, {
      ...valid,
      sequence: 2,
    })).rejects.toMatchObject({ code: "SEQUENCE_GAP" });
    await expect(repository.recordAcknowledgement({ ...identity, credentialId: randomUUID() }, valid)).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });

    const first = await repository.recordAcknowledgement(identity, valid);
    const replay = await repository.recordAcknowledgement(identity, valid);
    expect(replay).toMatchObject({ duplicate: true, acknowledgementRecordId: first.acknowledgementRecordId });
    await expect(repository.recordAcknowledgement(identity, {
      ...valid,
      occurredAt: new Date(now.getTime() + 1).toISOString(),
    })).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("binds launch acknowledgement evidence to the exact delivered target and pre-state", async () => {
    await queueLaunch();
    const lease = await repository.leaseNextCommand(identity);
    if (!lease) throw new Error("Expected process command lease");
    now = new Date(now.getTime() + 1_000);
    const valid = launchAcknowledgement(lease, "completed");
    if (valid.commandType !== "LAUNCH_NINJATRADER") throw new Error("Expected launch acknowledgement");

    const wrongTargetEvidence = {
      ...valid.evidence,
      target: { installationRef: `install_${"c".repeat(32)}` },
    };
    await expect(repository.recordAcknowledgement(identity, {
      ...valid,
      evidence: wrongTargetEvidence,
      evidenceHash: hashCanonicalPayload(wrongTargetEvidence),
    })).rejects.toMatchObject({ code: "CONFLICT" });

    const wrongPreStateEvidence = {
      ...valid.evidence,
      preProcessStateVersion: `sha256:${"3".repeat(64)}`,
    };
    await expect(repository.recordAcknowledgement(identity, {
      ...valid,
      evidence: wrongPreStateEvidence,
      evidenceHash: hashCanonicalPayload(wrongPreStateEvidence),
    })).rejects.toMatchObject({ code: "CONFLICT" });

    const changedStateEvidence = {
      ...launchAcknowledgement(lease, "blocked").evidence,
      preProcessStateVersion: `sha256:${"3".repeat(64)}`,
      matchedInstallationCount: 1,
    };
    await expect(repository.recordAcknowledgement(identity, {
      ...valid,
      status: "blocked",
      outcomeCode: "PROCESS_STATE_CHANGED",
      evidence: changedStateEvidence,
      evidenceHash: hashCanonicalPayload(changedStateEvidence),
    })).resolves.toMatchObject({ status: "blocked", duplicate: false });
  });

  it("binds quit acknowledgement evidence to the exact target and runtime preflight", async () => {
    const approval = await repository.createApproval(staff, quitApprovalInput());
    await repository.enqueueApprovedCommand(staff, {
      agentId,
      approvalId: approval.approvalId,
      idempotencyKey: nextKey("quit-binding"),
    });
    const lease = await repository.leaseNextCommand(identity);
    if (!lease) throw new Error("Expected quit command lease");
    now = new Date(now.getTime() + 1_000);
    const valid = quitAcknowledgement(lease);
    if (valid.commandType !== "REQUEST_NINJATRADER_QUIT") throw new Error("Expected quit acknowledgement");

    const wrongTargetEvidence = {
      ...valid.evidence,
      target: { ...valid.evidence.target, processRef: `process_${"d".repeat(32)}` },
    };
    await expect(repository.recordAcknowledgement(identity, {
      ...valid,
      evidence: wrongTargetEvidence,
      evidenceHash: hashCanonicalPayload(wrongTargetEvidence),
    })).rejects.toMatchObject({ code: "CONFLICT" });

    const wrongObservedAt = new Date(Date.parse(valid.evidence.runtimeObservedAt) - 1_000).toISOString();
    const wrongRuntimeEvidence = {
      ...valid.evidence,
      runtimeObservedAt: wrongObservedAt,
      runtimeStateDigest: hashCanonicalPayload({
        observedAt: wrongObservedAt,
        summary: valid.evidence.preflight,
      }),
    };
    await expect(repository.recordAcknowledgement(identity, {
      ...valid,
      evidence: wrongRuntimeEvidence,
      evidenceHash: hashCanonicalPayload(wrongRuntimeEvidence),
    })).rejects.toMatchObject({ code: "CONFLICT" });

    const changedStateEvidence = {
      ...wrongRuntimeEvidence,
      blockers: ["PROCESS_STATE_CHANGED" as const],
      preProcessStateVersion: `sha256:${"3".repeat(64)}`,
      postProcessStateVersion: null,
      postObservedAt: null,
      preProcessState: "running" as const,
      postProcessState: "unknown" as const,
      gracefulQuitRequested: false,
      mutationMayHaveOccurred: false,
      retrySafe: false,
    };
    await expect(repository.recordAcknowledgement(identity, {
      ...valid,
      status: "blocked",
      outcomeCode: "PREFLIGHT_BLOCKED",
      evidence: changedStateEvidence,
      evidenceHash: hashCanonicalPayload(changedStateEvidence),
    })).resolves.toMatchObject({ status: "blocked", duplicate: false });
  });

  it("rejects acknowledgements after the lease or command expiry window", async () => {
    await queueLaunch();
    const lease = await repository.leaseNextCommand(identity);
    if (!lease) throw new Error("Expected process command lease");
    now = new Date(now.getTime() + 61_000);
    const acknowledgement = launchAcknowledgement(lease, "indeterminate");
    await expect(repository.recordAcknowledgement(identity, acknowledgement)).rejects.toMatchObject({ code: "COMMAND_EXPIRED" });
    expect(await database.query("SELECT id FROM process_control_acknowledgements")).toHaveLength(0);
  });

  it("records canonical user and agent audit evidence for approval, queue, delivery, and outcome", async () => {
    await queueLaunch();
    const lease = await repository.leaseNextCommand(identity);
    if (!lease) throw new Error("Expected process command lease");
    now = new Date(now.getTime() + 1_000);
    await repository.recordAcknowledgement(identity, launchAcknowledgement(lease, "blocked"));

    const events = await database.query<{
      id: string;
      organization_id: string;
      actor_subject_id: string;
      action: string;
      entity_type: string;
      entity_id: string;
      metadata: unknown;
      origin_installation_id: string | null;
      event_version: number;
      evidence_hash: string;
      legacy_unverified: boolean;
      created_at: Date;
    }>(
      "SELECT id, organization_id, actor_subject_id, action, entity_type, entity_id, metadata, origin_installation_id, event_version, evidence_hash, legacy_unverified, created_at FROM audit_events WHERE action LIKE 'process_control.%' ORDER BY created_at, action",
    );
    expect(events.map((event) => event.action)).toEqual(expect.arrayContaining([
      "process_control.approval_created",
      "process_control.command_queued",
      "process_control.command_delivered",
      "process_control.command_blocked",
    ]));
    for (const event of events) {
      expect(event.legacy_unverified).toBe(false);
      expect(event.evidence_hash).toBe(auditEvidenceHash({
        eventId: event.id,
        eventVersion: Number(event.event_version),
        organizationId: event.organization_id,
        actorSubjectId: event.actor_subject_id,
        action: event.action,
        entityType: event.entity_type,
        entityId: event.entity_id,
        metadata: event.metadata,
        originInstallationId: event.origin_installation_id,
        occurredAt: new Date(event.created_at).toISOString(),
      }));
    }
  });

  it("enforces migration tenant, TTL, and command-approval foreign keys", async () => {
    const sql = [
      "INSERT INTO process_control_approvals",
      "(id, organization_id, agent_id, interactive_confirmation_id, approved_by, command_type, intent_hash,",
      "expected_process_state_version, intent_payload, issued_at, expires_at)",
      "VALUES ($1, $2, $3, $4, $5, 'LAUNCH_NINJATRADER', $6, $7, '{}'::jsonb, $8, $9)",
    ].join(" ");
    const values = [
      randomUUID(), organizationId, otherAgentId, randomUUID(), staffId,
      "sha256:" + "a".repeat(64), stateVersion, now, new Date(now.getTime() + 60_000),
    ];
    await expect(database.query(sql, values)).rejects.toThrow();
    values[2] = agentId;
    values[8] = new Date(now.getTime() + 60_001);
    await expect(database.query(sql, values)).rejects.toThrow();

    const first = await queueLaunch();
    const second = await queueLaunch();
    await expect(database.query(
      "UPDATE process_control_approvals SET consumed_by_command_id = $1 WHERE id = $2",
      [second.queued.recordId, first.approval.approvalId],
    )).rejects.toThrow();
  });

  it("applies migration 0007 on an upgraded database and reapplies it without data loss", async () => {
    const upgraded = createDatabaseClient(":memory:");
    try {
      for (const filename of [
        "0001_initial.sql",
        "0002_runtime_orchestration.sql",
        "0003_runtime_security_and_delivery.sql",
        "0004_deployment_portability.sql",
        "0005_foundation_integrity.sql",
        "0006_runtime_observation_v2.sql",
      ]) {
        await upgraded.exec(await readFile(new URL(`../../../migrations/${filename}`, import.meta.url), "utf8"));
      }
      await upgraded.query("INSERT INTO organizations (id, name, slug) VALUES ($1, 'Vincere', 'upgrade-vincere')", [organizationId]);
      await upgraded.query(
        "INSERT INTO users (id, organization_id, email, name, password_hash, role) VALUES ($1, $2, 'staff@upgrade.local', 'Staff', 'hash', 'staff')",
        [staffId, organizationId],
      );
      await upgraded.query(
        "INSERT INTO agent_installations (id, organization_id, display_name, status, agent_version, protocol_version, capabilities, created_by) VALUES ($1, $2, 'Edith', 'online', '1.0.0', '1.0', '[]'::jsonb, $3)",
        [agentId, organizationId, staffId],
      );
      const migration = await readFile(new URL("../../../migrations/0007_process_control_queue.sql", import.meta.url), "utf8");
      await expect(upgraded.exec(migration)).resolves.toBeUndefined();
      await upgraded.query(
        [
          "INSERT INTO process_control_approvals",
          "(id, organization_id, agent_id, interactive_confirmation_id, approved_by, command_type, intent_hash, expected_process_state_version, intent_payload, issued_at, expires_at)",
          "VALUES ($1, $2, $3, $4, $5, 'LAUNCH_NINJATRADER', $6, $7, '{}'::jsonb, $8, $9)",
        ].join(" "),
        [randomUUID(), organizationId, agentId, randomUUID(), staffId, `sha256:${"a".repeat(64)}`, stateVersion, now, new Date(now.getTime() + 60_000)],
      );
      await expect(upgraded.exec(migration)).resolves.toBeUndefined();
      expect(await upgraded.query("SELECT id FROM process_control_approvals")).toHaveLength(1);
      const tables = await upgraded.query<{ table_name: string }>(
        "SELECT table_name FROM information_schema.tables WHERE table_name LIKE 'process_control_%' ORDER BY table_name",
      );
      expect(tables.map((row) => row.table_name)).toEqual([
        "process_control_acknowledgements",
        "process_control_approvals",
        "process_control_commands",
        "process_control_deliveries",
      ]);
    } finally {
      await upgraded.close();
    }
  });
});
