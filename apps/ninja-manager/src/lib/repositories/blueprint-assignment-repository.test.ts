import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createDatabaseClient, type DatabaseClient, type DatabaseTransaction } from "@/lib/db/client";
import { migrateDatabase } from "@/lib/db/migrate";
import {
  blueprintCanonicalPreviewHash,
  type BlueprintAssignmentPreview,
} from "@/lib/domain/blueprint-import-contracts";
import { hashCanonicalPayload } from "@/lib/domain/runtime-contracts";
import {
  runtimeObservationV2StateDigest,
  type RuntimeObservationV2State,
} from "@/lib/domain/runtime-observation-v2";
import type { AuthenticatedUser } from "@/lib/domain/types";
import { RuntimeRepository, type AgentIdentity } from "./runtime-repository";
import { BlueprintAssignmentRepository } from "./blueprint-assignment-repository";

const orgId = "10000000-0000-4000-8000-000000000001";
const otherOrgId = "10000000-0000-4000-8000-000000000002";
const staffId = "20000000-0000-4000-8000-000000000001";
const clientId = "20000000-0000-4000-8000-000000000002";
const otherStaffId = "20000000-0000-4000-8000-000000000003";
const peerClientId = "20000000-0000-4000-8000-000000000004";
const agentId = "30000000-0000-4000-8000-000000000001";
const peerAgentId = "30000000-0000-4000-8000-000000000002";
const clientRecordId = "50000000-0000-4000-8000-000000000001";
const peerClientRecordId = "50000000-0000-4000-8000-000000000002";
const environmentId = "60000000-0000-4000-8000-000000000001";
const peerEnvironmentId = "60000000-0000-4000-8000-000000000002";
const originalEnvironment = {
  mode: process.env.NINJA_MANAGER_MODE,
  bindHost: process.env.NINJA_MANAGER_BIND_HOST,
  appUrl: process.env.APP_URL,
  port: process.env.PORT,
};

const staff: AuthenticatedUser = {
  id: staffId, organizationId: orgId, email: "staff@test.local", name: "Staff", role: "staff",
};
const client: AuthenticatedUser = {
  id: clientId, organizationId: orgId, email: "client@test.local", name: "Client", role: "client",
};
const otherStaff: AuthenticatedUser = {
  id: otherStaffId, organizationId: otherOrgId, email: "other@test.local", name: "Other", role: "staff",
};
const peerClient: AuthenticatedUser = {
  id: peerClientId, organizationId: orgId, email: "peer@test.local", name: "Peer", role: "client",
};

const assignments: BlueprintAssignmentPreview[] = [{
  period: "PERIOD_1",
  accountLabel: "Lucid #1",
  propFirm: "Lucid",
  stackLevel: 1,
  strategy: "RBO",
  instrument: "MNQ",
  sourceRow: 2,
  sourceSlot: 1,
}, {
  period: "PERIOD_1",
  accountLabel: "Lucid #2",
  propFirm: "Lucid",
  stackLevel: 1,
  strategy: "ARPD",
  instrument: "MES",
  sourceRow: 3,
  sourceSlot: 1,
}];

const preview = {
  version: "blueprint-preview/1.0" as const,
  valid: true,
  source: {
    filename: "Vincere_Blueprint.xlsx",
    sheetName: "Cycling Blueprint" as const,
    workbookSha256: `sha256:${"a".repeat(64)}`,
  },
  canonicalPreviewHash: blueprintCanonicalPreviewHash(assignments),
  dataRowCount: 2,
  assignmentCount: assignments.length,
  assignments,
  warnings: [],
  errors: [],
};

let database: DatabaseClient;
let runtimeRepository: RuntimeRepository;
let repository: BlueprintAssignmentRepository;
let identity: AgentIdentity;
let now: Date;
let sequence: number;

function uuid(namespace: string, value: number): string {
  return `${namespace}-0000-4000-8000-${String(value).padStart(12, "0")}`;
}

function completeScope(itemCount: number) {
  return { status: "complete" as const, itemCount, errors: [] };
}

function unavailableScope() {
  return {
    status: "unavailable" as const,
    itemCount: 0,
    errors: [{ code: "CAPABILITY_UNSUPPORTED" as const, retryable: false }],
  };
}

