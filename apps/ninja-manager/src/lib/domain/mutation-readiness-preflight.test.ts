import { describe, expect, it } from "vitest";

import {
  addonMutationReadinessPayloadSchema,
  isFreshMutationReadinessEvidence,
  mutationReadinessPreflightSchema,
  permitsMutationActuation,
} from "./mutation-readiness-preflight";

const summary = {
  stateDigest: `hmac-sha256:${"a".repeat(64)}`,
  accounts: {
    total: 1,
    simulation: 1,
    nonSimulationOrUnknown: 0,
    connected: 1,
    disconnectedOrUnknown: 0,
  },
  strategies: { total: 1, enabled: 0, unknown: 0 },
  positions: { open: 0, unknown: 0 },
  orders: { working: 0, transitional: 0, unknown: 0 },
};

const addon = {
  protocolVersion: "ninjatrader-addon-mutation-readiness/1.0" as const,
  startedAt: "2026-07-26T12:00:00.000Z",
  completedAt: "2026-07-26T12:00:00.100Z",
  sampleCount: 2 as const,
  consistencyMethod: "bounded_consecutive_stability" as const,
  atomicity: "not_guaranteed" as const,
  status: "ready" as const,
  blockerCodes: [],
  summary,
};

describe("mutation readiness preflight contract", () => {
  it("accepts one stable authenticated simulation baseline", () => {
    expect(addonMutationReadinessPayloadSchema.parse(addon).status).toBe("ready");
  });

  it("rejects ready evidence with unknown or non-simulation state", () => {
    expect(addonMutationReadinessPayloadSchema.safeParse({
      ...addon,
      summary: {
        ...summary,
        accounts: {
          ...summary.accounts,
          simulation: 0,
          nonSimulationOrUnknown: 1,
        },
      },
    }).success).toBe(false);
  });

  it("allows unstable evidence only as blocked and without a safety summary", () => {
    const result = addonMutationReadinessPayloadSchema.parse({
      ...addon,
      status: "blocked",
      blockerCodes: ["RUNTIME_CHANGED_DURING_PREFLIGHT"],
      summary: null,
    });
    expect(result.status).toBe("blocked");
    expect(result.summary).toBeNull();
  });

  it("enforces a short just-in-time expiry independently of Runtime-v2", () => {
    const preflight = mutationReadinessPreflightSchema.parse({
      protocolVersion: "mutation-readiness-preflight/1.0",
      preflightId: "10000000-0000-4000-8000-000000000001",
      receivedAt: "2026-07-26T12:00:00.150Z",
      expiresAt: "2026-07-26T12:00:05.100Z",
      source: {
        command: "GET_MUTATION_READINESS_PREFLIGHT",
        transport: "authenticated_local_ipc",
        ipcAuthenticated: true,
      },
      addon,
    });

    expect(isFreshMutationReadinessEvidence(
      preflight,
      new Date("2026-07-26T12:00:04.999Z"),
    )).toBe(true);
    expect(isFreshMutationReadinessEvidence(
      preflight,
      new Date("2026-07-26T12:00:05.101Z"),
    )).toBe(false);
    expect(permitsMutationActuation(
      preflight,
      new Date("2026-07-26T12:00:04.999Z"),
    )).toBe(false);
  });
});
