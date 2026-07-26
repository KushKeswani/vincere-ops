import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";

import { createDatabaseClient, type DatabaseClient, type DatabaseTransaction } from "@/lib/db/client";
import { migrateDatabase } from "@/lib/db/migrate";
import { auditEvidenceHash } from "@/lib/domain/audit-evidence";
import {
  hashCanonicalPayload,
  readOnlyCommandEnvelopeSchema,
  runtimeStateVersion,
  type AcknowledgementStatus,
  type ProcessObservation,
  type ReadOnlyCommandEnvelope,
} from "@/lib/domain/runtime-contracts";
import {
  runtimeObservationV2StateDigest,
  type RuntimeObservationV2State,
} from "@/lib/domain/runtime-observation-v2";
import type { AuthenticatedUser } from "@/lib/domain/types";
import { RuntimeRepository, type AgentIdentity, type LeasedCommand } from "./runtime-repository";

const orgId = "10000000-0000-4000-8000-000000000001";
const otherOrgId = "10000000-0000-4000-8000-000000000002";
const staffId = "20000000-0000-4000-8000-000000000001";
const otherStaffId = "20000000-0000-4000-8000-000000000002";
const clientId = "30000000-0000-4000-8000-000000000001";
const clientRecordId = "31000000-0000-4000-8000-000000000001";
const environmentId = "32000000-0000-4000-8000-000000000001";
const agentId = "40000000-0000-4000-8000-000000000001";
const originalDeploymentEnvironment = {
  mode: process.env.NINJA_MANAGER_MODE,
  bindHost: process.env.NINJA_MANAGER_BIND_HOST,
  appUrl: process.env.APP_URL,
  port: process.env.PORT,
};

const staff: AuthenticatedUser = {
  id: staffId,
  organizationId: orgId,
  email: "staff@test.local",
  name: "Staff",
  role: "staff",
};
const otherStaff: AuthenticatedUser = {
  id: otherStaffId,
  organizationId: otherOrgId,
  email: "other@test.local",
  name: "Other",
  role: "staff",
};
const client: AuthenticatedUser = {
  id: clientId,
  organizationId: orgId,
  email: "client@test.local",
  name: "Client",
  role: "client",
};

let database: DatabaseClient;
let repository: RuntimeRepository;
let identity: AgentIdentity;
let agentToken: string;
let now: Date;

function withFailingAuditWrites(client: DatabaseClient): DatabaseClient {
  return {
    query<T extends object>(sql: string, params?: unknown[]): Promise<T[]> {
      return client.query<T>(sql, params);
    },
    exec(sql: string): Promise<void> {
      return client.exec(sql);
    },
    transaction<T>(operation: (transaction: DatabaseTransaction) => Promise<T>): Promise<T> {
      return client.transaction((transaction) => operation({
        query<TRecord extends object>(sql: string, params?: unknown[]): Promise<TRecord[]> {
          if (/INSERT\s+INTO\s+audit_events/i.test(sql)) throw new Error("injected audit write failure");
          return transaction.query<TRecord>(sql, params);
        },
        exec(sql: string): Promise<void> {
          return transaction.exec(sql);
        },
      }));
    },
    close(): Promise<void> {
      return client.close();
    },
  };
}