function state(mutate?: (value: RuntimeObservationV2State) => void): RuntimeObservationV2State {
  const value: RuntimeObservationV2State = {
    process: null,
    addon: {
      addonRef: "addon_1234567890abcdef",
      status: "connected",
      health: "healthy",
      version: "1.0.0",
      ipcAuthenticated: true,
      capabilities: [],
    },
    connections: [{
      connectionRef: "conn_1234567890abcdef",
      displayLabel: "Connection 1",
      kind: "brokerage",
      providerCode: "TRADOVATE",
      status: "connected",
      health: "healthy",
      marketDataStatus: "live",
      lastStateChangeAt: null,
    }],
    accounts: [{
      accountRef: "acct_1234567890abcdef",
      maskedIdentifier: "****m101",
      identifierFingerprint: `hmac-sha256:${"a".repeat(64)}`,
      displayLabel: "Simulation account 1",
      classification: {
        environment: "simulation",
        authority: "authoritative",
        source: "ninjatrader_simulation_account",
      },
      connectionRefs: ["conn_1234567890abcdef"],
      status: "connected",
    }, {
      accountRef: "acct_2234567890abcdef",
      maskedIdentifier: "****m102",
      identifierFingerprint: `hmac-sha256:${"b".repeat(64)}`,
      displayLabel: "Simulation account 2",
      classification: {
        environment: "simulation",
        authority: "authoritative",
        source: "ninjatrader_simulation_account",
      },
      connectionRefs: ["conn_1234567890abcdef"],
      status: "connected",
    }],
    strategies: [{
      strategyRef: "strat_1234567890abcdef",
      accountRef: "acct_1234567890abcdef",
      displayLabel: "Strategy 1",
      strategyTypeCode: "RBO",
      instrumentCode: "MNQ",
      enabled: false,
      runtimeState: "disabled",
      synchronizationState: "not_applicable",
      operationalParameters: [],
      lastStateChangeAt: null,
    }, {
      strategyRef: "strat_2234567890abcdef",
      accountRef: "acct_2234567890abcdef",
      displayLabel: "Strategy 2",
      strategyTypeCode: "ARPD",
      instrumentCode: "MES",
      enabled: false,
      runtimeState: "disabled",
      synchronizationState: "not_applicable",
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
        addon: completeScope(1),
        connections: completeScope(1),
        accounts: completeScope(2),
        strategies: completeScope(2),
        positions: completeScope(0),
        orders: completeScope(0),
        executions: completeScope(0),
        pnl: unavailableScope(),
      },
    },
  };
  mutate?.(value);
  return value;
}

function sequentialBindingState(): RuntimeObservationV2State {
  return state((value) => {
    for (const scope of ["accounts", "connections", "strategies"] as const) {
      value.collection.scopes[scope] = {
        status: "partial",
        itemCount: value.collection.scopes[scope].itemCount,
        errors: [{ code: "CAPABILITY_UNSUPPORTED", retryable: false }],
      };
    }
  });
}

