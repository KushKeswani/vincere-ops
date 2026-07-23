import { describe, expect, it } from "vitest";

import {
  parseRuntimeObservationV2,
  runtimeAccountObservationV2Schema,
  runtimeObservationV2Schema,
  runtimeObservationV2StateDigest,
  runtimeObservationV2StateSchema,
  runtimePnlObservationV2Schema,
  runtimeStrategyTypeV2Schema,
  type RuntimeObservationV2State,
} from "./runtime-observation-v2";

const refs = {
  installation: "install_1111111111111111",
  session: "session_1111111111111111",
  process: "process_1111111111111111",
  addon: "addon_1111111111111111",
  connection: "conn_1111111111111111",
  account: "acct_1111111111111111",
  strategy: "strat_1111111111111111",
  position: "pos_1111111111111111",
  workingOrder: "ord_1111111111111111",
  completedOrder: "ord_2222222222222222",
  execution: "exec_1111111111111111",
} as const;

const completeScope = (itemCount: number) => ({
  status: "complete" as const,
  itemCount,
  errors: [],
});

const available = (
  amountMinor: number,
  source: "ninjatrader_account_item" | "ninjatrader_performance" | "calculated_by_companion" | "manager_ledger",
) => ({
  availability: "available" as const,
  currency: "USD" as const,
  amountMinor,
  source,
});

const unavailable = (reasonCode: "SOURCE_UNSUPPORTED" | "NOT_OBSERVED_YET" = "SOURCE_UNSUPPORTED") => ({
  availability: "unavailable" as const,
  currency: "USD" as const,
  amountMinor: null,
  source: null,
  reasonCode,
});

function fullState(): RuntimeObservationV2State {
  return {
    process: {
      processRef: refs.process,
      status: "running",
      health: "healthy",
      processId: 4242,
      version: "8.1.7.2",
      startedAt: "2026-07-21T08:00:00.000-04:00",
    },
    addon: {
      addonRef: refs.addon,
      status: "connected",
      health: "healthy",
      version: "2.0.0",
      ipcAuthenticated: true,
      capabilities: ["ACCOUNT_PNL", "RUNTIME_DISCOVERY"],
    },
    connections: [{
      connectionRef: refs.connection,
      displayLabel: "Connection 1",
      kind: "simulation",
      providerCode: "TRADOVATE",
      status: "connected",
      health: "healthy",
      marketDataStatus: "live",
      lastStateChangeAt: "2026-07-21T08:00:10.000-04:00",
    }],
    accounts: [{
      accountRef: refs.account,
      maskedIdentifier: '****m101',
      identifierFingerprint: 'hmac-sha256:' + 'a'.repeat(64),
      displayLabel: "Simulation account 1",
      classification: {
        environment: "simulation",
        authority: "authoritative",
        source: "ninjatrader_simulation_account",
      },
      connectionRefs: [refs.connection],
      status: "connected",
    }],
    strategies: [{
      strategyRef: refs.strategy,
      accountRef: refs.account,
      displayLabel: "Strategy 1",
      strategyTypeCode: "VincereSteady",
      instrumentCode: "MNQ SEP26",
      enabled: true,
      runtimeState: "running",
      synchronizationState: "synchronized",
      operationalParameters: [
        { parameterCode: "CONTRACTS", value: { kind: "integer", value: 1 } },
        { parameterCode: "USE_BREAKEVEN", value: { kind: "boolean", value: true } },
      ],
      lastStateChangeAt: "2026-07-21T08:30:00.000-04:00",
    }],
    positions: [{
      positionRef: refs.position,
      accountRef: refs.account,
      strategyRef: refs.strategy,
      instrumentCode: "MNQ SEP26",
      side: "long",
      quantity: 1,
      averagePrice: 22_500.25,
      markPrice: 22_510.50,
    }],
    orders: [{
      orderRef: refs.workingOrder,
      accountRef: refs.account,
      strategyRef: refs.strategy,
      instrumentCode: "MNQ SEP26",
      lifecycle: "working",
      state: "working",
      side: "sell",
      orderType: "stop_market",
      quantity: 1,
      filledQuantity: 0,
      limitPrice: null,
      stopPrice: 22_480,
      submittedAt: "2026-07-21T08:30:01.000-04:00",
      completedAt: null,
    }, {
      orderRef: refs.completedOrder,
      accountRef: refs.account,
      strategyRef: refs.strategy,
      instrumentCode: "MNQ SEP26",
      lifecycle: "completed",
      state: "filled",
      side: "buy",
      orderType: "market",
      quantity: 1,
      filledQuantity: 1,
      limitPrice: null,
      stopPrice: null,
      submittedAt: "2026-07-21T08:30:00.000-04:00",
      completedAt: "2026-07-21T08:30:00.100-04:00",
    }],
    executions: [{
      executionRef: refs.execution,
      orderRef: refs.completedOrder,
      accountRef: refs.account,
      strategyRef: refs.strategy,
      instrumentCode: "MNQ SEP26",
      side: "buy",
      quantity: 1,
      price: 22_500.25,
      commissionMinor: 62,
      executedAt: "2026-07-21T08:30:00.050-04:00",
    }],
    pnl: [{
      accountRef: refs.account,
      sessionDate: "2026-07-21",
      daily: {
        realized: available(12_500, "ninjatrader_performance"),
        unrealized: available(2_050, "ninjatrader_account_item"),
        total: available(14_550, "calculated_by_companion"),
      },
      nativeLifetime: available(1_250_000, "ninjatrader_performance"),
      managerObservedCumulative: {
        value: available(750_000, "manager_ledger"),
        observedSince: "2026-01-01T00:00:00.000-05:00",
      },
    }],
    collection: {
      overall: "complete",
      scopes: {
        process: completeScope(1),
        addon: completeScope(1),
        connections: completeScope(1),
        accounts: completeScope(1),
        strategies: completeScope(1),
        positions: completeScope(1),
        orders: completeScope(2),
        executions: completeScope(1),
        pnl: completeScope(1),
      },
    },
  };
}

