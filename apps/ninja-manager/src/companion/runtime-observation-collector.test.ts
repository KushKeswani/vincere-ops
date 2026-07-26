import { describe, expect, it, vi } from "vitest";

import {
  RAW_NINJATRADER_ADDON_SNAPSHOT_V2_PROTOCOL,
  type RawNinjaTraderAddonSnapshotV2,
} from "./runtime-adapter-v2";
import {
  RuntimeObservationV2Collector,
  type AuthenticatedRuntimeObservationIpcSender,
  type CompanionProcessObservationV2,
  type RuntimeObservationV2CollectorConfig,
  type RuntimeObservationV2CollectorDependencies,
} from "./runtime-observation-collector";

const UUID = "10000000-0000-4000-8000-000000000001";
const OBSERVED_AT = "2026-07-21T12:00:00.000Z";
const ACCOUNT_LOCAL_ID = "raw-account-id-never-return";

const complete = { status: "complete" as const, errors: [] };
const unavailableMoney = {
  availability: "unavailable" as const,
  currency: "USD" as const,
  amountMinor: null,
  source: null,
  reasonCode: "NOT_OBSERVED_YET" as const,
};

function addonSnapshot(): RawNinjaTraderAddonSnapshotV2 {
  return {
    protocolVersion: RAW_NINJATRADER_ADDON_SNAPSHOT_V2_PROTOCOL,
    observedAt: OBSERVED_AT,
    addon: {
      localId: "raw-addon-id-never-return",
      status: "connected",
      health: "healthy",
      version: "2.0.0",
      ipcAuthenticated: true,
      capabilities: ["ACCOUNT_PNL", "RUNTIME_DISCOVERY"],
    },
    connections: [{
      localId: "raw-connection-id-never-return",
      kind: "simulation",
      providerCode: "TRADOVATE",
      status: "connected",
      health: "healthy",
      marketDataStatus: "live",
      lastStateChangeAt: "2026-07-21T11:59:00.000Z",
    }],
    accounts: [{
      localId: ACCOUNT_LOCAL_ID,
      accountIdentifier: "private-account-Sim101",
      classificationEvidence: {
        accountType: "simulation",
        isSimulation: true,
        simulationMode: true,
        unavailableReasonCode: null,
      },
      connectionLocalIds: ["raw-connection-id-never-return"],
      status: "connected",
    }],
    strategies: [],
    positions: [],
    orders: [],
    executions: [],
    pnl: [{
      accountLocalId: ACCOUNT_LOCAL_ID,
      sessionDate: "2026-07-21",
      daily: {
        realized: {
          availability: "available",
          currency: "USD",
          amountMinor: 12_500,
          source: "ninjatrader_performance",
        },
        unrealized: {
          availability: "available",
          currency: "USD",
          amountMinor: 2_050,
          source: "ninjatrader_account_item",
        },
      },
      nativeLifetime: {
        availability: "available",
        currency: "USD",
        amountMinor: 1_250_000,
        source: "ninjatrader_performance",
      },
    }],
    collectionScopes: {
      addon: complete,
      connections: complete,
      accounts: complete,
      strategies: complete,
      positions: complete,
      orders: complete,
      executions: complete,
      pnl: complete,
    },
  };
}

function runningProcess(): CompanionProcessObservationV2 {
  return {
    process: {
      processRef: `process_${"a".repeat(64)}`,
      status: "running",
      health: "healthy",
      version: "8.1.7.2",
      startedAt: "2026-07-21T11:00:00.000Z",
      observedAt: "2026-07-21T12:00:00.100Z",
    },
    processCollectionScope: complete,
  };
}

function availableLedger() {
  return {
    [ACCOUNT_LOCAL_ID]: {
      value: {
        availability: "available" as const,
        currency: "USD" as const,
        amountMinor: 750_000,
        source: "manager_ledger" as const,
      },
      observedSince: "2026-01-01T00:00:00.000Z",
    },
  };
}

function config(overrides: Partial<RuntimeObservationV2CollectorConfig> = {}): RuntimeObservationV2CollectorConfig {
  return {
    installationLocalId: "local-edith-installation",
    collectionSessionLocalId: "local-collection-session",
    freshnessMaxAgeMs: 5_000,
    pipeName: "VincereNinjaManager.v1",
    ...overrides,
  };
}

