import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createDatabaseClient, type DatabaseClient, type DatabaseTransaction } from "@/lib/db/client";
import { migrateDatabase } from "@/lib/db/migrate";
import { auditEvidenceHash } from "@/lib/domain/audit-evidence";
import { hashCanonicalPayload } from "@/lib/domain/runtime-contracts";
import {
  runtimeObservationV2StateDigest,
  type RuntimeObservationV2State,
} from "@/lib/domain/runtime-observation-v2";
import type { AuthenticatedUser } from "@/lib/domain/types";
import { RuntimeRepository, type AgentIdentity } from "./runtime-repository";
import { EodSnapshotRepository } from "./eod-snapshot-repository";

const orgId = "10000000-0000-4000-8000-000000000001";
const otherOrgId = "10000000-0000-4000-8000-000000000002";
const staffId = "20000000-0000-4000-8000-000000000001";
const otherStaffId = "20000000-0000-4000-8000-000000000002";
const clientId = "30000000-0000-4000-8000-000000000001";
const agentId = "40000000-0000-4000-8000-000000000001";
const secondAgentId = "40000000-0000-4000-8000-000000000002";
const otherAgentId = "40000000-0000-4000-8000-000000000003";
const originalEnvironment = {
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
const client: AuthenticatedUser = {
  id: clientId,
  organizationId: orgId,
  email: "client@test.local",
  name: "Client",
  role: "client",
};
const otherStaff: AuthenticatedUser = {
  id: otherStaffId,
  organizationId: otherOrgId,
  email: "other@test.local",
  name: "Other staff",
  role: "staff",
};

let database: DatabaseClient;
let runtimeRepository: RuntimeRepository;
let repository: EodSnapshotRepository;
let identity: AgentIdentity;
let now: Date;

function uuid(namespace: string, value: number): string {
  return `${namespace}-0000-4000-8000-${String(value).padStart(12, "0")}`;
}

function completeScope(itemCount: number) {
  return { status: "complete" as const, itemCount, errors: [] };
}

function partialScope(itemCount: number) {
  return {
    status: "partial" as const,
    itemCount,
    errors: [{ code: "CAPABILITY_UNSUPPORTED" as const, retryable: false }],
  };
}

function unavailableScope() {
  return {
    status: "unavailable" as const,
    itemCount: 0,
    errors: [{ code: "SOURCE_ERROR" as const, retryable: true }],
  };
}

function available(amountMinor: number, source: "ninjatrader_account_item" | "ninjatrader_performance" | "calculated_by_companion" | "manager_ledger") {
  return { availability: "available" as const, currency: "USD" as const, amountMinor, source };
}

function unavailable(reasonCode: "SOURCE_UNSUPPORTED" | "NOT_OBSERVED_YET" = "SOURCE_UNSUPPORTED") {
  return {
    availability: "unavailable" as const,
    currency: "USD" as const,
    amountMinor: null,
    source: null,
    reasonCode,
  };
}

function observationState(sessionDate = "2026-07-21"): RuntimeObservationV2State {
  const connectionRef = "conn_1234567890abcdef";
  const firstAccountRef = "acct_1234567890abcdef";
  const secondAccountRef = "acct_2234567890abcdef";
  return {
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
      accountRef: firstAccountRef,
      maskedIdentifier: "****m101",
      identifierFingerprint: "hmac-sha256:" + "a".repeat(64),
      displayLabel: "Simulation account 1",
      classification: {
        environment: "simulation",
        authority: "authoritative",
        source: "ninjatrader_simulation_account",
      },
      connectionRefs: [connectionRef],
      status: "connected",
    }, {
      accountRef: secondAccountRef,
      maskedIdentifier: "****x999",
      identifierFingerprint: "hmac-sha256:" + "b".repeat(64),
      displayLabel: "Unknown account 2",
      classification: {
        environment: "unknown",
        authority: "unavailable",
        source: null,
        reasonCode: "CLASSIFICATION_UNAVAILABLE",
      },
      connectionRefs: [connectionRef],
      status: "unknown",
    }],
    strategies: [{
      strategyRef: "strat_0000000000000001",
      accountRef: firstAccountRef,
      displayLabel: "Strategy 1",
      strategyTypeCode: "VINCERE_STEADY",
      instrumentCode: "MNQ SEP26",
      enabled: true,
      runtimeState: "running",
      synchronizationState: "synchronized",
      operationalParameters: [],
      lastStateChangeAt: null,
    }, {
      strategyRef: "strat_0000000000000002",
      accountRef: firstAccountRef,
      displayLabel: "Strategy 2",
      strategyTypeCode: "VINCERE_OPEN",
      instrumentCode: "MES SEP26",
      enabled: false,
      runtimeState: "disabled",
      synchronizationState: "not_applicable",
      operationalParameters: [],
      lastStateChangeAt: null,
    }],
    positions: [],
    orders: [],
    executions: [],
    pnl: [{
      accountRef: firstAccountRef,
      sessionDate,
      daily: {
        realized: available(0, "ninjatrader_account_item"),
        unrealized: available(0, "ninjatrader_account_item"),
        total: available(0, "calculated_by_companion"),
      },
      nativeLifetime: available(12_345, "ninjatrader_performance"),
      managerObservedCumulative: { value: unavailable("NOT_OBSERVED_YET"), observedSince: null },
    }, {
      accountRef: secondAccountRef,
      sessionDate: "2026-07-20",
      daily: {
        realized: unavailable(),
        unrealized: unavailable(),
        total: unavailable(),
      },
      nativeLifetime: unavailable(),
      managerObservedCumulative: { value: unavailable("NOT_OBSERVED_YET"), observedSince: null },
    }],
    collection: {
      overall: "partial",
      scopes: {
        process: unavailableScope(),
        addon: unavailableScope(),
        connections: completeScope(1),
        accounts: completeScope(2),
        strategies: partialScope(2),
        positions: completeScope(0),
        orders: completeScope(0),
        executions: completeScope(0),
        pnl: partialScope(2),
      },
    },
  };
}