function runtimeEvent(options: {
  state?: RuntimeObservationV2State;
  asOf?: string;
  occurredAt?: string;
  ageMs?: number;
} = {}) {
  sequence += 1;
  const runtimeState = options.state ?? state();
  const payload = {
    protocolVersion: "runtime-observation/2.0" as const,
    observationId: uuid("41000000", sequence),
    source: {
      collector: "vps_companion_agent" as const,
      authority: "ninjatrader_runtime" as const,
      installationRef: "install_1234567890abcdef",
      collectionSessionRef: "session_1234567890abcdef",
    },
    asOf: options.asOf ?? now.toISOString(),
    freshness: {
      status: "fresh" as const,
      ageMs: options.ageMs ?? 0,
      maxAgeMs: 60_000,
    },
    stateDigest: runtimeObservationV2StateDigest(runtimeState),
    state: runtimeState,
  };
  const unsigned = {
    protocolVersion: "1.0" as const,
    eventId: uuid("42000000", sequence),
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

async function record(event = runtimeEvent()): Promise<void> {
  await runtimeRepository.recordAgentEvent(identity, event);
  await database.query(
    "UPDATE agent_events SET received_at = $1 WHERE organization_id = $2 AND agent_id = $3 AND event_id = $4",
    [now, orgId, agentId, event.eventId],
  );
}

function mappings() {
  return [{ accountLabel: "Lucid #1", accountRef: "acct_1234567890abcdef" }, {
    accountLabel: "Lucid #2", accountRef: "acct_2234567890abcdef",
  }];
}

async function stage(key = "blueprint:stage:test:0001") {
  return repository.stagePreview(staff, preview, { idempotencyKey: key });
}

async function commit(previewId: string, key = "blueprint:commit:test:0001") {
  return repository.commitMapping(staff, { previewId, agentId, idempotencyKey: key, mappings: mappings() });
}

function withFailingAuditWrites(client: DatabaseClient): DatabaseClient {
  return {
    query<T extends object>(sql: string, params?: unknown[]): Promise<T[]> { return client.query<T>(sql, params); },
    exec(sql: string): Promise<void> { return client.exec(sql); },
    transaction<T>(operation: (transaction: DatabaseTransaction) => Promise<T>): Promise<T> {
      return client.transaction((transaction) => operation({
        query<TRecord extends object>(sql: string, params?: unknown[]): Promise<TRecord[]> {
          if (/INSERT\s+INTO\s+audit_events/i.test(sql)) throw new Error("injected audit failure");
          return transaction.query<TRecord>(sql, params);
        },
        exec(sql: string): Promise<void> { return transaction.exec(sql); },
      }));
    },
    close(): Promise<void> { return client.close(); },
  };
}

beforeEach(async () => {
  process.env.NINJA_MANAGER_MODE = "LOCAL_ONLY";
  process.env.NINJA_MANAGER_BIND_HOST = "127.0.0.1";
  process.env.PORT = "3000";
  process.env.APP_URL = "http://127.0.0.1:3000";
  now = new Date("2026-07-21T16:00:00.000Z");
  sequence = 0;
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
      "($2, $4, 'client@test.local', 'Client', 'hash', 'client'),",
      "($3, $5, 'other@test.local', 'Other', 'hash', 'staff'),",
      "($6, $4, 'peer@test.local', 'Peer', 'hash', 'client')",
    ].join(" "),
    [staffId, clientId, otherStaffId, orgId, otherOrgId, peerClientId],
  );
  await database.query(
    [
      "INSERT INTO clients (id, organization_id, user_id, display_name, created_by) VALUES",
      "($1, $3, $4, 'Client', $5), ($2, $3, $6, 'Peer', $5)",
    ].join(" "),
    [clientRecordId, peerClientRecordId, orgId, clientId, staffId, peerClientId],
  );
  await database.query(
    [
      "INSERT INTO environments (id, organization_id, client_id, vps_provider, vps_region, ninja_version) VALUES",
      "($1, $3, $4, 'local', 'edith', '8'), ($2, $3, $5, 'local', 'edith-peer', '8')",
    ].join(" "),
    [environmentId, peerEnvironmentId, orgId, clientRecordId, peerClientRecordId],
  );
  runtimeRepository = new RuntimeRepository(database, () => now);
  repository = new BlueprintAssignmentRepository(database, () => now);
  const enrollment = await runtimeRepository.enrollAgent(staff, {
    id: agentId,
    environmentId,
    displayName: "Edith",
    agentVersion: "1.0.0",
    protocolVersion: "1.0",
    capabilities: ["runtime.discovery"],
  });
  const authenticated = await runtimeRepository.authenticateAgentToken(enrollment.token);
  if (!authenticated) throw new Error("Test agent authentication failed");
  identity = authenticated;
  await runtimeRepository.enrollAgent(staff, {
    id: peerAgentId,
    environmentId: peerEnvironmentId,
    displayName: "Peer VPS",
    agentVersion: "1.0.0",
    protocolVersion: "1.0",
    capabilities: ["runtime.discovery"],
  });
});

