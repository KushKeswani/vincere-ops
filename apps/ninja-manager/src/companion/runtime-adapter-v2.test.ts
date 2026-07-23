import { describe, expect, it } from "vitest";

import { parseRuntimeObservationV2 } from "@/lib/domain/runtime-observation-v2";

import { adaptAddonSnapshot } from "./runtime-adapter";
import {
  RAW_ADDON_RUNTIME_OBSERVATION_V2_PROTOCOL,
  RAW_NINJATRADER_ADDON_SNAPSHOT_V2_PROTOCOL,
  adaptAddonRuntimeObservationV2,
  assembleNinjaTraderAddonRuntimeObservationV2,
  rawAddonRuntimeObservationV2Schema,
  rawNinjaTraderAddonSnapshotV2Schema,
  type CompanionRuntimeObservationV2Metadata,
  type RawAddonRuntimeObservationV2,
  type RawNinjaTraderAddonSnapshotV2,
} from "./runtime-adapter-v2";

const completeScope = (itemCount: number) => ({ status: "complete" as const, itemCount, errors: [] });
const available = <T extends "ninjatrader_account_item" | "ninjatrader_performance" | "manager_ledger">(
  amountMinor: number,
  source: T,
) => ({ availability: "available" as const, currency: "USD" as const, amountMinor, source });

function rawObservation(): RawAddonRuntimeObservationV2 {
  return {
    protocolVersion: RAW_ADDON_RUNTIME_OBSERVATION_V2_PROTOCOL,
    observationId: "10000000-0000-4000-8000-000000000001",
    installationLocalId: "edith-installation-private",
    collectionSessionLocalId: "collection-session-private",
    observedAt: "2026-07-21T08:31:00.000-04:00",
    receivedAt: "2026-07-21T08:31:00.250-04:00",
    freshnessMaxAgeMs: 5_000,
    process: {
      localId: "nt-process-private",
      status: "running" as const,
      health: "healthy" as const,
      processId: 4242,
      version: "8.1.7.2",
      startedAt: "2026-07-21T08:00:00.000-04:00",
    },
    addon: {
      localId: "nt-addon-private",
      status: "connected" as const,
      health: "healthy" as const,
      version: "2.0.0",
      ipcAuthenticated: true,
      capabilities: ["RUNTIME_DISCOVERY", "ACCOUNT_PNL"],
    },
    connections: [{
      localId: "tradovate-private",
      kind: "simulation" as const,
      providerCode: "TRADOVATE",
      status: "connected" as const,
      health: "healthy" as const,
      marketDataStatus: "live" as const,
      lastStateChangeAt: "2026-07-21T08:00:10.000-04:00",
    }, {
      localId: "simulation-feed-private",
      kind: "simulation" as const,
      providerCode: "SIMULATED_DATA_FEED",
      status: "connected" as const,
      health: "healthy" as const,
      marketDataStatus: "live" as const,
      lastStateChangeAt: "2026-07-21T08:00:11.000-04:00",
    }],
    accounts: [{
      localId: "Sim101-local-private",
      accountIdentifier: "secret-Sim101",
      classificationEvidence: {
        accountType: "simulation" as const,
        isSimulation: true,
        simulationMode: true,
        unavailableReasonCode: null,
      },
      connectionLocalIds: ["tradovate-private", "simulation-feed-private"],
      status: "connected" as const,
    }],
    strategies: [{
      localId: "strategy-private",
      accountLocalId: "Sim101-local-private",
      strategyTypeCode: "Steady",
      instrumentCode: "MNQ SEP26",
      enabled: true,
      runtimeState: "running" as const,
      synchronizationState: "synchronized" as const,
      operationalParameters: [
        { parameterCode: "USE_BREAKEVEN", value: { kind: "boolean" as const, value: true } },
        { parameterCode: "CONTRACTS", value: { kind: "integer" as const, value: 1 } },
      ],
      lastStateChangeAt: "2026-07-21T08:30:00.000-04:00",
    }],
    positions: [{
      localId: "position-private",
      accountLocalId: "Sim101-local-private",
      strategyLocalId: "strategy-private",
      instrumentCode: "MNQ SEP26",
      side: "long" as const,
      quantity: 1,
      averagePrice: 22_500.25,
      markPrice: 22_510.5,
    }],
    orders: [{
      localId: "order-private",
      accountLocalId: "Sim101-local-private",
      strategyLocalId: "strategy-private",
      instrumentCode: "MNQ SEP26",
      lifecycle: "completed" as const,
      state: "filled" as const,
      side: "buy" as const,
      orderType: "market" as const,
      quantity: 1,
      filledQuantity: 1,
      limitPrice: null,
      stopPrice: null,
      submittedAt: "2026-07-21T08:30:00.000-04:00",
      completedAt: "2026-07-21T08:30:00.100-04:00",
    }],
    executions: [{
      localId: "execution-private",
      orderLocalId: "order-private",
      accountLocalId: "Sim101-local-private",
      strategyLocalId: "strategy-private",
      instrumentCode: "MNQ SEP26",
      side: "buy" as const,
      quantity: 1,
      price: 22_500.25,
      commissionMinor: 62,
      executedAt: "2026-07-21T08:30:00.050-04:00",
    }],
    pnl: [{
      accountLocalId: "Sim101-local-private",
      sessionDate: "2026-07-21",
      daily: {
        realized: available(12_500, "ninjatrader_performance"),
        unrealized: available(2_050, "ninjatrader_account_item"),
      },
      nativeLifetime: available(1_250_000, "ninjatrader_performance"),
      managerObservedCumulative: {
        value: available(750_000, "manager_ledger"),
        observedSince: "2026-01-01T00:00:00.000-05:00",
      },
    }],
    collection: {
      overall: "complete" as const,
      scopes: {
        process: completeScope(1),
        addon: completeScope(1),
        connections: completeScope(2),
        accounts: completeScope(1),
        strategies: completeScope(1),
        positions: completeScope(1),
        orders: completeScope(1),
        executions: completeScope(1),
        pnl: completeScope(1),
      },
    },
  };
}