function observation(state = fullState()) {
  return {
    protocolVersion: "runtime-observation/2.0" as const,
    observationId: "10000000-0000-4000-8000-000000000001",
    source: {
      collector: "vps_companion_agent" as const,
      authority: "ninjatrader_runtime" as const,
      installationRef: refs.installation,
      collectionSessionRef: refs.session,
    },
    asOf: "2026-07-21T08:31:00.000-04:00",
    freshness: { status: "fresh" as const, ageMs: 250, maxAgeMs: 5_000 },
    stateDigest: runtimeObservationV2StateDigest(state),
    state,
  };
}

describe("authoritative runtime observation v2", () => {
  it("accepts a complete snapshot covering all authoritative runtime collections", () => {
    const parsed = parseRuntimeObservationV2(observation());
    expect(parsed.protocolVersion).toBe("runtime-observation/2.0");
    expect(parsed.state.accounts[0].classification.environment).toBe("simulation");
    expect(parsed.state.orders.map((order) => order.lifecycle)).toEqual(["working", "completed"]);
    expect(parsed.state.pnl[0].daily.total).toMatchObject({ availability: "available", amountMinor: 14_550 });
  });

  it("accepts a complete authoritative empty snapshot without inventing runtime rows", () => {
    const state: RuntimeObservationV2State = {
      ...fullState(),
      connections: [],
      accounts: [],
      strategies: [],
      positions: [],
      orders: [],
      executions: [],
      pnl: [],
      collection: {
        overall: "complete",
        scopes: {
          process: completeScope(1),
          addon: completeScope(1),
          connections: completeScope(0),
          accounts: completeScope(0),
          strategies: completeScope(0),
          positions: completeScope(0),
          orders: completeScope(0),
          executions: completeScope(0),
          pnl: completeScope(0),
        },
      },
    };
    expect(parseRuntimeObservationV2(observation(state)).state.accounts).toEqual([]);
  });

  it("rejects raw account ids, secret-bearing fields, and sensitive operational parameters", () => {
    const state = fullState();
    expect(state.accounts[0].maskedIdentifier).toBe('****m101');
    expect(runtimeObservationV2StateSchema.safeParse({
      ...state,
      accounts: [{ ...state.accounts[0], accountRef: "Sim101" }],
    }).success).toBe(false);
    expect(runtimeObservationV2StateSchema.safeParse({
      ...state,
      accounts: [{ ...state.accounts[0], rawAccountId: "Sim101" }],
    }).success).toBe(false);
    expect(runtimeObservationV2StateSchema.safeParse({
      ...state,
      accounts: [{ ...state.accounts[0], maskedIdentifier: "Sim101" }],
    }).success).toBe(false);
    expect(runtimeAccountObservationV2Schema.safeParse({
      ...state.accounts[0],
      maskedIdentifier: "***101",
    }).success).toBe(false);
    expect(runtimeAccountObservationV2Schema.safeParse({
      ...state.accounts[0],
      identifierFingerprint: "sha256:" + "a".repeat(64),
    }).success).toBe(false);
    expect(runtimeObservationV2StateSchema.safeParse({
      ...state,
      strategies: [{
        ...state.strategies[0],
        operationalParameters: [{ parameterCode: "API_KEY", value: { kind: "code", value: "BEARER_TOKEN" } }],
      }],
    }).success).toBe(false);
    expect(runtimeObservationV2Schema.safeParse({ ...observation(), accessToken: "secret" }).success).toBe(false);
  });

  it("preserves v1 strategy type identity while rejecting malformed names", () => {
    expect(runtimeStrategyTypeV2Schema.safeParse("VincereSteady").success).toBe(true);
    expect(runtimeStrategyTypeV2Schema.safeParse(" VincereSteady").success).toBe(false);
    expect(runtimeStrategyTypeV2Schema.safeParse("Vincere Steady").success).toBe(false);
    expect(runtimeStrategyTypeV2Schema.safeParse("A".repeat(81)).success).toBe(false);
    expect(runtimeObservationV2StateSchema.safeParse({
      ...fullState(),
      strategies: [{ ...fullState().strategies[0], secret: "not-allowed" }],
    }).success).toBe(false);
  });

  it("allows authoritative live classification, fails closed to unknown, and rejects contradictory labels", () => {
    expect(runtimeAccountObservationV2Schema.safeParse({
      ...fullState().accounts[0],
      displayLabel: "Live account 1",
      classification: {
        environment: "live",
        authority: "authoritative",
        source: "ninjatrader_live_account",
      },
    }).success).toBe(true);
    expect(runtimeAccountObservationV2Schema.safeParse({
      ...fullState().accounts[0],
      displayLabel: "Unknown account 1",
      classification: {
        environment: "unknown",
        authority: "unavailable",
        source: null,
        reasonCode: "CLASSIFICATION_CONFLICT",
      },
    }).success).toBe(true);
    expect(runtimeAccountObservationV2Schema.safeParse({
      ...fullState().accounts[0],
      displayLabel: "Simulation account 1",
      classification: {
        environment: "live",
        authority: "authoritative",
        source: "ninjatrader_live_account",
      },
    }).success).toBe(false);
    expect(runtimeAccountObservationV2Schema.safeParse({
      ...fullState().accounts[0],
      classification: {
        environment: "unknown",
        authority: "authoritative",
        source: "ninjatrader_simulation_account",
      },
    }).success).toBe(false);
  });

  it("enforces P&L totals, authoritative sources, and explicit unavailable values", () => {
    const pnl = fullState().pnl[0];
    expect(runtimePnlObservationV2Schema.safeParse(pnl).success).toBe(true);
    expect(runtimePnlObservationV2Schema.safeParse({
      ...pnl,
      daily: { ...pnl.daily, total: available(14_551, "calculated_by_companion") },
    }).success).toBe(false);
    expect(runtimePnlObservationV2Schema.safeParse({
      ...pnl,
      nativeLifetime: available(1_250_000, "manager_ledger"),
    }).success).toBe(false);

    const unavailablePnl = {
      ...pnl,
      daily: {
        realized: unavailable(),
        unrealized: unavailable(),
        total: unavailable(),
      },
      nativeLifetime: unavailable(),
      managerObservedCumulative: { value: unavailable("NOT_OBSERVED_YET"), observedSince: null },
    };
    expect(runtimePnlObservationV2Schema.safeParse(unavailablePnl).success).toBe(true);
    expect(runtimePnlObservationV2Schema.safeParse({
      ...unavailablePnl,
      managerObservedCumulative: { ...unavailablePnl.managerObservedCumulative, observedSince: "2026-01-01T00:00:00.000-05:00" },
    }).success).toBe(false);
  });

  it("rejects malformed, duplicate, unsorted, and dangling opaque references", () => {
    const state = fullState();
    expect(runtimeObservationV2StateSchema.safeParse({
      ...state,
      positions: [{ ...state.positions[0], positionRef: "pos_too_short" }],
    }).success).toBe(false);
    expect(runtimeObservationV2StateSchema.safeParse({
      ...state,
      accounts: [state.accounts[0], state.accounts[0]],
      collection: {
        ...state.collection,
        scopes: { ...state.collection.scopes, accounts: completeScope(2), pnl: completeScope(1) },
      },
    }).success).toBe(false);
    expect(runtimeAccountObservationV2Schema.safeParse({
      ...state.accounts[0],
      connectionRefs: [refs.connection, refs.connection],
    }).success).toBe(false);
    expect(runtimeObservationV2StateSchema.safeParse({
      ...state,
      executions: [{ ...state.executions[0], orderRef: "ord_9999999999999999" }],
    }).success).toBe(false);
  });

  it("rejects duplicate keyed account fingerprints even when opaque refs are distinct", () => {
    const state = fullState();
    const secondAccountRef = "acct_2222222222222222";
    const duplicateFingerprint = {
      ...state.accounts[0],
      accountRef: secondAccountRef,
      displayLabel: "Simulation account 2",
    };
    const duplicatePnl = { ...state.pnl[0], accountRef: secondAccountRef };
    const result = runtimeObservationV2StateSchema.safeParse({
      ...state,
      accounts: [state.accounts[0], duplicateFingerprint],
      pnl: [state.pnl[0], duplicatePnl],
      collection: {
        ...state.collection,
        scopes: {
          ...state.collection.scopes,
          accounts: completeScope(2),
          pnl: completeScope(2),
        },
      },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.message === "Snapshot contains duplicate account fingerprints")).toBe(true);
    }
  });

  it("caps large runtime collections at the IPC-safe item bound", () => {
    const state = fullState();
    const positions = Array.from({ length: 10_001 }, (_, index) => ({
      ...state.positions[0],
      positionRef: `pos_${index.toString().padStart(16, "0")}`,
    }));
    const result = runtimeObservationV2StateSchema.safeParse({
      ...state,
      positions,
      collection: {
        ...state.collection,
        scopes: { ...state.collection.scopes, positions: completeScope(positions.length) },
      },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.code === "too_big" && issue.path[0] === "positions")).toBe(true);
    }
  });

  it("binds collection completeness, item counts, and typed collection errors", () => {
    const state = fullState();
    expect(runtimeObservationV2StateSchema.safeParse({
      ...state,
      collection: {
        ...state.collection,
        scopes: { ...state.collection.scopes, positions: completeScope(0) },
      },
    }).success).toBe(false);
    expect(runtimeObservationV2StateSchema.safeParse({
      ...state,
      positions: [],
      collection: {
        overall: "partial",
        scopes: {
          ...state.collection.scopes,
          positions: {
            status: "unavailable",
            itemCount: 0,
            errors: [{ code: "CAPABILITY_UNSUPPORTED", retryable: false }],
          },
        },
      },
    }).success).toBe(true);
    expect(runtimeObservationV2StateSchema.safeParse({
      ...state,
      collection: { ...state.collection, overall: "partial" },
    }).success).toBe(false);
  });

  it("produces a deterministic canonical digest and rejects digest reuse after mutation", () => {
    const state = fullState();
    const reordered = Object.fromEntries(Object.entries(state).reverse()) as RuntimeObservationV2State;
    expect(runtimeObservationV2StateDigest(reordered)).toBe(runtimeObservationV2StateDigest(state));

    const valid = observation(state);
    expect(parseRuntimeObservationV2(valid).stateDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(runtimeObservationV2Schema.safeParse({
      ...valid,
      state: { ...state, positions: [] },
    }).success).toBe(false);
  });

  it("enforces freshness boundaries and rejects unknown top-level fields", () => {
    const valid = observation();
    expect(runtimeObservationV2Schema.safeParse({
      ...valid,
      freshness: { status: "fresh", ageMs: 5_001, maxAgeMs: 5_000 },
    }).success).toBe(false);
    expect(runtimeObservationV2Schema.safeParse({
      ...valid,
      freshness: { status: "stale", ageMs: 5_001, maxAgeMs: 5_000 },
    }).success).toBe(true);
    expect(runtimeObservationV2Schema.safeParse({ ...valid, debugDump: "not allowed" }).success).toBe(false);
  });
});
