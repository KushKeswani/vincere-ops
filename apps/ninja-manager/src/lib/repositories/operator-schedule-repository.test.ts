import { afterAll, beforeAll, describe, expect, it } from "vitest";

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
import { BlueprintAssignmentRepository } from "./blueprint-assignment-repository";
import { OperatorScheduleRepository } from "./operator-schedule-repository";
import { RuntimeRepository, type AgentIdentity } from "./runtime-repository";

const originalEnvironment = {
  mode: process.env.NINJA_MANAGER_MODE,
  bindHost: process.env.NINJA_MANAGER_BIND_HOST,
  appUrl: process.env.APP_URL,
  port: process.env.PORT,
};

interface TestContext {
  number: number;
  organizationId: string;
  staff: AuthenticatedUser;
  client: AuthenticatedUser;
  otherClient: AuthenticatedUser;
  agentId: string;
  identity: AgentIdentity;
  runtime: RuntimeRepository;
  blueprint: BlueprintAssignmentRepository;
  schedule: OperatorScheduleRepository;
  now: Date;
  sequence: number;
}

let database: DatabaseClient;
let contextNumber = 0;

function uuid(namespace: string, value: number): string {
  return namespace + "-0000-4000-8000-" + String(value).padStart(12, "0");
}

function key(context: TestContext, action: string): string {
  return "operator:" + action + ":" + String(context.number).padStart(4, "0") + ":000001";
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

function sequentialScope(itemCount: number) {
  return {
    status: "partial" as const,
    itemCount,
    errors: [{ code: "CAPABILITY_UNSUPPORTED" as const, retryable: false }],
  };
}

function runtimeState(mutate?: (state: RuntimeObservationV2State) => void): RuntimeObservationV2State {
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
      identifierFingerprint: "hmac-sha256:" + "a".repeat(64),
      displayLabel: "Simulation account 1",
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
        connections: sequentialScope(1),
        accounts: sequentialScope(1),
        strategies: sequentialScope(1),
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

function runtimeEvent(context: TestContext, options: {
  state?: RuntimeObservationV2State;
  asOf?: string;
  occurredAt?: string;
  ageMs?: number;
} = {}) {
  context.sequence += 1;
  const state = options.state ?? runtimeState();
  const payload = {
    protocolVersion: "runtime-observation/2.0" as const,
    observationId: uuid("51000000", context.number * 1_000 + context.sequence),
    source: {
      collector: "vps_companion_agent" as const,
      authority: "ninjatrader_runtime" as const,
      installationRef: "install_1234567890abcdef",
      collectionSessionRef: "session_1234567890abcdef",
    },
    asOf: options.asOf ?? context.now.toISOString(),
    freshness: {
      status: "fresh" as const,
      ageMs: options.ageMs ?? 0,
      maxAgeMs: 60_000,
    },
    stateDigest: runtimeObservationV2StateDigest(state),
    state,
  };
  const unsigned = {
    protocolVersion: "1.0" as const,
    eventId: uuid("52000000", context.number * 1_000 + context.sequence),
    agentId: context.agentId,
    sequence: context.sequence,
    eventType: "runtime.observation_v2" as const,
    correlationId: null,
    causationId: null,
    occurredAt: options.occurredAt ?? context.now.toISOString(),
    payloadHash: hashCanonicalPayload(payload),
    payload,
  };
  return { ...unsigned, envelopeHash: hashCanonicalPayload(unsigned) };
}

async function record(context: TestContext, event = runtimeEvent(context)): Promise<void> {
  await context.runtime.recordAgentEvent(context.identity, event);
  await database.query(
    "UPDATE agent_events SET received_at = $1 WHERE organization_id = $2 AND agent_id = $3 AND event_id = $4",
    [context.now, context.organizationId, context.agentId, event.eventId],
  );
}

const assignments: BlueprintAssignmentPreview[] = [{
  period: "PERIOD_1",
  accountLabel: "Lucid #1",
  propFirm: "Lucid",
  stackLevel: 1,
  strategy: "RBO",
  instrument: "MNQ",
  sourceRow: 2,
  sourceSlot: 1,
}];

const preview = {
  version: "blueprint-preview/1.0" as const,
  valid: true,
  source: {
    filename: "Vincere_Blueprint.xlsx",
    sheetName: "Cycling Blueprint" as const,
    workbookSha256: "sha256:" + "a".repeat(64),
  },
  canonicalPreviewHash: blueprintCanonicalPreviewHash(assignments),
  dataRowCount: 1,
  assignmentCount: 1,
  assignments,
  warnings: [],
  errors: [],
};

async function createContext(now = "2026-07-19T16:00:00.000Z"): Promise<TestContext> {
  contextNumber += 1;
  const number = contextNumber;
  const organizationId = uuid("10000000", number);
  const staffId = uuid("20000000", number * 10 + 1);
  const clientUserId = uuid("20000000", number * 10 + 2);
  const otherClientUserId = uuid("20000000", number * 10 + 3);
  const clientRecordId = uuid("30000000", number * 10 + 1);
  const otherClientRecordId = uuid("30000000", number * 10 + 2);
  const environmentId = uuid("35000000", number * 10 + 1);
  const otherEnvironmentId = uuid("35000000", number * 10 + 2);
  const agentId = uuid("40000000", number);
  const staff: AuthenticatedUser = {
    id: staffId,
    organizationId,
    email: "staff" + number + "@test.local",
    name: "Staff",
    role: "staff",
  };
  const client: AuthenticatedUser = {
    id: clientUserId,
    organizationId,
    email: "client" + number + "@test.local",
    name: "Client",
    role: "client",
  };
  const otherClient: AuthenticatedUser = {
    id: otherClientUserId,
    organizationId,
    email: "other" + number + "@test.local",
    name: "Other client",
    role: "client",
  };
  await database.query(
    "INSERT INTO organizations (id, name, slug) VALUES ($1, $2, $3)",
    [organizationId, "Org " + number, "org-" + number],
  );
  await database.query(
    "INSERT INTO users (id, organization_id, email, name, password_hash, role) VALUES ($1,$4,$5,'Staff','hash','staff'),($2,$4,$6,'Client','hash','client'),($3,$4,$7,'Other','hash','client')",
    [staffId, clientUserId, otherClientUserId, organizationId, staff.email, client.email, otherClient.email],
  );
  await database.query(
    "INSERT INTO clients (id, organization_id, user_id, display_name, created_by) VALUES ($1,$3,$4,'Client',$5),($2,$3,$6,'Other',$5)",
    [clientRecordId, otherClientRecordId, organizationId, clientUserId, staffId, otherClientUserId],
  );
  await database.query(
    "INSERT INTO environments (id, organization_id, client_id, vps_provider, vps_region, ninja_version) VALUES ($1,$3,$4,'local','local','8'),($2,$3,$5,'local','local','8')",
    [environmentId, otherEnvironmentId, organizationId, clientRecordId, otherClientRecordId],
  );
  const context = {
    number,
    organizationId,
    staff,
    client,
    otherClient,
    agentId,
    identity: null as unknown as AgentIdentity,
    runtime: null as unknown as RuntimeRepository,
    blueprint: null as unknown as BlueprintAssignmentRepository,
    schedule: null as unknown as OperatorScheduleRepository,
    now: new Date(now),
    sequence: 0,
  };
  context.runtime = new RuntimeRepository(database, () => context.now);
  context.blueprint = new BlueprintAssignmentRepository(database, () => context.now);
  context.schedule = new OperatorScheduleRepository(database, () => context.now);
  const enrollment = await context.runtime.enrollAgent(staff, {
    id: agentId,
    displayName: "Edith " + number,
    agentVersion: "1.0.0",
    protocolVersion: "1.0",
    capabilities: ["runtime.discovery"],
  });
  const identity = await context.runtime.authenticateAgentToken(enrollment.token);
  if (!identity) throw new Error("Test agent authentication failed");
  context.identity = identity;
  await database.query(
    "UPDATE agent_installations SET environment_id = $1 WHERE organization_id = $2 AND id = $3",
    [environmentId, organizationId, agentId],
  );
  return context;
}

async function prepareAssignment(context: TestContext, approve = true): Promise<string> {
  await record(context);
  const staged = await context.blueprint.stagePreview(context.client, preview, {
    idempotencyKey: key(context, "stage"),
  });
  const draft = await context.blueprint.commitMapping(context.client, {
    previewId: staged.stagedPreview.previewId,
    agentId: context.agentId,
    idempotencyKey: key(context, "commit"),
    mappings: [{ accountLabel: "Lucid #1", accountRef: "acct_1234567890abcdef" }],
  });
  if (!approve) return draft.revision.revisionRef;
  context.now = new Date(context.now.getTime() + 1_000);
  await record(context);
  await context.blueprint.approveRevision(context.client, {
    revisionRef: draft.revision.revisionRef,
    expectedVersion: 1,
    idempotencyKey: key(context, "approve"),
  });
  context.now = new Date(context.now.getTime() + 1_000);
  await record(context);
  return draft.revision.revisionRef;
}

async function createSchedule(context: TestContext) {
  return context.schedule.createSchedule(context.client, {
    agentId: context.agentId,
    idempotencyKey: key(context, "create"),
  });
}

async function arm(context: TestContext, scheduleId: string, weekStartLocalDate = "2026-07-20") {
  return context.schedule.armWeek(context.client, {
    scheduleId,
    weekStartLocalDate,
    idempotencyKey: key(context, "arm"),
  });
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

beforeAll(async () => {
  process.env.NINJA_MANAGER_MODE = "LOCAL_ONLY";
  process.env.NINJA_MANAGER_BIND_HOST = "127.0.0.1";
  process.env.PORT = "3000";
  process.env.APP_URL = "http://127.0.0.1:3000";
  database = createDatabaseClient(":memory:");
  await migrateDatabase(database);
});

afterAll(async () => {
  await database.close();
  for (const [environmentKey, value] of Object.entries({
    NINJA_MANAGER_MODE: originalEnvironment.mode,
    NINJA_MANAGER_BIND_HOST: originalEnvironment.bindHost,
    APP_URL: originalEnvironment.appUrl,
    PORT: originalEnvironment.port,
  })) {
    if (value === undefined) delete process.env[environmentKey];
    else process.env[environmentKey] = value;
  }
});

describe("operator weekly schedule repository", () => {
  it("creates defaults, binds the current approved exact SIM stack, materializes one immutable week, and is idempotent", async () => {
    const context = await createContext();
    const assignmentRevisionRef = await prepareAssignment(context);
    const created = await createSchedule(context);
    expect(created.value.settings).toMatchObject({
      timezone: "America/New_York",
      operatingWeekdays: ["MON", "TUE", "WED", "THU", "FRI"],
      enableLocalTime: "08:30",
      eodLocalTime: "17:00",
      fridayStopLocalTime: "18:00",
      settingsRevision: 1,
    });
    expect((await createSchedule(context)).duplicate).toBe(true);

    const armed = await arm(context, created.value.scheduleId);
    expect(armed.value).toMatchObject({
      state: "armed",
      authority: {
        assignmentRevisionRef,
        weekStartLocalDate: "2026-07-20",
        settingsRevision: 1,
      },
    });
    expect(armed.value.authority.targets).toEqual([{
      accountRef: "acct_1234567890abcdef",
      expectedAccountType: "simulation",
      strategyRefs: ["strat_1234567890abcdef"],
    }]);
    const occurrences = await context.schedule.listOccurrences(context.client, armed.value.authority.authorityId);
    expect(occurrences).toHaveLength(13);
    expect(occurrences.filter((entry) => entry.kind === "RECONCILE_AND_ENABLE_SIM_STACK")).toHaveLength(5);
    expect(occurrences.filter((entry) => entry.kind === "CAPTURE_EOD_SNAPSHOT")).toHaveLength(5);
    expect(occurrences.filter((entry) => entry.fridaySequence !== null).map((entry) => entry.kind)).toEqual([
      "REVOKE_ENABLE_AUTHORITY",
      "DISABLE_EXACT_SIM_STACK",
      "DISARM_WEEKLY_SCHEDULE",
    ]);
    expect(new Set(occurrences.map((entry) => entry.occurrenceKey)).size).toBe(13);
    expect(await context.schedule.countCurrentlyArmedAuthoritiesForAgent(context.client, context.agentId)).toBe(1);
    expect((await arm(context, created.value.scheduleId)).duplicate).toBe(true);
    await expect(context.schedule.armWeek(context.client, {
      scheduleId: created.value.scheduleId,
      weekStartLocalDate: "2026-07-20",
      idempotencyKey: key(context, "arm-again"),
    })).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("creates immutable custom settings revisions and invalidates old weekly authority without erasing Friday shutdown", async () => {
    const context = await createContext();
    await prepareAssignment(context);
    const created = await createSchedule(context);
    const armed = await arm(context, created.value.scheduleId);
    const revised = await context.schedule.reviseSettings(context.client, {
      scheduleId: created.value.scheduleId,
      expectedSettingsRevision: 1,
      operatingWeekdays: ["MON", "WED", "FRI"],
      enableLocalTime: "09:00",
      eodLocalTime: "16:30",
      fridayStopLocalTime: "17:30",
      idempotencyKey: key(context, "settings"),
    });
    expect(revised.value.settings).toMatchObject({
      settingsRevision: 2,
      operatingWeekdays: ["MON", "WED", "FRI"],
      enableLocalTime: "09:00",
      eodLocalTime: "16:30",
      fridayStopLocalTime: "17:30",
    });
    expect(await context.schedule.countCurrentlyArmedAuthoritiesForAgent(context.client, context.agentId)).toBe(0);
    const occurrences = await context.schedule.listOccurrences(context.client, armed.value.authority.authorityId);
    expect(occurrences.filter((entry) => entry.fridaySequence !== null).every((entry) => entry.status === "planned")).toBe(true);
    expect(occurrences.filter((entry) => entry.fridaySequence === null).every((entry) => entry.status === "superseded")).toBe(true);
    expect((await database.query(
      "SELECT to_state, reason_code FROM operator_weekly_authority_transitions WHERE authority_id = $1 ORDER BY transition_version",
      [armed.value.authority.authorityId],
    ))).toEqual([
      expect.objectContaining({ to_state: "armed", reason_code: "EXPLICIT_WEEKLY_ARM" }),
      expect.objectContaining({ to_state: "revoked", reason_code: "SETTINGS_REVISION_CHANGED" }),
    ]);
    await expect(context.schedule.reviseSettings(context.client, {
      scheduleId: created.value.scheduleId,
      expectedSettingsRevision: 2,
      operatingWeekdays: ["MON"],
      enableLocalTime: "18:00",
      eodLocalTime: "17:00",
      fridayStopLocalTime: "19:00",
      idempotencyKey: key(context, "bad-settings"),
    })).rejects.toThrow();
  });

  it("marks all pre-arm occurrences skipped and never catches up a late enable", async () => {
    const context = await createContext("2026-07-22T16:00:00.000Z");
    await prepareAssignment(context);
    const created = await createSchedule(context);
    const armed = await arm(context, created.value.scheduleId);
    const occurrences = await context.schedule.listOccurrences(context.client, armed.value.authority.authorityId);
    const skipped = occurrences.filter((entry) => entry.status === "skipped");
    expect(skipped).toHaveLength(5);
    expect(skipped.every((entry) => entry.statusReason === "ARMED_AFTER_DUE")).toBe(true);
    expect(occurrences.find((entry) => entry.localDate === "2026-07-22" && entry.kind === "CAPTURE_EOD_SNAPSHOT")?.status).toBe("planned");
    expect(await context.schedule.listOccurrences(context.client, armed.value.authority.authorityId)).toEqual(occurrences);
  });

  it("fails closed for unapproved, stale, partial, live, disconnected, unknown, Add-On-offline, and changed bindings", async () => {
    const cases: Array<[string, (state: RuntimeObservationV2State) => void]> = [
      ["partial", (state) => {
        state.collection.scopes.strategies = {
          status: "partial",
          itemCount: 1,
          errors: [{ code: "SOURCE_ERROR", retryable: true }],
        };
      }],
      ["live", (state) => {
        state.accounts[0].displayLabel = "Live account 1";
        state.accounts[0].classification = {
          environment: "live",
          authority: "authoritative",
          source: "ninjatrader_live_account",
        };
      }],
      ["disconnected", (state) => {
        state.accounts[0].status = "disconnected";
      }],
      ["unknown", (state) => {
        state.accounts[0].displayLabel = "Unknown account 1";
        state.accounts[0].classification = {
          environment: "unknown",
          authority: "unavailable",
          source: null,
          reasonCode: "CLASSIFICATION_UNAVAILABLE",
        };
        state.accounts[0].status = "unknown";
      }],
      ["addon-offline", (state) => {
        state.addon = null;
        state.collection.scopes.addon = unavailableScope();
      }],
      ["changed-binding", (state) => {
        state.strategies[0].enabled = true;
        state.strategies[0].runtimeState = "running";
        state.strategies[0].synchronizationState = "synchronized";
      }],
    ];

    const unapproved = await createContext();
    await prepareAssignment(unapproved, false);
    const unapprovedSchedule = await createSchedule(unapproved);
    await expect(arm(unapproved, unapprovedSchedule.value.scheduleId)).rejects.toMatchObject({ code: "CONFLICT" });

    const stale = await createContext();
    await prepareAssignment(stale);
    const staleSchedule = await createSchedule(stale);
    stale.now = new Date(stale.now.getTime() + 31_000);
    await expect(arm(stale, staleSchedule.value.scheduleId)).rejects.toMatchObject({ code: "CONFLICT" });

    for (const [label, mutate] of cases) {
      const context = await createContext();
      await prepareAssignment(context);
      const created = await createSchedule(context);
      context.now = new Date(context.now.getTime() + 1_000);
      await record(context, runtimeEvent(context, { state: runtimeState(mutate) }));
      await expect(context.schedule.armWeek(context.client, {
        scheduleId: created.value.scheduleId,
        weekStartLocalDate: "2026-07-20",
        idempotencyKey: key(context, "reject-" + label),
      })).rejects.toMatchObject({ code: "CONFLICT" });
      expect(await database.query(
        "SELECT id FROM operator_weekly_authorities WHERE organization_id = $1",
        [context.organizationId],
      )).toHaveLength(0);
    }
  });

  it("enforces client ownership, denies null or other-client agents, blocks central mode, and binds idempotency to the actor", async () => {
    const context = await createContext();
    const created = await createSchedule(context);
    await expect(context.schedule.getSchedule(context.otherClient, created.value.scheduleId)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(context.schedule.createSchedule(context.otherClient, {
      agentId: context.agentId,
      idempotencyKey: key(context, "create"),
    })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await database.query(
      "UPDATE agent_installations SET environment_id = NULL WHERE organization_id = $1 AND id = $2",
      [context.organizationId, context.agentId],
    );
    await expect(context.schedule.getSchedule(context.client, created.value.scheduleId)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await database.query(
      "UPDATE agent_installations SET environment_id = (SELECT id FROM environments WHERE organization_id = $1 AND client_id = (SELECT id FROM clients WHERE organization_id = $1 AND user_id = $2)) WHERE organization_id = $1 AND id = $3",
      [context.organizationId, context.client.id, context.agentId],
    );
    process.env.NINJA_MANAGER_MODE = "CENTRAL_CONNECTED";
    await expect(context.schedule.getSchedule(context.client, created.value.scheduleId)).rejects.toMatchObject({ code: "FORBIDDEN" });
    process.env.NINJA_MANAGER_MODE = "LOCAL_ONLY";
  });

  it("records manual revoke, verified exact-disable, and disarm evidence in order without exposing fake completion", async () => {
    const context = await createContext();
    await prepareAssignment(context);
    const created = await createSchedule(context);
    const armed = await arm(context, created.value.scheduleId);
    expect("recordOccurrenceTransition" in context.schedule).toBe(false);

    const revoked = await context.schedule.revokeAuthority(context.client, {
      authorityId: armed.value.authority.authorityId,
      idempotencyKey: key(context, "revoke"),
      reasonCode: "MANUAL_OPERATOR",
    });
    expect(revoked.value.state).toBe("revoked");
    expect(await context.schedule.countCurrentlyArmedAuthoritiesForAgent(context.client, context.agentId)).toBe(0);
    let friday = (await context.schedule.listOccurrences(context.client, armed.value.authority.authorityId))
      .filter((entry) => entry.fridaySequence !== null);
    expect(friday.map((entry) => entry.status)).toEqual(["planned", "planned", "planned"]);

    context.now = new Date(context.now.getTime() + 1_000);
    await record(context, runtimeEvent(context, { state: runtimeState((state) => {
      state.strategies[0].enabled = true;
      state.strategies[0].runtimeState = "running";
      state.strategies[0].synchronizationState = "synchronized";
    }) }));
    await expect(context.schedule.recordAuthorityDisarmed(context.client, {
      authorityId: armed.value.authority.authorityId,
      idempotencyKey: key(context, "disarm-running"),
    })).rejects.toMatchObject({ code: "CONFLICT" });

    context.now = new Date(context.now.getTime() + 1_000);
    await record(context);
    const disarmed = await context.schedule.recordAuthorityDisarmed(context.client, {
      authorityId: armed.value.authority.authorityId,
      idempotencyKey: key(context, "disarm"),
    });
    expect(disarmed.value.state).toBe("disarmed");
    friday = (await context.schedule.listOccurrences(context.client, armed.value.authority.authorityId))
      .filter((entry) => entry.fridaySequence !== null);
    expect(friday.map((entry) => entry.status)).toEqual(["planned", "skipped", "skipped"]);
    const shutdownReasons = await database.query<{ kind: string; reason_code: string | null }>(
      "SELECT occurrence.kind, transition.reason_code FROM operator_schedule_occurrences occurrence JOIN LATERAL (SELECT reason_code FROM operator_schedule_occurrence_transitions item WHERE item.occurrence_id = occurrence.id ORDER BY transition_version DESC LIMIT 1) transition ON true WHERE occurrence.authority_id = $1 AND occurrence.kind IN ('DISABLE_EXACT_SIM_STACK','DISARM_WEEKLY_SCHEDULE') ORDER BY occurrence.friday_sequence",
      [armed.value.authority.authorityId],
    );
    expect(shutdownReasons).toEqual([
      { kind: "DISABLE_EXACT_SIM_STACK", reason_code: "EXACT_TARGETS_ALREADY_DISABLED" },
      { kind: "DISARM_WEEKLY_SCHEDULE", reason_code: "MANUAL_DISARM_RECORDED" },
    ]);
  });

  it("expires armed counts, rejects mutation, detects tampering, and rolls back all evidence when audit insertion fails", async () => {
    const expiring = await createContext();
    await prepareAssignment(expiring);
    const created = await createSchedule(expiring);
    const armed = await arm(expiring, created.value.scheduleId);
    expiring.now = new Date("2026-07-10T22:00:00.000Z");
    expect(await expiring.schedule.countCurrentlyArmedAuthoritiesForAgent(expiring.client, expiring.agentId)).toBe(0);
    await expect(database.query(
      "UPDATE operator_weekly_authorities SET strategy_count = 2 WHERE id = $1",
      [armed.value.authority.authorityId],
    )).rejects.toThrow(/append-only/i);

    const failingContext = await createContext();
    const failing = new OperatorScheduleRepository(withFailingAuditWrites(database), () => failingContext.now);
    await expect(failing.createSchedule(failingContext.client, {
      agentId: failingContext.agentId,
      idempotencyKey: key(failingContext, "audit-fail"),
    })).rejects.toThrow("injected audit failure");
    expect(await database.query(
      "SELECT id FROM operator_schedules WHERE organization_id = $1",
      [failingContext.organizationId],
    )).toHaveLength(0);

    const tampered = await createContext();
    const tamperedSchedule = await createSchedule(tampered);
    await database.exec("DROP TRIGGER operator_schedule_settings_append_only ON operator_schedule_settings_revisions");
    await database.query(
      "UPDATE operator_schedule_settings_revisions SET content_hash = $1 WHERE schedule_id = $2",
      ["sha256:" + "f".repeat(64), tamperedSchedule.value.scheduleId],
    );
    await expect(tampered.schedule.getSchedule(tampered.client, tamperedSchedule.value.scheduleId)).rejects.toThrow(/content hash/i);
  });
});