function separatedObservation(): {
  addon: RawNinjaTraderAddonSnapshotV2;
  metadata: CompanionRuntimeObservationV2Metadata;
} {
  const raw = rawObservation();
  const managerObservedCumulativeByAccountLocalId: CompanionRuntimeObservationV2Metadata["managerObservedCumulativeByAccountLocalId"] = {};
  const pnl = raw.pnl.map(({ managerObservedCumulative, ...addonPnl }) => {
    managerObservedCumulativeByAccountLocalId[addonPnl.accountLocalId] = managerObservedCumulative;
    return addonPnl;
  });
  const statusOnly = (scope: RawAddonRuntimeObservationV2["collection"]["scopes"]["accounts"]) => ({
    status: scope.status,
    errors: [...scope.errors],
  });

  return {
    addon: {
      protocolVersion: RAW_NINJATRADER_ADDON_SNAPSHOT_V2_PROTOCOL,
      observedAt: raw.observedAt,
      addon: raw.addon,
      connections: raw.connections,
      accounts: raw.accounts,
      strategies: raw.strategies,
      positions: raw.positions,
      orders: raw.orders,
      executions: raw.executions,
      pnl,
      collectionScopes: {
        addon: statusOnly(raw.collection.scopes.addon),
        connections: statusOnly(raw.collection.scopes.connections),
        accounts: statusOnly(raw.collection.scopes.accounts),
        strategies: statusOnly(raw.collection.scopes.strategies),
        positions: statusOnly(raw.collection.scopes.positions),
        orders: statusOnly(raw.collection.scopes.orders),
        executions: statusOnly(raw.collection.scopes.executions),
        pnl: statusOnly(raw.collection.scopes.pnl),
      },
    },
    metadata: {
      observationId: raw.observationId,
      installationLocalId: raw.installationLocalId,
      collectionSessionLocalId: raw.collectionSessionLocalId,
      receivedAt: raw.receivedAt,
      freshnessMaxAgeMs: raw.freshnessMaxAgeMs,
      process: raw.process,
      processCollectionScope: statusOnly(raw.collection.scopes.process),
      managerObservedCumulativeByAccountLocalId,
    },
  };
}