function runtimeObservation(
  targetAgentId: string,
  sequence: number,
  options: {
    eventId?: string;
    occurredAt?: string;
    asOf?: string;
    sessionDate?: string;
    freshnessAgeMs?: number;
    freshnessMaxAgeMs?: number;
    mutateState?: (state: RuntimeObservationV2State) => void;
  } = {},
) {
  const state = observationState(options.sessionDate);
  options.mutateState?.(state);
  const payload = {
    protocolVersion: "runtime-observation/2.0" as const,
    observationId: uuid("51000000", sequence),
    source: {
      collector: "vps_companion_agent" as const,
      authority: "ninjatrader_runtime" as const,
      installationRef: "install_1234567890abcdef",
      collectionSessionRef: "session_1234567890abcdef",
    },
    asOf: options.asOf ?? now.toISOString(),
    freshness: {
      status: "fresh" as const,
      ageMs: options.freshnessAgeMs ?? 0,
      maxAgeMs: options.freshnessMaxAgeMs ?? 60_000,
    },
    stateDigest: runtimeObservationV2StateDigest(state),
    state,
  };
  const unsigned = {
    protocolVersion: "1.0" as const,
    eventId: options.eventId ?? uuid("52000000", sequence),
    agentId: targetAgentId,
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
          if (/INSERT\s+INTO\s+audit_events/i.test(sql)) throw new Error("injected audit failure");
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

async function enroll(targetUser: AuthenticatedUser, targetAgentId: string): Promise<AgentIdentity> {
  const enrollment = await runtimeRepository.enrollAgent(targetUser, {
    id: targetAgentId,
    displayName: `Agent ${targetAgentId.slice(-4)}`,
    agentVersion: "1.0.0",
    protocolVersion: "1.0",
    capabilities: ["runtime.discovery"],
  });
  const authenticated = await runtimeRepository.authenticateAgentToken(enrollment.token);
  if (!authenticated) throw new Error("Test agent authentication failed");
  return authenticated;
}

async function recordSource(
  targetIdentity: AgentIdentity,
  event: ReturnType<typeof runtimeObservation>,
): Promise<void> {
  await runtimeRepository.recordAgentEvent(targetIdentity, event);
  await database.query(
    "UPDATE agent_events SET received_at = $1 WHERE organization_id = $2 AND agent_id = $3 AND event_id = $4",
    [now, targetIdentity.organizationId, targetIdentity.agentId, event.eventId],
  );
}

beforeEach(async () => {
  process.env.NINJA_MANAGER_MODE = "LOCAL_ONLY";
  process.env.NINJA_MANAGER_BIND_HOST = "127.0.0.1";
  process.env.PORT = "3000";
  process.env.APP_URL = "http://127.0.0.1:3000";
  now = new Date("2026-07-21T21:00:00.000Z");
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
  runtimeRepository = new RuntimeRepository(database, () => now);
  repository = new EodSnapshotRepository(database, () => now);
  identity = await enroll(staff, agentId);
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

describe("EOD snapshot repository", () => {
  it("captures immutable privacy-minimized account, P&L, stack, and partial scope evidence", async () => {
    const event = runtimeObservation(agentId, 1);
    await recordSource(identity, event);
    const result = await repository.captureManualSnapshot(staff, {
      agentId,
      sourceEventId: event.eventId,
      idempotencyKey: "eod:manual:privacy:0001",
    });

    expect(result.duplicate).toBe(false);
    expect(result.snapshot).toMatchObject({
      agentId,
      intendedLocalDate: "2026-07-21",
      timeZone: "America/New_York",
      completeness: {
        overall: "partial",
        scopes: {
          strategies: { status: "partial", itemCount: 2 },
          process: { status: "unavailable", itemCount: 0 },
        },
      },
      accounts: [{
        maskedIdentifier: "****m101",
        classification: { environment: "simulation", authority: "authoritative" },
        pnl: {
          daily: { realized: { availability: "available", amountMinor: 0 } },
          nativeLifetime: { availability: "available", amountMinor: 12_345 },
          managerObservedCumulative: {
            value: { availability: "unavailable", amountMinor: null },
            observedSince: null,
          },
        },
        strategies: [{ strategyType: "VINCERE_STEADY" }, { strategyType: "VINCERE_OPEN" }],
      }, {
        pnl: {
          daily: { realized: { availability: "unavailable", amountMinor: null } },
        },
      }],
    });
    const serialized = JSON.stringify(result.snapshot);
    expect(serialized).not.toContain("acct_");
    expect(serialized).not.toContain("strat_");
    expect(serialized).not.toContain("hmac-sha256");
    expect(serialized).not.toContain("processId");
    expect(await database.query("SELECT id FROM eod_snapshots")).toHaveLength(1);
    expect(await database.query("SELECT id FROM eod_snapshot_scopes")).toHaveLength(9);
    expect(await database.query("SELECT id FROM eod_snapshot_pnl_values")).toHaveLength(10);
  });

  it("returns exact actor-bound idempotent replay and rejects semantic conflicts", async () => {
    const event = runtimeObservation(agentId, 1);
    await recordSource(identity, event);
    const input = {
      agentId,
      sourceEventId: event.eventId,
      idempotencyKey: "eod:manual:replay:0001",
    };
    const first = await repository.captureManualSnapshot(staff, input);
    const replay = await repository.captureManualSnapshot(staff, input);
    expect(replay).toEqual({ snapshot: first.snapshot, duplicate: true });
    const secondEvent = runtimeObservation(agentId, 2);
    await recordSource(identity, secondEvent);
    await expect(repository.captureManualSnapshot(staff, {
      ...input,
      sourceEventId: secondEvent.eventId,
    })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(repository.captureManualSnapshot(client, input)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await database.query("SELECT id FROM eod_snapshots")).toHaveLength(1);
    expect(await database.query("SELECT id FROM audit_events WHERE action = 'eod_snapshot.captured'")).toHaveLength(1);
  });

  it("enforces server-owned freshness, declared-age consistency, chronology, and future rejection", async () => {
    const cases = [
      runtimeObservation(agentId, 1, {
        asOf: new Date(now.getTime() - 59 * 60_000).toISOString(),
        freshnessAgeMs: 59 * 60_000,
        freshnessMaxAgeMs: 60 * 60_000,
      }),
      runtimeObservation(agentId, 2, {
        asOf: new Date(now.getTime() - 46_000).toISOString(),
        freshnessAgeMs: 46_000,
      }),
      runtimeObservation(agentId, 3, {
        asOf: new Date(now.getTime() - 10_000).toISOString(),
        freshnessAgeMs: 0,
      }),
      runtimeObservation(agentId, 4, {
        asOf: new Date(now.getTime() - 1_000).toISOString(),
        occurredAt: new Date(now.getTime() - 2_000).toISOString(),
      }),
      runtimeObservation(agentId, 5, {
        asOf: new Date(now.getTime() + 1_000).toISOString(),
        occurredAt: new Date(now.getTime() + 1_000).toISOString(),
      }),
    ];
    for (const [index, event] of cases.entries()) {
      await recordSource(identity, event);
      await expect(repository.captureManualSnapshot(staff, {
        agentId,
        sourceEventId: event.eventId,
        idempotencyKey: `eod:manual:freshness:000${index + 1}`,
      })).rejects.toMatchObject({ code: "CONFLICT" });
    }
    expect(await database.query("SELECT id FROM eod_snapshots")).toHaveLength(0);
  });

  it("fails closed on tampered and non-v2 stored evidence", async () => {
    const tampered = runtimeObservation(agentId, 1, { eventId: uuid("52000000", 21) });
    await recordSource(identity, tampered);
    const changed = structuredClone(tampered.payload);
    changed.freshness.ageMs = 1;
    await database.query(
      "UPDATE agent_events SET payload = $1::jsonb WHERE organization_id = $2 AND agent_id = $3 AND event_id = $4",
      [JSON.stringify(changed), orgId, agentId, tampered.eventId],
    );
    await expect(repository.captureManualSnapshot(staff, {
      agentId,
      sourceEventId: tampered.eventId,
      idempotencyKey: "eod:manual:tamper:0001",
    })).rejects.toMatchObject({ code: "CONFLICT" });

    await database.query(
      "UPDATE agent_events SET payload = $1::jsonb, event_type = 'runtime.snapshot' WHERE organization_id = $2 AND agent_id = $3 AND event_id = $4",
      [JSON.stringify(tampered.payload), orgId, agentId, tampered.eventId],
    );
    await expect(repository.captureManualSnapshot(staff, {
      agentId,
      sourceEventId: tampered.eventId,
      idempotencyKey: "eod:manual:notv2:0001",
    })).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("rejects cross-tenant evidence and a source belonging to another same-tenant agent", async () => {
    const secondIdentity = await enroll(staff, secondAgentId);
    const secondEvent = runtimeObservation(secondAgentId, 1, { eventId: uuid("52000000", 31) });
    await recordSource(secondIdentity, secondEvent);
    await expect(repository.captureManualSnapshot(staff, {
      agentId,
      sourceEventId: secondEvent.eventId,
      idempotencyKey: "eod:manual:mismatch:001",
    })).rejects.toMatchObject({ code: "CONFLICT" });

    const otherIdentity = await enroll(otherStaff, otherAgentId);
    const otherEvent = runtimeObservation(otherAgentId, 1, { eventId: uuid("52000000", 32) });
    await recordSource(otherIdentity, otherEvent);
    await expect(repository.captureManualSnapshot(staff, {
      agentId,
      sourceEventId: otherEvent.eventId,
      idempotencyKey: "eod:manual:tenant:0001",
    })).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("enforces and independently validates exact tenant-agent credential provenance", async () => {
    const event = runtimeObservation(agentId, 1);
    await recordSource(identity, event);
    await enroll(staff, secondAgentId);
    const [otherCredential] = await database.query<{ id: string }>(
      "SELECT id FROM agent_credentials WHERE organization_id = $1 AND agent_id = $2",
      [orgId, secondAgentId],
    );
    await expect(database.query(
      "UPDATE agent_events SET credential_id = $1 WHERE organization_id = $2 AND agent_id = $3 AND event_id = $4",
      [otherCredential.id, orgId, agentId, event.eventId],
    )).rejects.toThrow();

    await database.exec("ALTER TABLE agent_events DROP CONSTRAINT agent_events_credential_provenance_fk");
    await database.query(
      "UPDATE agent_events SET credential_id = $1 WHERE organization_id = $2 AND agent_id = $3 AND event_id = $4",
      [otherCredential.id, orgId, agentId, event.eventId],
    );
    await expect(repository.captureManualSnapshot(staff, {
      agentId,
      sourceEventId: event.eventId,
      idempotencyKey: "eod:manual:credential:001",
    })).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("rejects available P&L from a different intended local session date", async () => {
    const event = runtimeObservation(agentId, 1, { sessionDate: "2026-07-20" });
    await recordSource(identity, event);
    await expect(repository.captureManualSnapshot(staff, {
      agentId,
      sourceEventId: event.eventId,
      idempotencyKey: "eod:manual:date:00001",
    })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await database.query("SELECT id FROM eod_snapshots")).toHaveLength(0);
  });

  it("persists manager cumulative provenance and a self-verifying transformed content hash", async () => {
    const observedSince = "2026-07-14T21:00:00.000Z";
    const event = runtimeObservation(agentId, 1, {
      mutateState(state) {
        state.pnl[0].managerObservedCumulative = {
          value: available(3_210, "manager_ledger"),
          observedSince,
        };
      },
    });
    await recordSource(identity, event);
    const captured = await repository.captureManualSnapshot(staff, {
      agentId,
      sourceEventId: event.eventId,
      idempotencyKey: "eod:manual:manager:0001",
    });
    expect(captured.snapshot.contentHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(captured.snapshot.source.occurredAt).toBe(now.toISOString());
    expect(captured.snapshot.accounts[0].pnl?.managerObservedCumulative).toMatchObject({
      value: { availability: "available", amountMinor: 3_210, source: "manager_ledger" },
      observedSince,
    });
    const [row] = await database.query<{ source: string; observed_since: Date }>(
      "SELECT source, observed_since FROM eod_snapshot_pnl_values WHERE metric = 'manager_observed_cumulative' AND availability = 'available'",
    );
    expect(row.source).toBe("manager_ledger");
    expect(new Date(row.observed_since).toISOString()).toBe(observedSince);
    await expect(repository.getSnapshot(staff, captured.snapshot.snapshotId)).resolves.toEqual(captured.snapshot);

    await database.exec("DROP TRIGGER eod_snapshot_pnl_values_append_only ON eod_snapshot_pnl_values");
    await expect(database.query(
      "UPDATE eod_snapshot_pnl_values SET observed_since = NULL WHERE snapshot_id = $1 AND metric = 'manager_observed_cumulative'",
      [captured.snapshot.snapshotId],
    )).rejects.toThrow();
    await expect(database.query(
      "UPDATE eod_snapshot_pnl_values SET source = 'manager_ledger' WHERE snapshot_id = $1 AND metric = 'native_lifetime'",
      [captured.snapshot.snapshotId],
    )).rejects.toThrow();
    await expect(database.query(
      "UPDATE eod_snapshot_pnl_values SET amount_minor = amount_minor + 1 WHERE snapshot_id = $1 AND metric = 'daily_total'",
      [captured.snapshot.snapshotId],
    )).rejects.toThrow(/daily total/i);
  });

  it("rejects SQL updates, deletes, and agent removal for retained append-only EOD evidence", async () => {
    const event = runtimeObservation(agentId, 1);
    await recordSource(identity, event);
    const captured = await repository.captureManualSnapshot(staff, {
      agentId,
      sourceEventId: event.eventId,
      idempotencyKey: "eod:manual:append:0001",
    });
    const [scope] = await database.query<{ id: string }>("SELECT id FROM eod_snapshot_scopes LIMIT 1");
    const [account] = await database.query<{ id: string }>("SELECT id FROM eod_snapshot_accounts LIMIT 1");
    const [pnl] = await database.query<{ id: string }>("SELECT id FROM eod_snapshot_pnl_values LIMIT 1");
    const [strategy] = await database.query<{ id: string }>("SELECT id FROM eod_snapshot_strategies LIMIT 1");
    const targets = [
      ["eod_snapshots", captured.snapshot.snapshotId],
      ["eod_snapshot_scopes", scope.id],
      ["eod_snapshot_accounts", account.id],
      ["eod_snapshot_pnl_values", pnl.id],
      ["eod_snapshot_strategies", strategy.id],
    ] as const;
    for (const [table, id] of targets) {
      await expect(database.query(`UPDATE ${table} SET id = id WHERE id = $1`, [id])).rejects.toThrow(/append-only/i);
      await expect(database.query(`DELETE FROM ${table} WHERE id = $1`, [id])).rejects.toThrow(/append-only/i);
    }
    await expect(database.query("DELETE FROM agent_installations WHERE id = $1", [agentId])).rejects.toThrow();
    await expect(repository.getSnapshot(staff, captured.snapshot.snapshotId)).resolves.toEqual(captured.snapshot);
  });

  it("detects valid-shape child and header tampering on get, replay, and list", async () => {
    const firstEvent = runtimeObservation(agentId, 1);
    await recordSource(identity, firstEvent);
    const firstInput = {
      agentId,
      sourceEventId: firstEvent.eventId,
      idempotencyKey: "eod:manual:tamper-child:0001",
    };
    const first = await repository.captureManualSnapshot(staff, firstInput);
    const secondEvent = runtimeObservation(agentId, 2);
    await recordSource(identity, secondEvent);
    const second = await repository.captureManualSnapshot(staff, {
      agentId,
      sourceEventId: secondEvent.eventId,
      idempotencyKey: "eod:manual:tamper-head:00001",
    });

    await database.exec("DROP TRIGGER eod_snapshot_pnl_values_append_only ON eod_snapshot_pnl_values");
    await database.query(
      "UPDATE eod_snapshot_pnl_values SET amount_minor = amount_minor + 1 WHERE snapshot_id = $1 AND metric = 'native_lifetime'",
      [first.snapshot.snapshotId],
    );
    await database.exec("DROP TRIGGER eod_snapshots_append_only ON eod_snapshots");
    await database.query(
      "UPDATE eod_snapshots SET source_sequence = source_sequence + 10 WHERE id = $1",
      [second.snapshot.snapshotId],
    );

    await expect(repository.getSnapshot(staff, first.snapshot.snapshotId)).rejects.toThrow(/content hash/i);
    await expect(repository.captureManualSnapshot(staff, firstInput)).rejects.toThrow(/content hash/i);
    await expect(repository.getSnapshot(staff, second.snapshot.snapshotId)).rejects.toThrow(/content hash/i);
    await expect(repository.listSnapshots(staff)).rejects.toThrow(/content hash/i);
  });

  it("rolls back snapshot rows when canonical audit evidence cannot be appended", async () => {
    const event = runtimeObservation(agentId, 1);
    await recordSource(identity, event);
    const failing = new EodSnapshotRepository(withFailingAuditWrites(database), () => now);
    await expect(failing.captureManualSnapshot(staff, {
      agentId,
      sourceEventId: event.eventId,
      idempotencyKey: "eod:manual:audit:0001",
    })).rejects.toThrow("injected audit failure");
    expect(await database.query("SELECT id FROM eod_snapshots")).toHaveLength(0);
    expect(await database.query("SELECT id FROM eod_snapshot_accounts")).toHaveLength(0);
  });

  it("writes verifiable audit evidence without raw runtime identities", async () => {
    const event = runtimeObservation(agentId, 1);
    await recordSource(identity, event);
    await repository.captureManualSnapshot(staff, {
      agentId,
      sourceEventId: event.eventId,
      idempotencyKey: "eod:manual:audit:0002",
    });
    const rows = await database.query<{
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
    }>("SELECT * FROM audit_events WHERE action = 'eod_snapshot.captured'");
    expect(rows).toHaveLength(1);
    const audit = rows[0];
    expect(audit.legacy_unverified).toBe(false);
    expect(audit.evidence_hash).toBe(auditEvidenceHash({
      eventId: audit.id,
      eventVersion: Number(audit.event_version),
      organizationId: audit.organization_id,
      actorSubjectId: audit.actor_subject_id,
      action: audit.action,
      entityType: audit.entity_type,
      entityId: audit.entity_id,
      metadata: audit.metadata,
      originInstallationId: audit.origin_installation_id,
      occurredAt: new Date(audit.created_at).toISOString(),
    }));
    expect(JSON.stringify(audit.metadata)).not.toContain("acct_");
    expect(JSON.stringify(audit.metadata)).not.toContain("hmac-sha256");
    expect(audit.metadata.contentHash).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it("supports bounded tenant-scoped list/get for local staff and clients and denies central access", async () => {
    const event = runtimeObservation(agentId, 1);
    await recordSource(identity, event);
    const captured = await repository.captureManualSnapshot(staff, {
      agentId,
      sourceEventId: event.eventId,
      idempotencyKey: "eod:manual:read:00001",
    });
    await expect(repository.getSnapshot(client, captured.snapshot.snapshotId)).resolves.toEqual(captured.snapshot);
    await expect(repository.getSnapshot(otherStaff, captured.snapshot.snapshotId)).resolves.toBeNull();
    await expect(repository.listSnapshots(client, { agentId, limit: 1 })).resolves.toMatchObject([{
      snapshotId: captured.snapshot.snapshotId,
      accountCount: 2,
      strategyCount: 2,
    }]);
    await expect(repository.listSnapshots(client, { limit: 101 })).rejects.toThrow();

    process.env.NINJA_MANAGER_MODE = "CENTRAL_CONNECTED";
    await expect(repository.getSnapshot(staff, captured.snapshot.snapshotId)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(repository.getSnapshot(client, captured.snapshot.snapshotId)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(repository.listSnapshots(staff)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(repository.listSnapshots(client)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
