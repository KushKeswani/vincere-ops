import { describe, expect, it, vi } from "vitest";

import { MutationReadinessPreflightCollector } from "./mutation-readiness-preflight-collector";

function payload(completedAt = "2026-07-26T12:00:00.100Z") {
  return {
    protocolVersion: "ninjatrader-addon-mutation-readiness/1.0",
    startedAt: "2026-07-26T12:00:00.000Z",
    completedAt,
    sampleCount: 2,
    consistencyMethod: "bounded_consecutive_stability",
    atomicity: "not_guaranteed",
    status: "ready",
    blockerCodes: [],
    summary: {
      stateDigest: `hmac-sha256:${"b".repeat(64)}`,
      accounts: {
        total: 1,
        simulation: 1,
        nonSimulationOrUnknown: 0,
        connected: 1,
        disconnectedOrUnknown: 0,
      },
      strategies: { total: 0, enabled: 0, unknown: 0 },
      positions: { open: 0, unknown: 0 },
      orders: { working: 0, transitional: 0, unknown: 0 },
    },
  };
}

describe("MutationReadinessPreflightCollector", () => {
  it("uses only the additive authenticated read-only command", async () => {
    const send = vi.fn().mockResolvedValue({ payload: payload() });
    const collector = new MutationReadinessPreflightCollector({
      pipeName: "VincereNinjaManager.v1",
      freshnessMaxAgeMs: 2_000,
    }, {
      ipcSender: { send },
      localIpcSecret: Buffer.alloc(32, 9),
      now: () => new Date("2026-07-26T12:00:00.150Z"),
      uuid: () => "10000000-0000-4000-8000-000000000002",
    });

    const result = await collector.collect();
    expect(send).toHaveBeenCalledWith({
      command: "GET_MUTATION_READINESS_PREFLIGHT",
      payload: {},
      secret: Buffer.alloc(32, 9),
      pipeName: "VincereNinjaManager.v1",
    });
    expect(result.source.ipcAuthenticated).toBe(true);
    expect(result.expiresAt).toBe("2026-07-26T12:00:02.100Z");
  });

  it("fails closed on stale responses", async () => {
    const collector = new MutationReadinessPreflightCollector({
      pipeName: "VincereNinjaManager.v1",
      freshnessMaxAgeMs: 500,
    }, {
      ipcSender: { send: async () => ({ payload: payload() }) },
      localIpcSecret: Buffer.alloc(32, 9),
      now: () => new Date("2026-07-26T12:00:00.601Z"),
    });

    await expect(collector.collect()).rejects.toThrow("stale");
  });

  it("fails closed on malformed or partial Add-On claims", async () => {
    const collector = new MutationReadinessPreflightCollector({
      pipeName: "VincereNinjaManager.v1",
      freshnessMaxAgeMs: 500,
    }, {
      ipcSender: {
        send: async () => ({
          payload: { ...payload(), status: "ready", summary: null },
        }),
      },
      localIpcSecret: Buffer.alloc(32, 9),
      now: () => new Date("2026-07-26T12:00:00.150Z"),
    });

    await expect(collector.collect()).rejects.toThrow();
  });
});
