import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  runtimeObservationV2StateDigest,
  type RuntimeObservationV2,
  type RuntimeObservationV2State,
} from "@/lib/domain/runtime-observation-v2";

import {
  LEGACY_RUNTIME_V1_FALLBACK_LABEL,
  LegacyRuntimeV1FallbackNotice,
} from "./legacy-runtime-v1-fallback-notice";
import { RuntimeObservationV2Dashboard } from "./runtime-observation-dashboard";
import { buildRuntimeObservationV2DisplayModel } from "./runtime-observation-view-model";

function observation(asOf = "2026-07-21T12:00:00.000Z"): RuntimeObservationV2 {
  const complete = (itemCount: number) => ({ status: "complete" as const, itemCount, errors: [] });
  const state: RuntimeObservationV2State = {
    process: {
      processRef: "process_abcdefghijklmnop",
      status: "running",
      health: "healthy",
      processId: 98765,
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
      providerCode: "SIMULATED",
      status: "connected",
      health: "healthy",
      marketDataStatus: "unknown",
      lastStateChangeAt: null,
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
    strategies: [],
    positions: [],
    orders: [],
    executions: [],
    pnl: [{
      accountRef: "acct_abcdefghijklmnop",
      sessionDate: "2026-07-21",
      daily: {
        realized: { availability: "available", currency: "USD", amountMinor: 0, source: "ninjatrader_account_item" },
        unrealized: { availability: "available", currency: "USD", amountMinor: 0, source: "ninjatrader_account_item" },
        total: { availability: "available", currency: "USD", amountMinor: 0, source: "calculated_by_companion" },
      },
      nativeLifetime: { availability: "unavailable", currency: "USD", amountMinor: null, source: null, reasonCode: "SOURCE_UNSUPPORTED" },
      managerObservedCumulative: {
        value: { availability: "unavailable", currency: "USD", amountMinor: null, source: null, reasonCode: "NOT_OBSERVED_YET" },
        observedSince: null,
      },
    }],
    collection: {
      overall: "partial",
      scopes: {
        process: complete(1),
        addon: complete(1),
        connections: complete(1),
        accounts: complete(1),
        strategies: complete(0),
        positions: complete(0),
        orders: complete(0),
        executions: complete(0),
        pnl: {
          status: "partial",
          itemCount: 1,
          errors: [{ code: "CAPABILITY_UNSUPPORTED", retryable: false }],
        },
      },
    },
  };
  return {
    protocolVersion: "runtime-observation/2.0",
    observationId: "00000000-0000-4000-8000-000000000001",
    source: {
      collector: "vps_companion_agent",
      authority: "ninjatrader_runtime",
      installationRef: "install_abcdefghijklmnop",
      collectionSessionRef: "session_abcdefghijklmnop",
    },
    asOf,
    freshness: { status: "fresh", ageMs: 0, maxAgeMs: 60_000 },
    stateDigest: runtimeObservationV2StateDigest(state),
    state,
  };
}

describe("Runtime Observation v2 display model", () => {
  it("keeps partial collection and unavailable money distinct from an available zero", () => {
    const model = buildRuntimeObservationV2DisplayModel({
      observation: observation(),
      receivedAt: new Date("2026-07-21T12:00:01.000Z"),
    }, new Date("2026-07-21T12:00:10.000Z"));

    expect(model.overall).toBe("partial");
    expect(model.scopes.find((scope) => scope.key === "pnl")).toMatchObject({ status: "partial", itemCount: 1 });
    expect(model.collectionIssues).toHaveLength(1);
    expect(model.collectionIssues[0]).toContain("capability unsupported");
    expect(model.collectionIssues[0]).toContain("manual review required");
    expect(model.pnl.rows[0].realized).toMatchObject({ available: true, primary: "$0.00" });
    expect(model.pnl.rows[0].nativeLifetime).toEqual({ available: false, primary: "Unavailable", detail: "source unsupported" });
  });

  it("marks previously fresh evidence stale relative to render time", () => {
    const model = buildRuntimeObservationV2DisplayModel({
      observation: observation("2026-07-21T12:00:00.000Z"),
      receivedAt: "2026-07-21T12:00:01.000Z",
    }, new Date("2026-07-21T12:05:00.000Z"));

    expect(model.freshness).toBe("stale");
    expect(model.freshnessDetail).toContain("5 min old");
  });

  it("excludes opaque references, fingerprints, raw process ids, and envelope identifiers", () => {
    const model = buildRuntimeObservationV2DisplayModel({ observation: observation(), receivedAt: "2026-07-21T12:00:01.000Z" });
    const rendered = JSON.stringify(model);

    expect(rendered).toContain("******M101");
    expect(rendered).not.toContain("acct_abcdefghijklmnop");
    expect(rendered).not.toContain("conn_abcdefghijklmnop");
    expect(rendered).not.toContain("process_abcdefghijklmnop");
    expect(rendered).not.toContain("hmac-sha256");
    expect(rendered).not.toContain("98765");
    expect(rendered).not.toContain("00000000-0000-4000-8000-000000000001");
  });

  it("renders the v1 source as an explicit legacy fallback", () => {
    const markup = renderToStaticMarkup(<LegacyRuntimeV1FallbackNotice />);
    expect(markup).toContain(LEGACY_RUNTIME_V1_FALLBACK_LABEL);
    expect(markup).toContain("No Runtime Observation v2 event exists");
  });

  it("renders the source-backed v2 summary and explicit P&L limitation", () => {
    const markup = renderToStaticMarkup(
      <RuntimeObservationV2Dashboard latest={{ observation: observation(), receivedAt: "2026-07-21T12:00:01.000Z" }} />,
    );
    expect(markup).toContain("NinjaTrader Runtime Observation v2");
    expect(markup).toContain("Overall collection");
    expect(markup).toContain("partial");
    expect(markup).toContain("$0.00");
    expect(markup).toContain("Unavailable");
    expect(markup).toContain("source unsupported");
  });
});