describe("runtime observation v2 adapter", () => {
  it("adapts a complete local runtime observation and computes canonical P&L and digest", () => {
    const observation = adaptAddonRuntimeObservationV2(rawObservation(), Buffer.alloc(32, 9));

    expect(parseRuntimeObservationV2(observation)).toEqual(observation);
    expect(observation.freshness).toEqual({ status: "fresh", ageMs: 250, maxAgeMs: 5_000 });
    expect(observation.state.accounts[0]).toMatchObject({
      maskedIdentifier: "****m101",
      displayLabel: "Simulation account 1",
      classification: { environment: "simulation", authority: "authoritative" },
    });
    expect(observation.state.pnl[0].daily.total).toEqual({
      availability: "available",
      currency: "USD",
      amountMinor: 14_550,
      source: "calculated_by_companion",
    });
    expect(observation.state.addon?.capabilities).toEqual(["ACCOUNT_PNL", "RUNTIME_DISCOVERY"]);
    expect(observation.state.strategies[0].operationalParameters.map((entry) => entry.parameterCode)).toEqual(["CONTRACTS", "USE_BREAKEVEN"]);
    expect(observation.stateDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it("removes every raw account and related local identifier from the returned DTO", () => {
    const observation = adaptAddonRuntimeObservationV2(rawObservation(), Buffer.alloc(32, 7));
    const serialized = JSON.stringify(observation);

    for (const rawValue of [
      "secret-Sim101",
      "Sim101-local-private",
      "edith-installation-private",
      "collection-session-private",
      "nt-process-private",
      "nt-addon-private",
      "tradovate-private",
      "simulation-feed-private",
      "strategy-private",
      "position-private",
      "order-private",
      "execution-private",
    ]) expect(serialized).not.toContain(rawValue);
    expect(observation.state.accounts[0].identifierFingerprint).toMatch(/^hmac-sha256:[a-f0-9]{64}$/);
    expect(observation.state.accounts[0].accountRef).toMatch(/^acct_[a-f0-9]{32}$/);
  });

  it("is deterministic and canonicalizes input ordering", () => {
    const raw = rawObservation();
    const reordered = {
      ...raw,
      connections: [...raw.connections].reverse(),
      accounts: [{ ...raw.accounts[0], connectionLocalIds: [...raw.accounts[0].connectionLocalIds].reverse() }],
    };
    const secret = Buffer.alloc(32, 5);

    expect(adaptAddonRuntimeObservationV2(reordered, secret)).toEqual(adaptAddonRuntimeObservationV2(raw, secret));
    expect(adaptAddonRuntimeObservationV2(raw, Buffer.alloc(32, 6)).state.accounts[0].accountRef)
      .not.toBe(adaptAddonRuntimeObservationV2(raw, secret).state.accounts[0].accountRef);
  });

  it("preserves v1 account and strategy identity across the v2 observation migration", () => {
    const raw = rawObservation();
    const secret = Buffer.alloc(32, 15);
    const v1 = adaptAddonSnapshot({
      observedAt: raw.observedAt,
      addonVersion: raw.addon?.version ?? "2.0.0",
      accounts: [{
        localId: raw.accounts[0].localId,
        accountName: raw.accounts[0].accountIdentifier,
        accountKind: "simulation",
        connectionName: "Simulated Data Feed",
        connectionStatus: "connected",
      }],
      strategies: [{
        localId: raw.strategies[0].localId,
        accountLocalId: raw.accounts[0].localId,
        strategyName: "Local only strategy name",
        strategyType: "Vincere.Steady",
        instrument: "MNQ 09-26",
        timeframe: "1 Minute",
        enabled: true,
        sync: true,
        runtimeState: "running",
        stateCode: "SYNCHRONIZED",
      }],
    }, secret);
    const v2 = adaptAddonRuntimeObservationV2(raw, secret);

    expect(v2.state.accounts[0].accountRef).toBe(v1.accounts[0].accountRef);
    expect(v2.state.accounts[0].identifierFingerprint).toBe(v1.accounts[0].identifierFingerprint);
    expect(v2.state.strategies[0].strategyRef).toBe(v1.strategies[0].strategyRef);
    expect(v2.state.strategies[0].strategyTypeCode).toBe(v1.strategies[0].strategyType);
    expect(v2.state.strategies[0].strategyTypeCode).toBe("Steady");
    expect(JSON.stringify(v2)).not.toContain(raw.accounts[0].localId);
    expect(JSON.stringify(v2)).not.toContain(raw.accounts[0].accountIdentifier);
    expect(v2.state.accounts[0].maskedIdentifier).toBe("****m101");
  });

  it("does not infer simulation authority from a Sim101-like identifier", () => {
    const raw = rawObservation();
    raw.accounts[0].classificationEvidence = {
      accountType: "unknown",
      isSimulation: null,
      simulationMode: null,
      unavailableReasonCode: "CLASSIFICATION_UNAVAILABLE",
    };

    const observation = adaptAddonRuntimeObservationV2(raw, Buffer.alloc(32, 3));
    expect(observation.state.accounts[0]).toMatchObject({
      maskedIdentifier: "****m101",
      displayLabel: "Unknown account 1",
      classification: {
        environment: "unknown",
        authority: "unavailable",
        reasonCode: "CLASSIFICATION_UNAVAILABLE",
      },
    });
  });

  it("fails closed for conflicting NinjaTrader classification evidence", () => {
    const raw = rawObservation();
    raw.accounts[0].classificationEvidence = {
      accountType: "live",
      isSimulation: true,
      simulationMode: true,
      unavailableReasonCode: null,
    };
    expect(() => adaptAddonRuntimeObservationV2(raw, Buffer.alloc(32, 3))).toThrow(/classification evidence conflicts/);
  });

  it("fails closed for broken account, strategy, order, and connection references", () => {
    const strategyBroken = rawObservation();
    strategyBroken.strategies[0].accountLocalId = "missing-account";
    expect(() => adaptAddonRuntimeObservationV2(strategyBroken, Buffer.alloc(32, 4))).toThrow(/outside this observation/);

    const orderBroken = rawObservation();
    orderBroken.executions[0].orderLocalId = "missing-order";
    expect(() => adaptAddonRuntimeObservationV2(orderBroken, Buffer.alloc(32, 4))).toThrow(/outside this observation/);

    const connectionBroken = rawObservation();
    connectionBroken.accounts[0].connectionLocalIds = ["missing-connection"];
    expect(() => adaptAddonRuntimeObservationV2(connectionBroken, Buffer.alloc(32, 4))).toThrow(/outside this observation/);

    const relationshipBroken = rawObservation();
    relationshipBroken.executions[0].instrumentCode = "ES SEP26";
    expect(() => adaptAddonRuntimeObservationV2(relationshipBroken, Buffer.alloc(32, 4))).toThrow(/inconsistent execution\/order/);
  });

  it("rejects incorrect identity-secret lengths before parsing or hashing", () => {
    expect(() => adaptAddonRuntimeObservationV2(rawObservation(), Buffer.alloc(31))).toThrow(/exactly 32 bytes/);
    expect(() => adaptAddonRuntimeObservationV2(rawObservation(), Buffer.alloc(33))).toThrow(/exactly 32 bytes/);
  });

  it("rejects unknown raw fields, stale count claims, and duplicate stable account identities", () => {
    expect(rawAddonRuntimeObservationV2Schema.safeParse({ ...rawObservation(), rawDebugDump: "forbidden" }).success).toBe(false);

    const wrongCount = rawObservation();
    wrongCount.collection.scopes.positions.itemCount = 0;
    expect(() => adaptAddonRuntimeObservationV2(wrongCount, Buffer.alloc(32, 8))).toThrow(/Collection count/);

    const duplicate = rawObservation();
    duplicate.accounts.push({
      ...duplicate.accounts[0],
      connectionLocalIds: [...duplicate.accounts[0].connectionLocalIds],
    });
    duplicate.pnl.push({ ...duplicate.pnl[0] });
    duplicate.collection.scopes.accounts.itemCount = 2;
    duplicate.collection.scopes.pnl.itemCount = 2;
    expect(() => adaptAddonRuntimeObservationV2(duplicate, Buffer.alloc(32, 8))).toThrow(/duplicate account local identifier/);
  });

  it("computes stale freshness and rejects future observations", () => {
    const stale = rawObservation();
    stale.receivedAt = "2026-07-21T08:31:06.000-04:00";
    expect(adaptAddonRuntimeObservationV2(stale, Buffer.alloc(32, 2)).freshness.status).toBe("stale");

    const future = rawObservation();
    future.receivedAt = "2026-07-21T08:30:59.999-04:00";
    expect(() => adaptAddonRuntimeObservationV2(future, Buffer.alloc(32, 2))).toThrow(/freshness cannot be measured/);
  });

  it("keeps companion-owned metadata and manager P&L outside the strict Add-On DTO", () => {
    const { addon, metadata } = separatedObservation();
    expect(rawNinjaTraderAddonSnapshotV2Schema.safeParse(addon).success).toBe(true);
    expect(rawNinjaTraderAddonSnapshotV2Schema.safeParse({ ...addon, installationLocalId: metadata.installationLocalId }).success).toBe(false);
    expect(rawNinjaTraderAddonSnapshotV2Schema.safeParse({ ...addon, receivedAt: metadata.receivedAt }).success).toBe(false);
    expect(rawNinjaTraderAddonSnapshotV2Schema.safeParse({ ...addon, process: metadata.process }).success).toBe(false);
    expect(rawNinjaTraderAddonSnapshotV2Schema.safeParse({
      ...addon,
      pnl: [{ ...addon.pnl[0], managerObservedCumulative: Object.values(metadata.managerObservedCumulativeByAccountLocalId)[0] }],
    }).success).toBe(false);
    expect(rawNinjaTraderAddonSnapshotV2Schema.safeParse({
      ...addon,
      collectionScopes: {
        ...addon.collectionScopes,
        accounts: { ...addon.collectionScopes.accounts, itemCount: addon.accounts.length },
      },
    }).success).toBe(false);
  });

  it("assembles the Add-On snapshot with strict companion evidence", () => {
    const raw = rawObservation();
    const { addon, metadata } = separatedObservation();
    const secret = Buffer.alloc(32, 12);

    expect(assembleNinjaTraderAddonRuntimeObservationV2(addon, metadata, secret))
      .toEqual(adaptAddonRuntimeObservationV2(raw, secret));
  });

  it("requires manager cumulative keys to exactly match the Add-On account inventory", () => {
    const { addon, metadata } = separatedObservation();
    expect(() => assembleNinjaTraderAddonRuntimeObservationV2(addon, {
      ...metadata,
      managerObservedCumulativeByAccountLocalId: {},
    }, Buffer.alloc(32, 13))).toThrow(/exactly match/);
    expect(() => assembleNinjaTraderAddonRuntimeObservationV2(addon, {
      ...metadata,
      managerObservedCumulativeByAccountLocalId: {
        ...metadata.managerObservedCumulativeByAccountLocalId,
        "unknown-account": Object.values(metadata.managerObservedCumulativeByAccountLocalId)[0],
      },
    }, Buffer.alloc(32, 13))).toThrow(/exactly match/);
  });

  it("derives all aggregate counts and overall completeness without fabricating manager availability", () => {
    const { addon, metadata } = separatedObservation();
    const accountLocalId = addon.accounts[0].localId;
    metadata.processCollectionScope = {
      status: "partial",
      errors: [{ code: "SOURCE_ERROR", retryable: true }],
    };
    metadata.managerObservedCumulativeByAccountLocalId[accountLocalId] = {
      value: {
        availability: "unavailable",
        currency: "USD",
        amountMinor: null,
        source: null,
        reasonCode: "NOT_OBSERVED_YET",
      },
      observedSince: null,
    };

    const observation = assembleNinjaTraderAddonRuntimeObservationV2(addon, metadata, Buffer.alloc(32, 14));
    expect(observation.state.collection).toMatchObject({
      overall: "partial",
      scopes: {
        process: { status: "partial", itemCount: 1 },
        connections: { itemCount: addon.connections.length },
        accounts: { itemCount: addon.accounts.length },
        strategies: { itemCount: addon.strategies.length },
        positions: { itemCount: addon.positions.length },
        orders: { itemCount: addon.orders.length },
        executions: { itemCount: addon.executions.length },
        pnl: { itemCount: addon.pnl.length },
      },
    });
    expect(observation.state.pnl[0].managerObservedCumulative).toMatchObject({
      value: { availability: "unavailable", reasonCode: "NOT_OBSERVED_YET" },
      observedSince: null,
    });
  });
});