afterEach(async () => {
  await database.close();
  for (const [key, value] of Object.entries({
    NINJA_MANAGER_MODE: originalEnvironment.mode,
    NINJA_MANAGER_BIND_HOST: originalEnvironment.bindHost,
    APP_URL: originalEnvironment.appUrl,
    PORT: originalEnvironment.port,
  })) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("Blueprint assignment repository", () => {
  it("stages, binds the latest authoritative SIM evidence, and appends explicit approval", async () => {
    await record(runtimeEvent({ state: sequentialBindingState() }));
    const staged = await stage();
    expect(staged.duplicate).toBe(false);
    expect(staged.stagedPreview).toMatchObject({ assignmentCount: 2, uniqueAccountCount: 2, expired: false });
    expect(JSON.stringify(staged)).not.toContain("sha256:");

    const draft = await commit(staged.stagedPreview.previewId);
    expect(draft.revision).toMatchObject({ status: "draft", stateVersion: 1, agentId });
    expect(draft.revision.revisionRef).toMatch(/^assignment_rev_[a-z0-9]{16,64}$/);
    expect(JSON.stringify(draft)).not.toContain("sha256:");
    await expect(repository.commitMapping(client, {
      previewId: staged.stagedPreview.previewId,
      agentId,
      idempotencyKey: "blueprint:commit:test:0001",
      mappings: mappings(),
    })).rejects.toMatchObject({ code: "FORBIDDEN" });
    now = new Date(now.getTime() + 1_000);
    await record(runtimeEvent({ state: sequentialBindingState() }));
    const approved = await repository.approveRevision(staff, {
      revisionRef: draft.revision.revisionRef,
      expectedVersion: 1,
      idempotencyKey: "blueprint:approve:test:0001",
    });
    expect(approved.revision).toMatchObject({ status: "approved", stateVersion: 2 });
    await expect(repository.approveRevision(client, {
      revisionRef: draft.revision.revisionRef,
      expectedVersion: 1,
      idempotencyKey: "blueprint:approve:test:0001",
    })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await database.query("SELECT id FROM blueprint_assignment_revision_states")).toHaveLength(2);
    expect(await database.query("SELECT id FROM audit_events WHERE action LIKE 'blueprint.%'")).toHaveLength(3);
  });

  it("enforces actor-bound idempotency, exact mapping coverage, expiry, and tenant isolation", async () => {
    const staged = await stage("blueprint:stage:exact:0001");
    expect((await stage("blueprint:stage:exact:0001")).duplicate).toBe(true);
    await expect(repository.stagePreview(client, preview, { idempotencyKey: "blueprint:stage:exact:0001" }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    await record();
    await expect(repository.commitMapping(staff, {
      previewId: staged.stagedPreview.previewId,
      agentId,
      idempotencyKey: "blueprint:commit:missing:0001",
      mappings: [mappings()[0]],
    })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(repository.commitMapping(staff, {
      previewId: staged.stagedPreview.previewId,
      agentId,
      idempotencyKey: "blueprint:commit:extra:00001",
      mappings: [...mappings(), { accountLabel: "Extra #1", accountRef: "acct_3234567890abcdef" }],
    })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(repository.getStagedPreview(otherStaff, staged.stagedPreview.previewId)).resolves.toBeNull();
    await expect(repository.getStagedPreview(client, staged.stagedPreview.previewId)).resolves.toBeNull();
    await expect(repository.listRecentRevisions(otherStaff)).resolves.toEqual([]);

    now = new Date(now.getTime() + 30 * 60_000);
    await expect(commit(staged.stagedPreview.previewId, "blueprint:commit:expired:0001"))
      .rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("always chooses the latest authenticated event and rejects stale, live, unknown, disconnected, partial, or ambiguous evidence", async () => {
    const staged = await stage("blueprint:stage:gates:00001");
    await expect(commit(staged.stagedPreview.previewId, "blueprint:commit:noevent:0001"))
      .rejects.toMatchObject({ code: "CONFLICT" });

    await record(runtimeEvent({
      asOf: new Date(now.getTime() - 31_000).toISOString(),
      ageMs: 31_000,
    }));
    await expect(commit(staged.stagedPreview.previewId, "blueprint:commit:stale:00001"))
      .rejects.toMatchObject({ code: "CONFLICT" });

    const cases: Array<[string, (value: RuntimeObservationV2State) => void]> = [
      ["live", (value) => {
        value.accounts[0].classification = { environment: "live", authority: "authoritative", source: "ninjatrader_live_account" };
        value.accounts[0].displayLabel = "Live account 1";
      }],
      ["unknown", (value) => {
        value.accounts[0].classification = {
          environment: "unknown", authority: "unavailable", source: null, reasonCode: "CLASSIFICATION_UNAVAILABLE",
        };
        value.accounts[0].displayLabel = "Unknown account 1";
      }],
      ["disconnected", (value) => { value.accounts[0].status = "disconnected"; }],
      ["partial", (value) => {
        value.collection.scopes.strategies = {
          status: "partial", itemCount: 2, errors: [{ code: "SOURCE_ERROR", retryable: true }],
        };
      }],
      ["duplicate", (value) => {
        value.strategies.push({ ...value.strategies[0], strategyRef: "strat_3234567890abcdef", displayLabel: "Strategy 3" });
        value.collection.scopes.strategies = completeScope(3);
      }],
    ];
    for (const [label, mutate] of cases) {
      await record(runtimeEvent({ state: state(mutate) }));
      await expect(commit(staged.stagedPreview.previewId, `blueprint:commit:${label}:00001`))
        .rejects.toMatchObject({ code: "CONFLICT" });
    }
  });

  it("fails approval closed when a bound account or strategy changes", async () => {
    await record();
    const staged = await stage("blueprint:stage:changed:0001");
    const draft = await commit(staged.stagedPreview.previewId, "blueprint:commit:changed:0001");
    now = new Date(now.getTime() + 1_000);
    await record(runtimeEvent({ state: state((value) => {
      value.strategies[0].enabled = true;
      value.strategies[0].runtimeState = "running";
      value.strategies[0].synchronizationState = "synchronized";
    }) }));
    await expect(repository.approveRevision(staff, {
      revisionRef: draft.revision.revisionRef,
      expectedVersion: 1,
      idempotencyKey: "blueprint:approve:changed:0001",
    })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await database.query("SELECT id FROM blueprint_assignment_revision_states")).toHaveLength(1);
  });

  it("refuses to bind one runtime strategy instance to multiple Blueprint rows", async () => {
    const duplicateAssignments: BlueprintAssignmentPreview[] = [assignments[0], {
      ...assignments[0],
      period: "PERIOD_2",
      sourceRow: 3,
    }];
    const duplicatePreview = {
      ...preview,
      canonicalPreviewHash: blueprintCanonicalPreviewHash(duplicateAssignments),
      assignments: duplicateAssignments,
      assignmentCount: duplicateAssignments.length,
    };
    await record();
    const staged = await repository.stagePreview(staff, duplicatePreview, {
      idempotencyKey: "blueprint:stage:duplicate:0001",
    });
    await expect(repository.commitMapping(staff, {
      previewId: staged.stagedPreview.previewId,
      agentId,
      idempotencyKey: "blueprint:commit:duplicate:001",
      mappings: [mappings()[0]],
    })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await database.query("SELECT id FROM blueprint_assignment_revisions")).toHaveLength(0);
  });

  it("rolls back all evidence when canonical audit insertion fails", async () => {
    const failing = new BlueprintAssignmentRepository(withFailingAuditWrites(database), () => now);
    await expect(failing.stagePreview(staff, preview, { idempotencyKey: "blueprint:stage:audit:00001" }))
      .rejects.toThrow("injected audit failure");
    expect(await database.query("SELECT id FROM blueprint_preview_stages")).toHaveLength(0);

    const staged = await stage("blueprint:stage:audit:00002");
    await record();
    await expect(failing.commitMapping(staff, {
      previewId: staged.stagedPreview.previewId,
      agentId,
      idempotencyKey: "blueprint:commit:audit:0001",
      mappings: mappings(),
    })).rejects.toThrow("injected audit failure");
    expect(await database.query("SELECT id FROM blueprint_assignment_revisions")).toHaveLength(0);

    const draft = await commit(staged.stagedPreview.previewId, "blueprint:commit:audit:0002");
    now = new Date(now.getTime() + 1_000);
    await record();
    await expect(failing.approveRevision(staff, {
      revisionRef: draft.revision.revisionRef,
      expectedVersion: 1,
      idempotencyKey: "blueprint:approve:audit:0001",
    })).rejects.toThrow("injected audit failure");
    expect(await database.query("SELECT id FROM blueprint_assignment_revision_states")).toHaveLength(1);
  });

  it("rejects mutation and detects tampered child evidence on readback", async () => {
    await record();
    const staged = await stage("blueprint:stage:tamper:0001");
    const draft = await commit(staged.stagedPreview.previewId, "blueprint:commit:tamper:0001");
    await expect(database.query(
      "UPDATE blueprint_assignment_account_bindings SET display_label = 'Changed'",
    )).rejects.toThrow(/append-only/i);
    await database.exec("DROP TRIGGER blueprint_assignment_strategy_bindings_append_only ON blueprint_assignment_strategy_bindings");
    await database.query("UPDATE blueprint_assignment_strategy_bindings SET instrument = 'NQ'");
    await expect(repository.getRevision(staff, draft.revision.revisionRef)).rejects.toThrow(/content hash/i);

    const secondStage = await stage("blueprint:stage:tamper:0002");
    await database.exec("DROP TRIGGER blueprint_preview_stage_assignments_append_only ON blueprint_preview_stage_assignments");
    await database.query(
      "UPDATE blueprint_preview_stage_assignments SET instrument = 'NQ' WHERE preview_id = $1",
      [secondStage.stagedPreview.previewId],
    );
    await expect(repository.getStagedPreview(staff, secondStage.stagedPreview.previewId)).rejects.toThrow(/content hash/i);
  });

  it("denies staff and clients in CENTRAL mode pending scoped OTP", async () => {
    const staged = await stage("blueprint:stage:central:0001");
    process.env.NINJA_MANAGER_MODE = "CENTRAL_CONNECTED";
    await expect(repository.getStagedPreview(staff, staged.stagedPreview.previewId)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(repository.getStagedPreview(client, staged.stagedPreview.previewId)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(repository.getRevision(staff, "assignment_rev_1234567890abcdef")).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(repository.listRecentRevisions(client)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("lists only the requesting tenant's recent immutable revisions in newest-first order", async () => {
    await record();
    const firstStage = await stage("blueprint:stage:list:000001");
    const first = await commit(firstStage.stagedPreview.previewId, "blueprint:commit:list:00001");
    now = new Date(now.getTime() + 1_000);
    await record();
    const secondStage = await stage("blueprint:stage:list:000002");
    const second = await commit(secondStage.stagedPreview.previewId, "blueprint:commit:list:00002");

    const recent = await repository.listRecentRevisions(client, 2);
    expect(recent.map((entry) => entry.revisionRef)).toEqual([
      second.revision.revisionRef,
      first.revision.revisionRef,
    ]);
    await expect(repository.listRecentRevisions(otherStaff, 2)).resolves.toEqual([]);
    await expect(repository.listRecentRevisions(peerClient, 2)).resolves.toEqual([]);
    await expect(repository.listRecentRevisions(client, 0)).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("denies a same-organization peer client access to stages, revisions, and peer-owned agents", async () => {
    const staged = await repository.stagePreview(client, preview, {
      idempotencyKey: "blueprint:stage:client:00001",
    });
    await expect(repository.getStagedPreview(peerClient, staged.stagedPreview.previewId)).resolves.toBeNull();
    await record();
    await expect(repository.commitMapping(client, {
      previewId: staged.stagedPreview.previewId,
      agentId: peerAgentId,
      idempotencyKey: "blueprint:commit:peer:00001",
      mappings: mappings(),
    })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const draft = await repository.commitMapping(client, {
      previewId: staged.stagedPreview.previewId,
      agentId,
      idempotencyKey: "blueprint:commit:client:0001",
      mappings: mappings(),
    });
    await expect(repository.getRevision(peerClient, draft.revision.revisionRef))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(repository.listRecentRevisions(peerClient)).resolves.toEqual([]);
    await expect(repository.approveRevision(peerClient, {
      revisionRef: draft.revision.revisionRef,
      expectedVersion: 1,
      idempotencyKey: "blueprint:approve:peer:0001",
    })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