beforeEach(async () => {
  process.env.NINJA_MANAGER_MODE = "LOCAL_ONLY";
  process.env.NINJA_MANAGER_BIND_HOST = "127.0.0.1";
  process.env.PORT = "3000";
  process.env.APP_URL = "http://127.0.0.1:3000";
  now = new Date("2026-07-13T19:00:00.000Z");
  database = createDatabaseClient(":memory:");
  await migrateDatabase(database);
  await database.query(
    "INSERT INTO organizations (id, name, slug) VALUES ($1, 'Vincere', 'vincere'), ($2, 'Other', 'other')",
    [orgId, otherOrgId],
  );
  await database.query(
    [
      "INSERT INTO users (id, organization_id, email, name, password_hash, role) VALUES",
      "($1, $4, 'staff@test.local', 'Staff', 'hash', 'staff'),",
      "($2, $5, 'other@test.local', 'Other', 'hash', 'staff'),",
      "($3, $4, 'client@test.local', 'Client', 'hash', 'client')",
    ].join(" "),
    [staffId, otherStaffId, clientId, orgId, otherOrgId],
  );
  await database.query(
    "INSERT INTO clients (id, organization_id, user_id, display_name, created_by) VALUES ($1, $2, $3, 'Client', $4)",
    [clientRecordId, orgId, clientId, staffId],
  );
  await database.query(
    "INSERT INTO environments (id, organization_id, client_id, vps_provider, vps_region, ninja_version) VALUES ($1, $2, $3, 'local', 'local', '8')",
    [environmentId, orgId, clientRecordId],
  );
  repository = new RuntimeRepository(database, () => now);
  const enrollment = await repository.enrollAgent(staff, {
    id: agentId,
    environmentId,
    displayName: "Client VPS 1",
    agentVersion: "1.0.0",
    protocolVersion: "1.0",
    capabilities: ["runtime.discovery", "command.acknowledgements"],
  });
  agentToken = enrollment.token;
  const authenticated = await repository.authenticateAgentToken(agentToken);
  if (!authenticated) throw new Error("Test agent authentication failed");
  identity = authenticated;
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

async function expectCanonicalAgentAudits(): Promise<void> {
  const events = await database.query<{
    id: string;
    organization_id: string;
    actor_subject_id: string;
    action: string;
    entity_type: string;
    entity_id: string;
    metadata: Record<string, unknown>;
    origin_installation_id: string | null;
    event_version: number;
    evidence_hash: string;
    legacy_unverified: boolean;
    created_at: Date;
  }>("SELECT id, organization_id, actor_subject_id, action, entity_type, entity_id, metadata, origin_installation_id, event_version, evidence_hash, legacy_unverified, created_at FROM audit_events WHERE action LIKE 'agent.%'");
  expect(events.length).toBeGreaterThan(0);
  for (const event of events) {
    expect(event.event_version).toBe(1);
    expect(event.legacy_unverified).toBe(false);
    expect(event.evidence_hash).toBe(auditEvidenceHash({
      eventId: event.id,
      eventVersion: event.event_version,
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
}

function uuid(namespace: string, value: number): string {
  return namespace + "-0000-4000-8000-" + String(value).padStart(12, "0");
}

function snapshot(
  sequence: number,
  options: {
    eventId?: string;
    stateVersion?: string;
    empty?: boolean;
    strategyCount?: number;
    occurredAt?: string;
    connectionStatus?: "connected" | "connecting" | "disconnected" | "unknown";
    identifierFingerprint?: string;
    strategyType?: string;
  } = {},
) {
  const accountRef = "acct_1234567890abcdef";
  const account = {
    accountRef,
    maskedIdentifier: "****1234",
    identifierFingerprint: options.identifierFingerprint ?? "hmac-sha256:" + "a".repeat(64),
    displayLabel: "Evaluation account 1",
    accountType: "evaluation" as const,
    connectionKind: "brokerage" as const,
    connectionStatus: options.connectionStatus ?? "connected" as const,
  };
  const strategyCount = options.strategyCount ?? 1;
  const strategies = options.empty
    ? []
    : Array.from({ length: strategyCount }, (_, index) => ({
      strategyRef: "strat_" + String(index).padStart(16, "0"),
      accountRef,
      displayLabel: "Strategy " + (index + 1),
      strategyType: options.strategyType ?? "VincereSteady",
      instrumentCode: "MNQ SEP26",
      timeframeCode: "1 Minute",
      enabled: true,
      sync: true,
      runtimeState: "running" as const,
      stateCode: "SYNCHRONIZED" as const,
    }));
  const runtimeState = {
    accounts: options.empty ? [] : [account],
    strategies,
  };
  const payload = {
    source: "ninjatrader_addon" as const,
    collectionMode: "supervised_simulation" as const,
    complete: true as const,
    observedAt: options.occurredAt ?? now.toISOString(),
    addonVersion: "1.0.0",
    stateVersion: options.stateVersion ?? runtimeStateVersion(runtimeState),
    ...runtimeState,
  };
  const unsigned = {
    protocolVersion: "1.0" as const,
    eventId: options.eventId ?? uuid("50000000", sequence),
    agentId,
    sequence,
    eventType: "runtime.snapshot" as const,
    correlationId: null,
    causationId: null,
    occurredAt: options.occurredAt ?? now.toISOString(),
    payloadHash: hashCanonicalPayload(payload),
    payload,
  };
  return { ...unsigned, envelopeHash: hashCanonicalPayload(unsigned) };
}

function heartbeat(
  sequence: number,
  options: {
    health?: "online" | "degraded";
    addonConnected?: boolean;
    observedAt?: string;
    agentVersion?: string;
    processObservation?: ProcessObservation;
  } = {},
) {
  const payload = {
    source: "vps_companion_agent" as const,
    observedAt: options.observedAt ?? now.toISOString(),
    agentVersion: options.agentVersion ?? "1.0.0",
    health: options.health ?? "online" as const,
    addonConnected: options.addonConnected ?? true,
    addonVersion: "1.0.0",
    pendingEventCount: 0,
    ...(options.processObservation ? { processObservation: options.processObservation } : {}),
  };
  const unsigned = {
    protocolVersion: "1.0" as const,
    eventId: uuid("51000000", sequence),
    agentId,
    sequence,
    eventType: "agent.heartbeat" as const,
    correlationId: null,
    causationId: null,
    occurredAt: options.observedAt ?? now.toISOString(),
    payloadHash: hashCanonicalPayload(payload),
    payload,
  };
  return { ...unsigned, envelopeHash: hashCanonicalPayload(unsigned) };
}

function runningProcessObservation(observedAt = now.toISOString()): ProcessObservation {
  return {
    observedAt,
    installationRef: "install_1234567890abcdef",
    state: "running",
    processStateVersion: "sha256:" + "a".repeat(64),
    processRef: "process_" + "b".repeat(64),
    matchedProcessCount: 1,
    unavailableReason: null,
  };
}

function runtimeObservationV2(
  sequence: number,
  options: {
    eventId?: string;
    occurredAt?: string;
    asOf?: string;
    identifierFingerprint?: string;
    strategyTypeCode?: string;
  } = {},
) {
  const accountRef = "acct_1234567890abcdef";
  const connectionRef = "conn_1234567890abcdef";
  const strategyRef = "strat_0000000000000000";
  const completeScope = (itemCount: number) => ({
    status: "complete" as const,
    itemCount,
    errors: [],
  });
  const unavailableScope = () => ({
    status: "unavailable" as const,
    itemCount: 0,
    errors: [{ code: "SOURCE_ERROR" as const, retryable: true }],
  });
  const state: RuntimeObservationV2State = {
    process: null,
    addon: null,
    connections: [{
      connectionRef,
      displayLabel: "Connection 1",
      kind: "simulation",
      providerCode: "TRADOVATE",
      status: "connected",
      health: "healthy",
      marketDataStatus: "live",
      lastStateChangeAt: null,
    }],
    accounts: [{
      accountRef,
      maskedIdentifier: "****m101",
      identifierFingerprint: options.identifierFingerprint ?? "hmac-sha256:" + "a".repeat(64),
      displayLabel: "Simulation account 1",
      classification: {
        environment: "simulation",
        authority: "authoritative",
        source: "ninjatrader_simulation_account",
      },
      connectionRefs: [connectionRef],
      status: "connected",
    }],
    strategies: [{
      strategyRef,
      accountRef,
      displayLabel: "Strategy 1",
      strategyTypeCode: options.strategyTypeCode ?? "VINCERE_STEADY",
      instrumentCode: "MNQ SEP26",
      enabled: true,
      runtimeState: "running",
      synchronizationState: "synchronized",
      operationalParameters: [],
      lastStateChangeAt: null,
    }],
    positions: [],
    orders: [],
    executions: [],
    pnl: [],
    collection: {
      overall: "partial",
      scopes: {
        process: unavailableScope(),
        addon: unavailableScope(),
        connections: completeScope(1),
        accounts: completeScope(1),
        strategies: completeScope(1),
        positions: completeScope(0),
        orders: completeScope(0),
        executions: completeScope(0),
        pnl: unavailableScope(),
      },
    },
  };
  const payload = {
    protocolVersion: "runtime-observation/2.0" as const,
    observationId: uuid("52000000", sequence),
    source: {
      collector: "vps_companion_agent" as const,
      authority: "ninjatrader_runtime" as const,
      installationRef: "install_1234567890abcdef",
      collectionSessionRef: "session_1234567890abcdef",
    },
    asOf: options.asOf ?? now.toISOString(),
    freshness: { status: "fresh" as const, ageMs: 0, maxAgeMs: 5_000 },
    stateDigest: runtimeObservationV2StateDigest(state),
    state,
  };
  const unsigned = {
    protocolVersion: "1.0" as const,
    eventId: options.eventId ?? uuid("53000000", sequence),
    agentId,
    sequence,
    eventType: "runtime.observation_v2" as const,
    correlationId: null,
    causationId: null,
    occurredAt: options.occurredAt ?? now.toISOString(),
    payloadHash: hashCanonicalPayload(payload),
    payload,
  };
  return { ...unsigned, envelopeHash: hashCanonicalPayload(unsigned) };
}

function command(
  value: number,
  overrides: {
    agentId?: string;
    idempotencyKey?: string;
    commandId?: string;
    correlationId?: string;
    issuedAt?: string;
    expiresAt?: string;
    expectedStateVersion?: string | null;
    include?: Array<"accounts" | "strategies">;
  } = {},
): ReadOnlyCommandEnvelope {
  const issuedAt = overrides.issuedAt ?? now.toISOString();
  const expiresAt = overrides.expiresAt ?? new Date(Date.parse(issuedAt) + 5 * 60 * 1000).toISOString();
  return readOnlyCommandEnvelopeSchema.parse({
    protocolVersion: "1.0",
    commandId: overrides.commandId ?? uuid("60000000", value),
    correlationId: overrides.correlationId ?? uuid("61000000", value),
    agentId: overrides.agentId ?? agentId,
    idempotencyKey: overrides.idempotencyKey ?? "discover:agent:request:" + value,
    commandType: "DISCOVER_RUNTIME_STATE",
    issuedAt,
    expiresAt,
    expectedStateVersion: overrides.expectedStateVersion ?? null,
    approvalId: null,
    dryRun: true,
    payload: {
      include: overrides.include ?? ["accounts", "strategies"],
      forceFullSnapshot: true,
      reasonCode: "STAFF_RUNTIME_REFRESH",
    },
  });
}

function acknowledgement(
  delivery: LeasedCommand,
  sequence: number,
  status: AcknowledgementStatus,
  value: number,
  evidenceOverrides: Partial<{
    resultEventIds: string[];
    completedScopes: Array<"accounts" | "strategies" | "executions">;
    failedScopes: Array<"accounts" | "strategies" | "executions">;
    retrySafe: boolean;
    errorCode: "NONE" | "ADDON_OFFLINE" | "COMMAND_TIMEOUT" | "STATE_CHANGED" | "UNSUPPORTED_CAPABILITY" | "LOCAL_PERSISTENCE_FAILURE" | "INTERNAL_ERROR";
    observedStateVersion: string | null;
    counts: { accounts: number; strategies: number; executions: number };
  }> = {},
) {
  const evidence = {
    resultEventIds: [],
    completedScopes: [],
    failedScopes: [],
    retrySafe: false,
    errorCode: "NONE" as const,
    observedStateVersion: null,
    counts: { accounts: 0, strategies: 0, executions: 0 },
    ...evidenceOverrides,
  };
  const messageCode = {
    accepted: "COMMAND_PERSISTED",
    rejected: "COMMAND_REJECTED_POLICY",
    started: "COMMAND_STARTED",
    progress: "COMMAND_PROGRESS",
    completed: "COMMAND_COMPLETED",
    failed: "COMMAND_FAILED",
    partial: "COMMAND_PARTIAL",
    expired: "COMMAND_EXPIRED",
    indeterminate: "COMMAND_INDETERMINATE",
  }[status];
  const unsigned = {
    protocolVersion: "1.0" as const,
    acknowledgementId: uuid("70000000", value),
    commandId: delivery.envelope.command.commandId,
    correlationId: delivery.envelope.command.correlationId,
    agentId,
    leaseId: delivery.leaseId,
    sequence,
    status,
    messageCode,
    evidence,
    evidenceHash: hashCanonicalPayload(evidence),
    occurredAt: now.toISOString(),
  };
  return unsigned;
}

describe("RuntimeRepository credentials and event evidence", () => {
  it("stores only a credential hash and supports rotation and revocation", async () => {
    const credentials = await database.query<{ token_hash: string; token_last_four: string }>(
      "SELECT token_hash, token_last_four FROM agent_credentials WHERE agent_id = $1",
      [agentId],
    );
    expect(credentials[0].token_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(credentials[0].token_hash).not.toContain(agentToken);
    expect(credentials[0].token_last_four).toBe(agentToken.slice(-4));
    await expect(repository.enrollAgent(client, {
      displayName: "Forbidden",
      agentVersion: "1.0.0",
      protocolVersion: "1.0",
      capabilities: [],
    })).rejects.toMatchObject({ code: "FORBIDDEN" });

    const rotated = await repository.rotateAgentCredential(staff, agentId);
    expect(await repository.authenticateAgentToken(agentToken)).toBeNull();
    expect(await repository.authenticateAgentToken(rotated.token)).not.toBeNull();
    await repository.revokeAgent(staff, agentId);
    expect(await repository.authenticateAgentToken(rotated.token)).toBeNull();
    await expectCanonicalAgentAudits();
  });

  it("serializes concurrent credential rotations to one active credential", async () => {
    const rotations = await Promise.allSettled([
      repository.rotateAgentCredential(staff, agentId),
      repository.rotateAgentCredential(staff, agentId),
    ]);
    const returnedTokens = rotations.flatMap((result) => result.status === "fulfilled" ? [result.value.token] : []);
    expect(returnedTokens.length).toBeGreaterThan(0);
    const active = await database.query<{ id: string }>(
      "SELECT id FROM agent_credentials WHERE agent_id = $1 AND revoked_at IS NULL",
      [agentId],
    );
    expect(active).toHaveLength(1);
    const authenticationResults = await Promise.all(
      returnedTokens.map((token) => repository.authenticateAgentToken(token)),
    );
    expect(authenticationResults.filter(Boolean)).toHaveLength(1);
  });

  it("serializes revocation against rotation and never leaves a disabled agent credential active", async () => {
    const results = await Promise.allSettled([
      repository.revokeAgent(staff, agentId),
      repository.rotateAgentCredential(staff, agentId),
    ]);
    const [agent] = await database.query<{ status: string }>(
      "SELECT status FROM agent_installations WHERE id = $1",
      [agentId],
    );
    expect(agent.status).toBe("disabled");
    expect(await database.query("SELECT id FROM agent_credentials WHERE agent_id = $1 AND revoked_at IS NULL", [agentId])).toHaveLength(0);
    const returnedTokens = results.flatMap((result) => result.status === "fulfilled" && result.value
      ? [result.value.token]
      : []);
    for (const token of returnedTokens) expect(await repository.authenticateAgentToken(token)).toBeNull();
    await expect(repository.rotateAgentCredential(staff, agentId)).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("rolls back credential and snapshot state when runtime audit evidence cannot be written", async () => {
    const failingRepository = new RuntimeRepository(withFailingAuditWrites(database), () => now);
    await expect(failingRepository.rotateAgentCredential(staff, agentId)).rejects.toThrow("injected audit write failure");
    expect(await repository.authenticateAgentToken(agentToken)).not.toBeNull();
    expect(await database.query("SELECT id FROM agent_credentials WHERE agent_id = $1 AND revoked_at IS NULL", [agentId])).toHaveLength(1);

    await expect(failingRepository.recordRuntimeSnapshot(identity, snapshot(1))).rejects.toThrow("injected audit write failure");
    expect(await database.query("SELECT id FROM agent_events")).toHaveLength(0);
    expect(await database.query("SELECT id FROM runtime_account_observations")).toHaveLength(0);
    expect(await database.query("SELECT id FROM runtime_strategy_observations")).toHaveLength(0);
  });

  it("stores immutable snapshots, exact replays, minimized DTOs, and audit hashes", async () => {
    const event = snapshot(1);
    expect((await repository.recordRuntimeSnapshot(identity, event)).duplicate).toBe(false);
    expect((await repository.recordRuntimeSnapshot(identity, event)).duplicate).toBe(true);
    const latest = await repository.getLatestRuntimeSnapshot(staff, agentId);
    expect(latest).toMatchObject({
      stateVersion: event.payload.stateVersion,
      collectionMode: "supervised_simulation",
      accounts: [{ masked_identifier: "****1234", account_type: "evaluation" }],
      strategies: [{ enabled: true, sync: true, runtime_state: "running" }],
    });
    expect(latest?.accounts[0]).not.toHaveProperty("identifier_fingerprint");
    expect(await database.query("SELECT id FROM agent_events")).toHaveLength(1);
    const audit = await database.query<{ metadata: Record<string, unknown> }>(
      "SELECT metadata FROM audit_events WHERE action = 'agent.runtime_snapshot_recorded'",
    );
    expect(audit[0].metadata).toMatchObject({
      payloadHash: event.payloadHash,
      envelopeHash: event.envelopeHash,
      accountCount: 1,
      strategyCount: 1,
    });
    await expectCanonicalAgentAudits();
  });

  it("rejects gaps, stale events, and conflicting replays without partial writes", async () => {
    await expect(repository.recordAgentEvent(identity, snapshot(2))).rejects.toMatchObject({ code: "SEQUENCE_GAP" });
    expect(await database.query("SELECT id FROM agent_events")).toHaveLength(0);
    const first = snapshot(1);
    await repository.recordAgentEvent(identity, first);
    await expect(repository.recordAgentEvent(identity, snapshot(1, {
      eventId: uuid("50000000", 99),
    }))).rejects.toMatchObject({ code: "SEQUENCE_STALE" });
    await expect(repository.recordAgentEvent(identity, snapshot(1, {
      eventId: first.eventId,
      connectionStatus: "disconnected",
    }))).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await database.query("SELECT id FROM runtime_account_observations")).toHaveLength(1);
  });

  it("derives tenant identity from the credential and rejects future agent clocks", async () => {
    await expect(repository.recordAgentEvent(
      { ...identity, organizationId: otherOrgId },
      snapshot(1),
    )).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    const future = new Date(now.getTime() + 6 * 60 * 1000).toISOString();
    await expect(repository.recordAgentEvent(identity, snapshot(1, {
      occurredAt: future,
    }))).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await repository.getLatestRuntimeSnapshot(otherStaff, agentId)).toBeNull();
  });

  it("derives stale health from server receipt time rather than the agent clock", async () => {
    await repository.recordAgentEvent(identity, heartbeat(1));
    expect((await repository.listAgents(staff))[0].effectiveStatus).toBe("online");
    now = new Date(now.getTime() + 3 * 60 * 1000);
    expect((await repository.listAgents(staff))[0].effectiveStatus).toBe("stale");
  });

  it("preserves degraded Add-On health across snapshots and separates contact from heartbeat freshness", async () => {
    await repository.recordAgentEvent(identity, heartbeat(1, {
      health: "degraded",
      addonConnected: false,
      agentVersion: "1.1.0",
    }));
    await repository.recordRuntimeSnapshot(identity, snapshot(2));
    let agent = (await repository.listAgents(staff))[0];
    expect(agent).toMatchObject({
      effectiveStatus: "degraded",
      agentVersion: "1.1.0",
      addonConnected: false,
      addonVersion: "1.0.0",
      lastEventSequence: 2,
    });

    now = new Date(now.getTime() + 3 * 60 * 1000);
    expect(await repository.authenticateAgentToken(agentToken)).not.toBeNull();
    agent = (await repository.listAgents(staff))[0];
    expect(agent.effectiveStatus).toBe("stale");
    expect(agent.lastContactAt?.getTime()).toBe(now.getTime());
    expect(agent.lastHeartbeatAt?.getTime()).toBeLessThan(now.getTime());
  });

  it("atomically persists and audits authenticated process evidence without raw process identity", async () => {
    const event = heartbeat(1, { processObservation: runningProcessObservation() });
    const recorded = await repository.recordAgentEvent(identity, event);
    const agent = (await repository.listAgents(staff))[0];

    expect(agent.processObservation).toMatchObject({
      evidenceEventId: recorded.eventRecordId,
      evidenceSequence: 1,
      installationRef: "install_1234567890abcdef",
      state: "running",
      processStateVersion: "sha256:" + "a".repeat(64),
      processRef: "process_" + "b".repeat(64),
      matchedProcessCount: 1,
      unavailableReason: null,
      freshness: {
        status: "fresh",
        ageMs: 0,
        maxAgeMs: 45_000,
      },
    });
    expect(agent.processObservation?.observedAt.toISOString()).toBe(now.toISOString());
    expect(agent.processObservation?.receivedAt.toISOString()).toBe(now.toISOString());
    expect(agent.processObservation?.freshness.expiresAt.toISOString()).toBe(
      new Date(now.getTime() + 45_000).toISOString(),
    );
    expect(JSON.stringify(agent.processObservation)).not.toContain("NinjaTrader.exe");
    const audit = await database.query<{ metadata: Record<string, unknown> }>(
      "SELECT metadata FROM audit_events WHERE action = 'agent.process_observation_recorded'",
    );
    expect(audit).toHaveLength(1);
    expect(audit[0].metadata).toMatchObject({
      eventId: event.eventId,
      sequence: 1,
      state: "running",
      processRef: "process_" + "b".repeat(64),
    });
    expect(JSON.stringify(audit[0].metadata)).not.toContain("NinjaTrader.exe");
    await expectCanonicalAgentAudits();
  });

  it("retains process evidence across legacy heartbeats but visibly expires its freshness", async () => {
    await repository.recordAgentEvent(identity, heartbeat(1, {
      processObservation: runningProcessObservation(),
    }));
    now = new Date(now.getTime() + 46_000);
    await repository.recordAgentEvent(identity, heartbeat(2));

    const agent = (await repository.listAgents(staff))[0];
    expect(agent.effectiveStatus).toBe("online");
    expect(agent.processObservation).toMatchObject({
      evidenceSequence: 1,
      state: "running",
      freshness: { status: "stale", ageMs: 46_000, maxAgeMs: 45_000 },
    });
    expect(agent.processObservation?.freshness.expiresAt.getTime()).toBeLessThan(now.getTime());
  });

  it("rolls back process evidence, sequence, and event when its audit cannot commit", async () => {
    const failingRepository = new RuntimeRepository(withFailingAuditWrites(database), () => now);
    await expect(failingRepository.recordAgentEvent(identity, heartbeat(1, {
      processObservation: runningProcessObservation(),
    }))).rejects.toThrow("injected audit write failure");

    expect(await database.query("SELECT id FROM agent_events")).toHaveLength(0);
    const [agent] = await database.query<{
      last_event_sequence: number;
      process_evidence_event_id: string | null;
    }>("SELECT last_event_sequence, process_evidence_event_id FROM agent_installations WHERE id = $1", [agentId]);
    expect(Number(agent.last_event_sequence)).toBe(0);
    expect(agent.process_evidence_event_id).toBeNull();
  });

  it("enforces process evidence consistency in the database and reapplies migration 0008", async () => {
    await repository.recordAgentEvent(identity, heartbeat(1, {
      processObservation: runningProcessObservation(),
    }));
    await expect(database.query(
      "UPDATE agent_installations SET process_ref = NULL WHERE id = $1",
      [agentId],
    )).rejects.toThrow();

    const migration = await readFile(
      new URL("../../../migrations/0008_process_observation_heartbeat.sql", import.meta.url),
      "utf8",
    );
    await expect(database.exec(migration)).resolves.toBeUndefined();
    await expect(database.exec(migration)).resolves.toBeUndefined();
    expect((await repository.listAgents(staff))[0].processObservation).toMatchObject({
      evidenceSequence: 1,
      state: "running",
    });
  });

  it("keeps account fingerprints and strategy identities immutable across snapshots", async () => {
    await repository.recordRuntimeSnapshot(identity, snapshot(1));
    await repository.recordRuntimeSnapshot(identity, snapshot(2, { connectionStatus: "disconnected" }));
    await expect(repository.recordRuntimeSnapshot(identity, snapshot(3, {
      identifierFingerprint: "hmac-sha256:" + "b".repeat(64),
    }))).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(repository.recordRuntimeSnapshot(identity, snapshot(3, {
      strategyType: "DifferentStrategy",
    }))).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await database.query("SELECT id FROM agent_events")).toHaveLength(2);
    expect(await database.query("SELECT id FROM runtime_account_identities")).toHaveLength(1);
    expect(await database.query("SELECT id FROM runtime_strategy_identities")).toHaveLength(1);
  });

  it("ingests v2 events in sequence, accepts exact replay, and rejects hash tampering", async () => {
    await expect(repository.recordAgentEvent(identity, runtimeObservationV2(2))).rejects.toMatchObject({
      code: "SEQUENCE_GAP",
    });
    const event = runtimeObservationV2(1);
    expect(await repository.recordAgentEvent(identity, event)).toMatchObject({
      duplicate: false,
      acceptedSequence: 1,
    });
    expect(await repository.recordAgentEvent(identity, event)).toMatchObject({
      duplicate: true,
      acceptedSequence: 1,
    });

    const tampered = structuredClone(runtimeObservationV2(2));
    tampered.payload.freshness.ageMs = 1;
    await expect(repository.recordAgentEvent(identity, tampered)).rejects.toThrow(
      "Agent event payload hash does not match its contents",
    );
    expect(await database.query("SELECT id FROM agent_events")).toHaveLength(1);
    await expectCanonicalAgentAudits();
  });

  it("binds v2 identities without fabricating legacy observations and rejects changed bindings", async () => {
    await repository.recordAgentEvent(identity, runtimeObservationV2(1));
    expect(await database.query("SELECT id FROM runtime_account_observations")).toHaveLength(0);
    expect(await database.query("SELECT id FROM runtime_strategy_observations")).toHaveLength(0);
    expect(await database.query("SELECT id FROM runtime_account_identities")).toHaveLength(1);
    expect(await database.query("SELECT id FROM runtime_strategy_identities")).toHaveLength(1);

    await expect(repository.recordAgentEvent(identity, runtimeObservationV2(2, {
      identifierFingerprint: "hmac-sha256:" + "b".repeat(64),
    }))).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(repository.recordAgentEvent(identity, runtimeObservationV2(2, {
      strategyTypeCode: "DIFFERENT_STRATEGY",
    }))).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await database.query("SELECT id FROM agent_events")).toHaveLength(1);
    expect((await repository.listAgents(staff))[0].lastEventSequence).toBe(1);
  });

  it("preserves exact account and strategy identity bindings from v1 snapshots into v2 observations", async () => {
    await repository.recordRuntimeSnapshot(identity, snapshot(1, {
      strategyType: "Steady",
    }));
    const v2 = runtimeObservationV2(2, {
      strategyTypeCode: "Steady",
    });
    await expect(repository.recordAgentEvent(identity, v2)).resolves.toMatchObject({
      duplicate: false,
      acceptedSequence: 2,
    });

    expect(await database.query("SELECT id FROM runtime_account_identities")).toHaveLength(1);
    expect(await database.query("SELECT id FROM runtime_strategy_identities")).toHaveLength(1);
    await expect(repository.getLatestRuntimeObservationV2(staff, agentId)).resolves.toMatchObject({
      eventId: v2.eventId,
      sequence: 2,
      observation: {
        state: {
          strategies: [{ strategyTypeCode: "Steady" }],
        },
      },
    });
  });

  it("rejects a v2 strategy identity when only the case of the v1 strategy type changes", async () => {
    await repository.recordRuntimeSnapshot(identity, snapshot(1, {
      strategyType: "Steady",
    }));
    await expect(repository.recordAgentEvent(identity, runtimeObservationV2(2, {
      strategyTypeCode: "steady",
    }))).rejects.toMatchObject({ code: "CONFLICT" });

    expect(await database.query("SELECT id FROM agent_events")).toHaveLength(1);
    expect(await database.query("SELECT id FROM runtime_account_identities")).toHaveLength(1);
    expect(await database.query("SELECT id FROM runtime_strategy_identities")).toHaveLength(1);
    expect(await repository.getLatestRuntimeObservationV2(staff, agentId)).toBeNull();
  });

  it("strictly reads the latest full v2 event within tenant and role boundaries", async () => {
    expect(await repository.getLatestRuntimeObservationV2(staff, agentId)).toBeNull();
    await repository.recordAgentEvent(identity, runtimeObservationV2(1));
    const event = runtimeObservationV2(2);
    await repository.recordAgentEvent(identity, event);
    const latest = await repository.getLatestRuntimeObservationV2(staff, agentId);
    expect(latest).toMatchObject({
      protocolVersion: "1.0",
      eventType: "runtime.observation_v2",
      eventId: event.eventId,
      agentId,
      sequence: 2,
      payloadHash: event.payloadHash,
      envelopeHash: event.envelopeHash,
      observation: {
        observationId: event.payload.observationId,
        stateDigest: event.payload.stateDigest,
        state: {
          accounts: [{
            accountRef: "acct_1234567890abcdef",
            maskedIdentifier: "****m101",
          }],
          strategies: [{ strategyTypeCode: "VINCERE_STEADY" }],
        },
      },
    });
    expect(latest?.occurredAt.toISOString()).toBe(event.occurredAt);
    expect(latest?.receivedAt).toBeInstanceOf(Date);
    expect(JSON.stringify(latest)).not.toContain("Sim101");
    expect(await repository.getLatestRuntimeObservationV2(otherStaff, agentId)).toBeNull();
    await expect(repository.getLatestRuntimeObservationV2(client, agentId)).resolves.toMatchObject({
      eventId: event.eventId,
    });

    process.env.NINJA_MANAGER_MODE = "CENTRAL_CONNECTED";
    // Staff (fleet operator) read authoritative runtime evidence in central via
    // fleet.runtime; clients stay private until a scope-bound OTP grant exists.
    await expect(repository.getLatestRuntimeObservationV2(staff, agentId)).resolves.toMatchObject({
      eventId: event.eventId,
    });
    await expect(repository.getLatestRuntimeObservationV2(client, agentId)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("fails closed when stored v2 evidence no longer matches its authenticated hashes", async () => {
    const event = runtimeObservationV2(1);
    await repository.recordAgentEvent(identity, event);
    const tamperedPayload = structuredClone(event.payload);
    tamperedPayload.freshness.ageMs = 1;
    await database.query(
      "UPDATE agent_events SET payload = $1::jsonb WHERE agent_id = $2 AND event_id = $3",
      [JSON.stringify(tamperedPayload), agentId, event.eventId],
    );
    await expect(repository.getLatestRuntimeObservationV2(staff, agentId)).rejects.toThrow(
      "Agent event payload hash does not match its contents",
    );
  });

  it("deduplicates commands by semantic intent and enforces state, issue-time, and expiry gates", async () => {
    const runtimeSnapshot = snapshot(1);
    await repository.recordRuntimeSnapshot(identity, runtimeSnapshot);
    const firstCommand = command(1, { expectedStateVersion: runtimeSnapshot.payload.stateVersion });
    const first = await repository.enqueueReadOnlyCommand(staff, firstCommand);
    const retry = command(2, {
      idempotencyKey: firstCommand.idempotencyKey,
      commandId: uuid("60000000", 2),
      correlationId: uuid("61000000", 2),
      issuedAt: new Date(now.getTime() + 1_000).toISOString(),
      expiresAt: new Date(now.getTime() + 5 * 60 * 1000 + 1_000).toISOString(),
      expectedStateVersion: runtimeSnapshot.payload.stateVersion,
    });
    const duplicate = await repository.enqueueReadOnlyCommand(staff, retry);
    expect(duplicate).toMatchObject({
      duplicate: true,
      id: first.id,
      commandId: firstCommand.commandId,
      correlationId: firstCommand.correlationId,
    });
    await expect(repository.enqueueReadOnlyCommand(staff, command(3, {
      idempotencyKey: firstCommand.idempotencyKey,
      expectedStateVersion: runtimeSnapshot.payload.stateVersion,
      include: ["accounts"],
    }))).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(repository.enqueueReadOnlyCommand(staff, command(4, {
      expectedStateVersion: "sha256:" + "f".repeat(64),
    }))).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(repository.enqueueReadOnlyCommand(staff, command(5, {
      issuedAt: new Date(now.getTime() - 10 * 60 * 1000).toISOString(),
      expiresAt: new Date(now.getTime() - 5 * 60 * 1000).toISOString(),
    }))).rejects.toMatchObject({ code: "COMMAND_EXPIRED" });
    await expect(repository.enqueueReadOnlyCommand(staff, command(6, {
      issuedAt: new Date(now.getTime() + 31_000).toISOString(),
      expiresAt: new Date(now.getTime() + 5 * 60 * 1000 + 31_000).toISOString(),
    }))).rejects.toMatchObject({ code: "CONFLICT" });
    process.env.NINJA_MANAGER_MODE = "CENTRAL_CONNECTED";
    // Staff queue read-only commands in central via fleet.runtime; clients cannot.
    await expect(repository.enqueueReadOnlyCommand(staff, command(7, {
      expectedStateVersion: runtimeSnapshot.payload.stateVersion,
    }))).resolves.toMatchObject({ status: "queued", duplicate: false });
    await expect(repository.enqueueReadOnlyCommand(client, command(8))).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("allows a LOCAL_ONLY client to read inventory and queue only the versioned read-only command", async () => {
    process.env.NINJA_MANAGER_MODE = "CENTRAL_CONNECTED";
    await expect(repository.listAgents(client)).rejects.toMatchObject({ code: "FORBIDDEN" });
    // Staff list the fleet in central via fleet.runtime; the client operator cannot.
    await expect(repository.listAgents(staff)).resolves.toMatchObject([{ id: agentId }]);
    await expect(repository.getLatestRuntimeSnapshot(client, agentId)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(repository.listCommands(client, agentId)).rejects.toMatchObject({ code: "FORBIDDEN" });

    process.env.NINJA_MANAGER_MODE = "LOCAL_ONLY";
    process.env.NINJA_MANAGER_BIND_HOST = "127.0.0.1";
    process.env.PORT = "3000";
    process.env.APP_URL = "http://127.0.0.1:3000";
    await repository.recordAgentEvent(identity, heartbeat(1));
    const runtimeSnapshot = snapshot(2);
    await repository.recordRuntimeSnapshot(identity, runtimeSnapshot);

    await expect(repository.listAgents(client)).resolves.toMatchObject([
      { id: agentId, effectiveStatus: "online", addonConnected: true },
    ]);
    await expect(repository.getLatestRuntimeSnapshot(client, agentId)).resolves.toMatchObject({
      stateVersion: runtimeSnapshot.payload.stateVersion,
      accounts: [{ masked_identifier: "****1234" }],
      strategies: [{ strategy_type: "VincereSteady" }],
    });

    await expect(repository.enqueueReadOnlyCommand(client, command(70, {
      expectedStateVersion: runtimeSnapshot.payload.stateVersion,
    }))).resolves.toMatchObject({ status: "queued", duplicate: false });
    await expect(repository.listCommands(client, agentId)).resolves.toMatchObject([
      { commandType: "DISCOVER_RUNTIME_STATE", status: "queued" },
    ]);
  });

  it("scopes LOCAL_ONLY agent inventory and commands to the owning client", async () => {
    const otherClientUserId = "30000000-0000-4000-8000-000000000002";
    const otherClientRecordId = "31000000-0000-4000-8000-000000000002";
    const otherEnvironmentId = "32000000-0000-4000-8000-000000000002";
    const otherAgentId = "40000000-0000-4000-8000-000000000002";
    await database.query(
      "INSERT INTO users (id, organization_id, email, name, password_hash, role) VALUES ($1, $2, 'peer@test.local', 'Peer', 'hash', 'client')",
      [otherClientUserId, orgId],
    );
    await database.query(
      "INSERT INTO clients (id, organization_id, user_id, display_name, created_by) VALUES ($1, $2, $3, 'Peer', $4)",
      [otherClientRecordId, orgId, otherClientUserId, staffId],
    );
    await database.query(
      "INSERT INTO environments (id, organization_id, client_id, vps_provider, vps_region, ninja_version) VALUES ($1, $2, $3, 'local', 'local', '8')",
      [otherEnvironmentId, orgId, otherClientRecordId],
    );
    await database.query(
      "INSERT INTO agent_installations (id, organization_id, environment_id, display_name, agent_version, protocol_version, capabilities, created_by) VALUES ($1, $2, $3, 'Peer VPS', '1.0.0', '1.0', $4::jsonb, $5)",
      [otherAgentId, orgId, otherEnvironmentId, JSON.stringify(["runtime.discovery"]), staffId],
    );

    await expect(repository.listAgents(client)).resolves.toMatchObject([{ id: agentId }]);
    await expect(repository.getLatestRuntimeSnapshot(client, otherAgentId)).rejects.toMatchObject({
      code: "AGENT_NOT_FOUND",
    });
    await expect(repository.getLatestRuntimeObservationV2(client, otherAgentId)).rejects.toMatchObject({
      code: "AGENT_NOT_FOUND",
    });
    await expect(repository.listCommands(client, otherAgentId)).rejects.toMatchObject({
      code: "AGENT_NOT_FOUND",
    });
    await expect(repository.enqueueReadOnlyCommand(client, command(71, {
      agentId: otherAgentId,
    }))).rejects.toMatchObject({ code: "AGENT_NOT_FOUND" });
  });

  it("leases queued commands durably and redelivers the same command after a lost lease", async () => {
    const queued = command(1);
    await repository.enqueueReadOnlyCommand(staff, queued);
    const firstLease = await repository.leaseCommands(identity);
    expect(firstLease).toHaveLength(1);
    expect(firstLease[0]).toMatchObject({
      deliveryAttempt: 1,
      envelope: {
        command: { commandId: queued.commandId, dryRun: true },
        integrity: { canonicalization: "RFC8785" },
      },
    });
    expect(await repository.leaseCommands(identity)).toHaveLength(0);
    now = new Date(now.getTime() + 31_000);
    const redelivery = await repository.leaseCommands(identity);
    expect(redelivery).toHaveLength(1);
    expect(redelivery[0]).toMatchObject({
      deliveryAttempt: 2,
      envelope: { command: { commandId: queued.commandId } },
    });
    expect(redelivery[0].leaseId).not.toBe(firstLease[0].leaseId);
    expect(await database.query("SELECT id FROM command_deliveries")).toHaveLength(2);
  });

  it("quarantines every stored-command integrity mismatch before delivery", async () => {
    const mutations: Array<(commandId: string) => Promise<unknown>> = [
      (commandId) => database.query(
        "UPDATE agent_commands SET payload = $1::jsonb WHERE command_id = $2",
        [JSON.stringify({
          include: ["accounts"],
          forceFullSnapshot: true,
          reasonCode: "STAFF_RUNTIME_REFRESH",
        }), commandId],
      ),
      (commandId) => database.query(
        "UPDATE agent_commands SET payload_hash = $1 WHERE command_id = $2",
        ["sha256:" + "0".repeat(64), commandId],
      ),
      (commandId) => database.query(
        "UPDATE agent_commands SET semantic_hash = $1 WHERE command_id = $2",
        ["sha256:" + "0".repeat(64), commandId],
      ),
      (commandId) => database.query(
        "UPDATE agent_commands SET correlation_id = $1 WHERE command_id = $2",
        [uuid("61000000", 99), commandId],
      ),
      (commandId) => database.query(
        "UPDATE agent_commands SET envelope_hash = $1 WHERE command_id = $2",
        ["sha256:" + "0".repeat(64), commandId],
      ),
    ];

    for (let index = 0; index < mutations.length; index += 1) {
      const queued = command(index + 1);
      await repository.enqueueReadOnlyCommand(staff, queued);
      await mutations[index](queued.commandId);
      expect(await repository.leaseCommands(identity)).toHaveLength(0);
      const [stored] = await database.query<{ status: string; delivery_attempts: number }>(
        "SELECT status, delivery_attempts FROM agent_commands WHERE command_id = $1",
        [queued.commandId],
      );
      expect(stored).toMatchObject({ status: "indeterminate", delivery_attempts: 0 });
    }
    expect(await database.query("SELECT id FROM command_deliveries")).toHaveLength(0);
    expect(await database.query(
      "SELECT id FROM audit_events WHERE action = 'agent.command_integrity_failed'",
    )).toHaveLength(mutations.length);
  });

  it("rejects acknowledgements that predate delivery or use an expired superseded lease", async () => {
    await repository.enqueueReadOnlyCommand(staff, command(1));
    const [firstLease] = await repository.leaseCommands(identity);
    const predating = {
      ...acknowledgement(firstLease, 1, "accepted", 1),
      occurredAt: new Date(now.getTime() - 1_000).toISOString(),
    };
    await expect(repository.recordAcknowledgement(identity, predating)).rejects.toMatchObject({
      code: "INVALID_DELIVERY",
    });

    now = new Date(now.getTime() + 31_000);
    const [secondLease] = await repository.leaseCommands(identity);
    expect(secondLease.deliveryAttempt).toBe(2);
    await expect(repository.recordAcknowledgement(
      identity,
      acknowledgement(firstLease, 1, "accepted", 2),
    )).rejects.toMatchObject({ code: "INVALID_DELIVERY" });
    expect(await database.query("SELECT id FROM command_acknowledgements")).toHaveLength(0);
    expect((await repository.listCommands(staff, agentId))[0].status).toBe("queued");
  });

  it("rejects late forged timestamps but keeps exact acknowledgement replay idempotent", async () => {
    await repository.enqueueReadOnlyCommand(staff, command(1, {
      expiresAt: new Date(now.getTime() + 60_000).toISOString(),
    }));
    const [delivery] = await repository.leaseCommands(identity);
    const forgedBeforeExpiry = acknowledgement(delivery, 1, "accepted", 1);
    now = new Date(now.getTime() + 61_000);
    await expect(repository.recordAcknowledgement(identity, forgedBeforeExpiry)).rejects.toMatchObject({
      code: "COMMAND_EXPIRED",
    });
    expect(await database.query("SELECT id FROM command_acknowledgements")).toHaveLength(0);

    const secondCommand = command(2);
    await repository.enqueueReadOnlyCommand(staff, secondCommand);
    const [secondDelivery] = await repository.leaseCommands(identity);
    const accepted = acknowledgement(secondDelivery, 1, "accepted", 2);
    expect((await repository.recordAcknowledgement(identity, accepted)).duplicate).toBe(false);
    now = new Date(now.getTime() + 6 * 60 * 1000);
    expect((await repository.recordAcknowledgement(identity, accepted)).duplicate).toBe(true);
  });

  it("persists ordered acknowledgements, exact duplicates, and partial terminal evidence", async () => {
    await repository.enqueueReadOnlyCommand(staff, command(1));
    const [delivery] = await repository.leaseCommands(identity);
    const accepted = acknowledgement(delivery, 1, "accepted", 1, {
      resultEventIds: [uuid("50000000", 1)],
    });
    expect(await repository.recordAcknowledgement(identity, accepted)).toMatchObject({
      duplicate: false,
      status: "accepted",
    });
    expect(await repository.recordAcknowledgement(identity, accepted)).toMatchObject({
      duplicate: true,
      status: "accepted",
    });
    const conflictingEvidence = { ...accepted.evidence, retrySafe: true };
    await expect(repository.recordAcknowledgement(identity, {
      ...accepted,
      evidence: conflictingEvidence,
      evidenceHash: hashCanonicalPayload(conflictingEvidence),
    })).rejects.toMatchObject({ code: "CONFLICT" });
    await repository.recordAcknowledgement(identity, acknowledgement(delivery, 2, "started", 2));
    await repository.recordAcknowledgement(identity, acknowledgement(delivery, 3, "partial", 3, {
      completedScopes: ["accounts"],
      failedScopes: ["strategies"],
      retrySafe: true,
    }));
    await expect(repository.recordAcknowledgement(
      identity,
      acknowledgement(delivery, 4, "completed", 4),
    )).rejects.toMatchObject({ code: "INVALID_TRANSITION" });

    expect((await repository.listCommands(staff, agentId))[0]).toMatchObject({
      status: "partial",
      lastAckSequence: 3,
    });
    const audit = await database.query<{ action: string }>(
      "SELECT action FROM audit_events WHERE entity_type = 'agent_command' ORDER BY created_at",
    );
    expect(audit.map((row) => row.action)).toEqual(expect.arrayContaining([
      "agent.command_queued",
      "agent.command_accepted",
      "agent.command_started",
      "agent.command_partial",
    ]));
  });

  it("rejects unknown leases and acknowledgement gaps without partial evidence", async () => {
    await repository.enqueueReadOnlyCommand(staff, command(1));
    const [delivery] = await repository.leaseCommands(identity);
    await expect(repository.recordAcknowledgement(
      identity,
      acknowledgement(delivery, 2, "accepted", 2),
    )).rejects.toMatchObject({ code: "SEQUENCE_GAP" });
    await expect(repository.recordAcknowledgement(identity, {
      ...acknowledgement(delivery, 1, "accepted", 1),
      leaseId: uuid("71000000", 99),
    })).rejects.toMatchObject({ code: "INVALID_DELIVERY" });
    expect(await database.query("SELECT id FROM command_acknowledgements")).toHaveLength(0);
    expect((await repository.listCommands(staff, agentId))[0].status).toBe("queued");
  });

  it("expires commands on the server and records the timeout evidence", async () => {
    await repository.enqueueReadOnlyCommand(staff, command(1, {
      expiresAt: new Date(now.getTime() + 60_000).toISOString(),
    }));
    now = new Date(now.getTime() + 2 * 60_000);
    expect(await repository.leaseCommands(identity)).toHaveLength(0);
    expect((await repository.listCommands(staff, agentId))[0].status).toBe("expired");
    const audit = await database.query<{ action: string }>(
      "SELECT action FROM audit_events WHERE action = 'agent.command_expired'",
    );
    expect(audit).toHaveLength(1);
  });

  it("persists large authoritative inventories in bounded batches", async () => {
    await repository.recordRuntimeSnapshot(identity, snapshot(1, { strategyCount: 401 }));
    expect(await database.query("SELECT id FROM runtime_strategy_observations")).toHaveLength(401);
    expect((await repository.getLatestRuntimeSnapshot(staff, agentId))?.strategies).toHaveLength(401);
  });
});
