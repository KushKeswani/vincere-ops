import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { RuntimeObservationV2, RuntimeObservationV2State } from "@/lib/domain/runtime-observation-v2";

import { FeedAlgoHealthDashboard } from "./feed-algo-health-dashboard";
import { buildFeedAlgoHealthDisplayModel, selectLatestFeedAlgoHealthSource } from "./feed-algo-health-view-model";

function observation(): RuntimeObservationV2 {
  const complete = (itemCount: number) => ({ status: "complete" as const, itemCount, errors: [] });
  const state: RuntimeObservationV2State = {
    process: null,
    addon: { addonRef: "addon_abcdefghijklmnop", status: "connected", health: "healthy", version: "2.0.0", ipcAuthenticated: true, capabilities: [] },
    connections: [{ connectionRef: "conn_abcdefghijklmnop", displayLabel: "Connection 1", kind: "simulation", providerCode: "TRADOVATE", status: "connected", health: "healthy", marketDataStatus: "unavailable", lastStateChangeAt: null }],
    accounts: [{ accountRef: "acct_abcdefghijklmnop", maskedIdentifier: "******M101", identifierFingerprint: `hmac-sha256:${"a".repeat(64)}`, displayLabel: "Simulation account 1", classification: { environment: "simulation", authority: "authoritative", source: "ninjatrader_simulation_account" }, connectionRefs: ["conn_abcdefghijklmnop"], status: "connected" }],
    strategies: [{ strategyRef: "strat_abcdefghijklmnop", accountRef: "acct_abcdefghijklmnop", displayLabel: "Strategy 1", strategyTypeCode: "VINCERE_STEADY", instrumentCode: "MNQ 09-26", enabled: true, runtimeState: "waiting_sync", synchronizationState: "pending", operationalParameters: [], lastStateChangeAt: null }],
    positions: [], orders: [], executions: [], pnl: [],
    collection: { overall: "complete", scopes: { process: complete(0), addon: complete(1), connections: complete(1), accounts: complete(1), strategies: complete(1), positions: complete(0), orders: complete(0), executions: complete(0), pnl: complete(0) } },
  };
  return {
    protocolVersion: "runtime-observation/2.0", observationId: "00000000-0000-4000-8000-000000000001",
    source: { collector: "vps_companion_agent", authority: "ninjatrader_runtime", installationRef: "install_abcdefghijklmnop", collectionSessionRef: "session_abcdefghijklmnop" },
    asOf: "2026-07-21T12:00:00.000Z", freshness: { status: "fresh", ageMs: 0, maxAgeMs: 45_000 }, stateDigest: `sha256:${"b".repeat(64)}`, state,
  };
}

describe("Feed & Algo Health display", () => {
  it("selects health evidence independently of an EOD store failure", async () => {
    const earlier = { observation: observation(), occurredAt: "2026-07-21T12:00:00.500Z", receivedAt: "2026-07-21T12:00:01.000Z" };
    const latest = { observation: observation(), occurredAt: "2026-07-21T12:00:09.500Z", receivedAt: "2026-07-21T12:00:10.000Z" };
    const eodRead = Promise.reject(new Error("old EOD schema"));
    const selected = selectLatestFeedAlgoHealthSource([
      { installationLabel: "Earlier", current: earlier },
      { installationLabel: "Edith", current: latest },
    ]);

    await expect(eodRead).rejects.toThrow("old EOD schema");
    expect(selected).toEqual({ installationLabel: "Edith", current: latest });
  });

  it("formats a deterministic summary without exposing opaque identity", () => {
    const model = buildFeedAlgoHealthDisplayModel({ current: { observation: observation(), occurredAt: "2026-07-21T12:00:00.500Z", receivedAt: "2026-07-21T12:00:01.000Z" }, now: "2026-07-21T12:00:30.000Z" });
    const serialized = JSON.stringify(model);
    expect(model.statusLabel).toBe("Blocked");
    expect(serialized).toContain("******M101");
    for (const privateValue of ["acct_abcdefghijklmnop", "conn_abcdefghijklmnop", "strat_abcdefghijklmnop", "hmac-sha256", "00000000-0000-4000-8000-000000000001"]) {
      expect(serialized).not.toContain(privateValue);
    }
  });

  it("renders evidence and guided checks with no control button or forbidden action recommendation", () => {
    const markup = renderToStaticMarkup(<FeedAlgoHealthDashboard current={{ observation: observation(), occurredAt: "2026-07-21T12:00:00.500Z", receivedAt: "2026-07-21T12:00:01.000Z" }} now="2026-07-21T12:00:30.000Z" installationLabel="Edith" />);
    expect(markup).toContain("Feed &amp; Algo Health");
    expect(markup).toContain("price-feed evidence is not ready");
    expect(markup).toContain("STRATEGY_WAITING_FOR_SYNC");
    expect(markup).toContain("Control Center Log tab");
    expect(markup).not.toContain("<button");
    for (const forbidden of ["Reconnect", "Re-enable", "Cancel order", "Flatten", "Force quit", "Repair database"]) {
      expect(markup).not.toContain(forbidden);
    }
  });
});