function dependencies(input: {
  snapshot?: unknown;
  process?: unknown;
  ledger?: unknown;
  now?: Date;
  ipcError?: Error;
  identitySecret?: Buffer;
  localIpcSecret?: Buffer;
} = {}): RuntimeObservationV2CollectorDependencies & {
  ipcSender: AuthenticatedRuntimeObservationIpcSender & { send: ReturnType<typeof vi.fn> };
} {
  const sender = {
    send: vi.fn(async () => {
      if (input.ipcError) throw input.ipcError;
      return { payload: input.snapshot ?? addonSnapshot() };
    }),
  };
  return {
    ipcSender: sender,
    processProvider: { observe: vi.fn(async () => input.process ?? runningProcess()) },
    managerLedgerProvider: { readCumulativePnl: vi.fn(async () => input.ledger ?? availableLedger()) },
    localIpcSecret: input.localIpcSecret ?? Buffer.alloc(32, 7),
    identitySecret: input.identitySecret ?? Buffer.alloc(32, 9),
    uuid: () => UUID,
    now: () => input.now ?? new Date("2026-07-21T12:00:00.250Z"),
  };
}

describe("RuntimeObservationV2Collector", () => {
  it("collects a complete observation and sends only the exact read-only IPC command", async () => {
    const deps = dependencies();
    const observation = await new RuntimeObservationV2Collector(config(), deps).collect();

    expect(observation.state.collection.overall).toBe("complete");
    expect(observation.freshness).toEqual({ status: "fresh", ageMs: 250, maxAgeMs: 5_000 });
    expect(deps.ipcSender.send).toHaveBeenCalledOnce();
    expect(deps.ipcSender.send).toHaveBeenCalledWith({
      command: "GET_RUNTIME_OBSERVATION_V2",
      payload: {},
      secret: Buffer.alloc(32, 7),
      pipeName: "VincereNinjaManager.v1",
    });
  });

  it("samples receipt after the IPC response and never returns local identifiers", async () => {
    let responseReturned = false;
    const deps = dependencies();
    deps.ipcSender.send = vi.fn(async () => {
      responseReturned = true;
      return { payload: addonSnapshot() };
    });
    deps.now = () => {
      expect(responseReturned).toBe(true);
      return new Date("2026-07-21T12:00:00.250Z");
    };

    const observation = await new RuntimeObservationV2Collector(config(), deps).collect();
    const serialized = JSON.stringify(observation);
    for (const localValue of [
      ACCOUNT_LOCAL_ID,
      "private-account-Sim101",
      "raw-addon-id-never-return",
      "raw-connection-id-never-return",
      "raw-process-id-never-return",
      "local-edith-installation",
      "local-collection-session",
    ]) expect(serialized).not.toContain(localValue);
  });

  it("records final receipt only after companion-owned process and ledger evidence", async () => {
    const deps = dependencies();
    let clockCall = 0;
    deps.now = () => new Date(clockCall++ === 0
      ? "2026-07-21T12:00:00.250Z"
      : "2026-07-21T12:00:00.500Z");
    deps.processProvider.observe = vi.fn(async (query) => {
      expect(query.receivedAt).toBe("2026-07-21T12:00:00.250Z");
      return {
        ...runningProcess(),
        process: {
          ...runningProcess().process,
          observedAt: "2026-07-21T12:00:00.400Z",
        },
      };
    });
    deps.managerLedgerProvider.readCumulativePnl = vi.fn(async (query) => {
      expect(query.receivedAt).toBe("2026-07-21T12:00:00.250Z");
      return availableLedger();
    });

    const observation = await new RuntimeObservationV2Collector(config(), deps).collect();
    expect(observation.freshness.ageMs).toBe(500);
    expect(observation.state.process?.observedAt).toBe("2026-07-21T12:00:00.400Z");
    expect(clockCall).toBe(2);
  });

  it("preserves an explicit unavailable manager-ledger observation", async () => {
    const ledger = {
      [ACCOUNT_LOCAL_ID]: { value: unavailableMoney, observedSince: null },
    };
    const observation = await new RuntimeObservationV2Collector(
      config(),
      dependencies({ ledger }),
    ).collect();

    expect(observation.state.pnl[0].managerObservedCumulative).toEqual(ledger[ACCOUNT_LOCAL_ID]);
  });

  it("rejects missing and extra manager-ledger account keys", async () => {
    await expect(new RuntimeObservationV2Collector(
      config(),
      dependencies({ ledger: {} }),
    ).collect()).rejects.toThrow(/exactly match/);

    await expect(new RuntimeObservationV2Collector(
      config(),
      dependencies({
        ledger: {
          ...availableLedger(),
          "extra-local-account": { value: unavailableMoney, observedSince: null },
        },
      }),
    ).collect()).rejects.toThrow(/exactly match/);
  });

  it("makes unavailable process evidence explicitly incomplete", async () => {
    const unavailable = await new RuntimeObservationV2Collector(config(), dependencies({
      process: {
        process: null,
        processCollectionScope: {
          status: "unavailable",
          errors: [{ code: "SOURCE_ERROR", retryable: true }],
        },
      },
    })).collect();
    expect(unavailable.state.collection).toMatchObject({
      overall: "partial",
      scopes: { process: { status: "unavailable", itemCount: 0 } },
    });

    const partial = await new RuntimeObservationV2Collector(config(), dependencies({
      process: {
        process: null,
        processCollectionScope: {
          status: "partial",
          errors: [{ code: "SOURCE_ERROR", retryable: true }],
        },
      },
    })).collect();
    expect(partial.state.collection).toMatchObject({
      overall: "partial",
      scopes: { process: { status: "partial", itemCount: 0 } },
    });
  });

  it("accepts an exact complete not-running process observation", async () => {
    const observation = await new RuntimeObservationV2Collector(config(), dependencies({
      process: {
        process: {
          processRef: null,
          status: "not_running",
          health: "offline",
          version: null,
          startedAt: null,
          observedAt: "2026-07-21T12:00:00.100Z",
        },
        processCollectionScope: complete,
      },
    })).collect();
    expect(observation.state.process).toEqual({
      processRef: null,
      status: "not_running",
      health: "offline",
      version: null,
      startedAt: null,
      observedAt: "2026-07-21T12:00:00.100Z",
    });
    expect(observation.state.collection.scopes.process).toMatchObject({
      status: "complete",
      itemCount: 1,
    });
  });

  it("marks late receipts stale and rejects future observations", async () => {
    const stale = await new RuntimeObservationV2Collector(
      config(),
      dependencies({ now: new Date("2026-07-21T12:00:06.000Z") }),
    ).collect();
    expect(stale.freshness).toEqual({ status: "stale", ageMs: 6_000, maxAgeMs: 5_000 });

    await expect(new RuntimeObservationV2Collector(
      config(),
      dependencies({ now: new Date("2026-07-21T11:59:59.999Z") }),
    ).collect()).rejects.toThrow(/freshness cannot be measured|observed after final companion receipt/);
  });

  it("rejects malformed Add-On payloads before asking local evidence providers", async () => {
    const deps = dependencies({ snapshot: { ...addonSnapshot(), debugDump: "forbidden" } });
    await expect(new RuntimeObservationV2Collector(config(), deps).collect()).rejects.toThrow();
    expect(deps.processProvider.observe).not.toHaveBeenCalled();
    expect(deps.managerLedgerProvider.readCumulativePnl).not.toHaveBeenCalled();
  });

  it("rejects invalid secret lengths and unknown collector configuration", () => {
    expect(() => new RuntimeObservationV2Collector(
      config(),
      dependencies({ localIpcSecret: Buffer.alloc(31) }),
    )).toThrow(/Local IPC secret.*exactly 32 bytes/);
    expect(() => new RuntimeObservationV2Collector(
      config(),
      dependencies({ identitySecret: Buffer.alloc(33) }),
    )).toThrow(/Identity secret.*exactly 32 bytes/);
    expect(() => new RuntimeObservationV2Collector(
      { ...config(), unexpected: true } as RuntimeObservationV2CollectorConfig,
      dependencies(),
    )).toThrow();
  });

  it("propagates authenticated pipe sender failures without fabricating an observation", async () => {
    const error = new Error("signed pipe response rejected");
    await expect(new RuntimeObservationV2Collector(
      config(),
      dependencies({ ipcError: error }),
    ).collect()).rejects.toBe(error);
  });

  it("derives deterministic opaque identities from the identity secret", async () => {
    const first = await new RuntimeObservationV2Collector(config(), dependencies()).collect();
    const second = await new RuntimeObservationV2Collector(config(), dependencies()).collect();
    const changed = await new RuntimeObservationV2Collector(
      config(),
      dependencies({ identitySecret: Buffer.alloc(32, 10) }),
    ).collect();

    expect(second.source).toEqual(first.source);
    expect(second.state.accounts[0].accountRef).toBe(first.state.accounts[0].accountRef);
    expect(second.state.accounts[0].identifierFingerprint)
      .toBe(first.state.accounts[0].identifierFingerprint);
    expect(second.stateDigest).toBe(first.stateDigest);
    expect(changed.state.accounts[0].accountRef).not.toBe(first.state.accounts[0].accountRef);
  });
});
