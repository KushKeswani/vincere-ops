import { describe, expect, it } from "vitest";

import type { RuntimeObservationV2, RuntimeObservationV2State } from "./runtime-observation-v2";
import { analyzeFeedAndAlgoHealth, type FeedAlgoHealthObservationInput } from "./feed-algo-health";

const now = "2026-07-21T12:00:30.000Z";
const complete = (itemCount: number) => ({ status: "complete" as const, itemCount, errors: [] });

function currentInput(): FeedAlgoHealthObservationInput {
  const state: RuntimeObservationV2State = {
    process: {
      processRef: "process_abcdefghijklmnop",
      status: "running",
      health: "healthy",
      version: "8.1.7.2",
      startedAt: "2026-07-21T11:00:00.000Z",
    },
    addon: {
      addonRef: "addon_abcdefghijklmnop",
      status: "connected",
      health: "healthy",
      version: "2.0.0",
      ipcAuthenticated: true,
      capabilities: ["GET_RUNTIME_OBSERVATION_V2"],
    },
    connections: [{
      connectionRef: "conn_abcdefghijklmnop",
      displayLabel: "Connection 1",
      kind: "simulation",
      providerCode: "TRADOVATE",
      status: "connected",
      health: "healthy",
      marketDataStatus: "live",
      lastStateChangeAt: "2026-07-21T11:59:00.000Z",
    }],
    accounts: [{
      accountRef: "acct_abcdefghijklmnop",
      maskedIdentifier: "******M101",
      identifierFingerprint: `hmac-sha256:${"a".repeat(64)}`,
      displayLabel: "Simulation account 1",
      classification: { environment: "simulation", authority: "authoritative", source: "ninjatrader_simulation_account" },
      connectionRefs: ["conn_abcdefghijklmnop"],
      status: "connected",
    }],
    strategies: [{
      strategyRef: "strat_abcdefghijklmnop",
      accountRef: "acct_abcdefghijklmnop",
      displayLabel: "Strategy 1",
      strategyTypeCode: "VINCERE_STEADY",
      instrumentCode: "MNQ 09-26",
      enabled: true,
      runtimeState: "running",
      synchronizationState: "synchronized",
      operationalParameters: [],
      lastStateChangeAt: "2026-07-21T11:59:00.000Z",
    }],
    positions: [],
    orders: [],
    executions: [],
    pnl: [],
    collection: {
      overall: "complete",
      scopes: {
        process: complete(1), addon: complete(1), connections: complete(1), accounts: complete(1),
        strategies: complete(1), positions: complete(0), orders: complete(0), executions: complete(0), pnl: complete(0),
      },
    },
  };
  const observation: RuntimeObservationV2 = {
    protocolVersion: "runtime-observation/2.0",
    observationId: "00000000-0000-4000-8000-000000000001",
    source: {
      collector: "vps_companion_agent",
      authority: "ninjatrader_runtime",
      installationRef: "install_abcdefghijklmnop",
      collectionSessionRef: "session_abcdefghijklmnop",
    },
    asOf: "2026-07-21T12:00:00.000Z",
    freshness: { status: "fresh", ageMs: 0, maxAgeMs: 45_000 },
    stateDigest: `sha256:${"b".repeat(64)}`,
    state,
  };
  return { observation, occurredAt: "2026-07-21T12:00:00.500Z", receivedAt: "2026-07-21T12:00:01.000Z" };
}

function codes(input: FeedAlgoHealthObservationInput | null, prior?: FeedAlgoHealthObservationInput): string[] {
  return analyzeFeedAndAlgoHealth({ current: input, prior, now }).findings.map((row) => row.code);
}

describe("Feed & Algo Health v1", () => {
  it("fails closed for missing, stale, and future-dated observations", () => {
    expect(codes(null)).toContain("OBSERVATION_MISSING");
    const stale = currentInput();
    stale.observation.asOf = "2026-07-21T11:00:00.000Z";
    expect(codes(stale)).toContain("OBSERVATION_STALE");
    const future = currentInput();
    future.observation.asOf = "2026-07-21T13:00:00.000Z";
    expect(codes(future)).toContain("OBSERVATION_TIME_UNTRUSTWORTHY");
  });

  it("fails closed for invalid, reversed, or future event chronology", () => {
    const cases: Array<Partial<Pick<FeedAlgoHealthObservationInput, "occurredAt" | "receivedAt">>> = [
      { occurredAt: "not-a-time" },
      { occurredAt: "2026-07-21T11:59:59.000Z" },
      { occurredAt: "2026-07-21T12:00:02.000Z", receivedAt: "2026-07-21T12:00:01.000Z" },
      { receivedAt: "2026-07-21T12:00:31.000Z" },
    ];
    for (const values of cases) {
      const input = currentInput();
      Object.assign(input, values);
      expect(codes(input), JSON.stringify(values)).toContain("OBSERVATION_TIME_UNTRUSTWORTHY");
    }
  });

  it("computes freshness from the earliest timestamp in the valid evidence chain", () => {
    const input = currentInput();
    input.observation.asOf = "2026-07-21T11:59:40.000Z";
    input.occurredAt = "2026-07-21T12:00:00.000Z";
    input.receivedAt = "2026-07-21T12:00:01.000Z";
    input.observation.freshness.maxAgeMs = 45_000;
    expect(codes(input)).toContain("OBSERVATION_STALE");
  });

  it("diagnoses offline, unauthenticated, degraded, and unsettled Add-On evidence", () => {
    const offline = currentInput();
    offline.observation.state.addon = null;
    expect(codes(offline)).toContain("ADDON_OFFLINE");
    const unauthenticated = currentInput();
    unauthenticated.observation.state.addon!.ipcAuthenticated = false;
    expect(codes(unauthenticated)).toContain("ADDON_IPC_UNAUTHENTICATED");
    const degraded = currentInput();
    degraded.observation.state.addon!.health = "degraded";
    expect(codes(degraded)).toContain("ADDON_DEGRADED");
    const unknown = currentInput();
    unknown.observation.state.addon!.status = "unknown";
    unknown.observation.state.addon!.health = "unknown";
    expect(codes(unknown)).toContain("ADDON_STATE_UNKNOWN");
  });

  it.each(["disconnected", "error", "unknown"] as const)("diagnoses %s order-adapter state separately", (status) => {
    const input = currentInput();
    input.observation.state.connections[0].status = status;
    expect(codes(input)).toContain(`ORDER_CONNECTION_${status.toUpperCase()}`);
  });

  it.each(["unavailable", "stale", "unknown"] as const)("diagnoses connected order adapter with %s price feed", (marketDataStatus) => {
    const input = currentInput();
    input.observation.state.connections[0].marketDataStatus = marketDataStatus;
    expect(codes(input)).toContain(`PRICE_FEED_${marketDataStatus.toUpperCase()}`);
  });

  it("diagnoses delayed and degraded price/provider health", () => {
    const input = currentInput();
    input.observation.state.connections[0].marketDataStatus = "delayed";
    input.observation.state.connections[0].health = "degraded";
    expect(codes(input)).toEqual(expect.arrayContaining(["PRICE_FEED_DELAYED", "CONNECTION_DEGRADED"]));
  });

  it("flags a long transition only with a trustworthy state-change timestamp", () => {
    const input = currentInput();
    input.observation.state.connections[0].status = "connecting";
    input.observation.state.connections[0].lastStateChangeAt = "2026-07-21T11:58:00.000Z";
    expect(codes(input)).toContain("CONNECTION_TRANSITION_TOO_LONG");
    input.observation.state.connections[0].lastStateChangeAt = null;
    expect(codes(input)).not.toContain("CONNECTION_TRANSITION_TOO_LONG");
    input.observation.state.connections[0].lastStateChangeAt = "2026-07-21T12:01:00.000Z";
    expect(codes(input)).not.toContain("CONNECTION_TRANSITION_TOO_LONG");
  });

  it("keeps multiple-provider instrument routing ambiguous", () => {
    const input = currentInput();
    input.observation.state.connections.push({
      ...input.observation.state.connections[0],
      connectionRef: "conn_bcdefghijklmnopq",
      displayLabel: "Connection 2",
      kind: "market_data",
      providerCode: "SECONDARY",
    });
    expect(codes(input)).toContain("PROVIDER_ROUTING_AMBIGUOUS");
  });

  it.each(["disconnected", "unavailable", "unknown"] as const)("diagnoses %s account state with masked identity only", (status) => {
    const input = currentInput();
    input.observation.state.accounts[0].status = status;
    const analysis = analyzeFeedAndAlgoHealth({ current: input, now });
    expect(analysis.findings.map((row) => row.code)).toContain(`ACCOUNT_${status.toUpperCase()}`);
    const serialized = JSON.stringify(analysis);
    expect(serialized).toContain("******M101");
    expect(serialized).not.toContain("acct_abcdefghijklmnop");
    expect(serialized).not.toContain("hmac-sha256");
  });

  it("diagnoses disabled, error, unknown, waiting-sync, and not-synchronized strategy states", () => {
    const expected: Array<[string, Partial<RuntimeObservationV2State["strategies"][number]>]> = [
      ["STRATEGY_DISABLED_OBSERVED", { enabled: false, runtimeState: "disabled", synchronizationState: "not_applicable" }],
      ["STRATEGY_ERROR_OBSERVED", { enabled: false, runtimeState: "error" }],
      ["STRATEGY_STATE_UNKNOWN", { enabled: true, runtimeState: "unknown", synchronizationState: "unknown" }],
      ["STRATEGY_WAITING_FOR_SYNC", { enabled: true, runtimeState: "waiting_sync", synchronizationState: "pending" }],
      ["STRATEGY_NOT_SYNCHRONIZED", { enabled: true, runtimeState: "enabling", synchronizationState: "not_synchronized" }],
    ];
    for (const [code, values] of expected) {
      const input = currentInput();
      Object.assign(input.observation.state.strategies[0], values);
      expect(codes(input), code).toContain(code);
    }
  });

  it("diagnoses working, transitional, and unknown orders", () => {
    for (const [state, expected] of [
      ["working", "WORKING_ORDERS_PRESENT"],
      ["change_pending", "TRANSITIONAL_ORDERS_PRESENT"],
      ["unknown", "ORDER_STATE_UNKNOWN"],
    ] as const) {
      const input = currentInput();
      input.observation.state.orders = [{
        orderRef: "ord_abcdefghijklmnop", accountRef: "acct_abcdefghijklmnop", strategyRef: "strat_abcdefghijklmnop",
        instrumentCode: "MNQ 09-26", lifecycle: "working", state, side: "buy", orderType: "limit",
        quantity: 1, filledQuantity: 0, limitPrice: 20_000, stopPrice: null,
        submittedAt: "2026-07-21T11:59:00.000Z", completedAt: null,
      }];
      expect(codes(input)).toContain(expected);
    }
  });

  it("diagnoses open and unknown positions plus unknown order coverage", () => {
    const input = currentInput();
    input.observation.state.positions = [{
      positionRef: "pos_abcdefghijklmnop", accountRef: "acct_abcdefghijklmnop", strategyRef: "strat_abcdefghijklmnop",
      instrumentCode: "MNQ 09-26", side: "long", quantity: 1, averagePrice: 20_000, markPrice: 20_001,
    }];
    input.observation.state.collection.scopes.positions = {
      status: "partial", itemCount: 1, errors: [{ code: "CAPABILITY_UNSUPPORTED", retryable: false }],
    };
    input.observation.state.collection.scopes.orders = {
      status: "unavailable", itemCount: 0, errors: [{ code: "ADDON_OFFLINE", retryable: true }],
    };
    expect(codes(input)).toEqual(expect.arrayContaining([
      "OPEN_POSITIONS_PRESENT", "POSITIONS_UNKNOWN", "ORDERS_UNKNOWN", "SCOPE_POSITIONS_PARTIAL", "SCOPE_ORDERS_UNAVAILABLE",
    ]));
  });

  it("does not claim recovery when a prior non-connected provider becomes connected", () => {
    const prior = currentInput();
    prior.observation.state.connections[0].status = "disconnected";
    const current = currentInput();
    const analysis = analyzeFeedAndAlgoHealth({ current, prior, now });
    expect(analysis.findings.map((row) => row.code)).toContain("CONNECTION_RETURNED_UNVERIFIED");
    expect(analysis.findings.find((row) => row.code === "CONNECTION_RETURNED_UNVERIFIED")?.title).toContain("not established");
    expect(JSON.stringify(analysis)).not.toContain("Strategies recovered successfully");
  });

  it("excludes an optional prior observation with untrustworthy chronology", () => {
    const prior = currentInput();
    prior.observation.state.connections[0].status = "disconnected";
    prior.occurredAt = "2026-07-21T12:00:02.000Z";
    prior.receivedAt = "2026-07-21T12:00:01.000Z";
    const result = codes(currentInput(), prior);
    expect(result).toContain("PRIOR_OBSERVATION_TIME_UNTRUSTWORTHY");
    expect(result).not.toContain("CONNECTION_RETURNED_UNVERIFIED");
  });
});
