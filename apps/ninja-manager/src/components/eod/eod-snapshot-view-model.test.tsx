import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { EodSnapshot, EodSnapshotSummary } from "@/lib/domain/eod-snapshot-contracts";

import { EodSnapshotDashboard } from "./eod-snapshot-dashboard";
import { buildEodSnapshotDisplayModel, formatEodMoney } from "./eod-snapshot-view-model";

function snapshot(overrides: Partial<EodSnapshot> = {}): EodSnapshot {
  const scopes = Object.fromEntries([
    "process", "addon", "connections", "accounts", "strategies", "positions", "orders", "executions", "pnl",
  ].map((scope) => [scope, { status: "complete", itemCount: scope === "accounts" || scope === "pnl" ? 1 : scope === "strategies" ? 1 : 0, errors: [] }]));
  return {
    version: "eod-snapshot/1.0",
    snapshotId: "10000000-0000-4000-8000-000000000001",
    agentId: "20000000-0000-4000-8000-000000000001",
    source: {
      eventId: "30000000-0000-4000-8000-000000000001",
      sequence: 7,
      stateDigest: `sha256:${"a".repeat(64)}`,
      asOf: "2026-07-21T20:59:58.000Z",
      occurredAt: "2026-07-21T20:59:58.200Z",
      receivedAt: "2026-07-21T20:59:58.500Z",
    },
    capturedAt: "2026-07-21T21:00:00.000Z",
    intendedLocalDate: "2026-07-21",
    timeZone: "America/New_York",
    contentHash: `sha256:${"b".repeat(64)}`,
    completeness: { overall: "complete", scopes },
    accounts: [{
      ordinal: 1,
      maskedIdentifier: "******M101",
      displayLabel: "Simulation account 1",
      classification: {
        environment: "simulation",
        authority: "authoritative",
        source: "ninjatrader_simulation_account",
        reason: null,
      },
      pnl: {
        sessionDate: "2026-07-21",
        daily: {
          realized: { availability: "available", currency: "USD", amountMinor: 0, source: "ninjatrader_performance", reason: null },
          unrealized: { availability: "available", currency: "USD", amountMinor: -1250, source: "ninjatrader_account_item", reason: null },
          total: { availability: "available", currency: "USD", amountMinor: -1250, source: "calculated_by_companion", reason: null },
        },
        nativeLifetime: { availability: "unavailable", currency: "USD", amountMinor: null, source: null, reason: "SOURCE_UNSUPPORTED" },
        managerObservedCumulative: {
          value: { availability: "available", currency: "USD", amountMinor: 123456, source: "manager_ledger", reason: null },
          observedSince: "2026-07-14T21:00:00.000Z",
        },
      },
      strategies: [{
        ordinal: 1,
        displayLabel: "Strategy 1",
        strategyType: "RBO",
        instrument: "NQ 09-26",
        enabled: true,
        runtimeState: "running",
        synchronizationState: "synchronized",
      }],
    }],
    ...overrides,
  } as EodSnapshot;
}

function summary(value: EodSnapshot): EodSnapshotSummary {
  return {
    ...value,
    accountCount: value.accounts.length,
    strategyCount: value.accounts.reduce((count, account) => count + account.strategies.length, 0),
  } as unknown as EodSnapshotSummary;
}

describe("EOD snapshot display model", () => {
  it("keeps an available zero distinct from an unavailable value", () => {
    const zero = formatEodMoney({
      availability: "available",
      currency: "USD",
      amountMinor: 0,
      source: "ninjatrader_account_item",
      reason: null,
    });
    const unavailable = formatEodMoney({
      availability: "unavailable",
      currency: "USD",
      amountMinor: null,
      source: null,
      reason: "SOURCE_UNSUPPORTED",
    });

    expect(zero).toEqual({ available: true, value: "$0.00", detail: "Available zero · NinjaTrader account item" });
    expect(unavailable).toEqual({ available: false, value: "Unavailable", detail: "Source unsupported" });
  });

  it("attributes every available P&L source without overstating manager or calculated evidence", () => {
    const cases = [
      ["ninjatrader_account_item", "NinjaTrader account item"],
      ["ninjatrader_performance", "NinjaTrader performance"],
      ["calculated_by_companion", "Companion calculation"],
      ["manager_ledger", "Manager ledger"],
    ] as const;
    for (const [source, label] of cases) {
      expect(formatEodMoney({
        availability: "available",
        currency: "USD",
        amountMinor: 125,
        source,
        reason: null,
      }).detail).toBe(label);
    }
  });

  it("preserves daily, native lifetime, manager-observed, window, and exact stack semantics", () => {
    const model = buildEodSnapshotDisplayModel(snapshot());

    expect(model).toMatchObject({
      intendedDate: "2026-07-21",
      overall: "complete",
      strategyCount: 1,
      accounts: [{
        label: "Simulation account 1",
        maskedIdentifier: "******M101",
        dailyRealized: { value: "$0.00", available: true },
        dailyUnrealized: { value: "-$12.50", available: true },
        nativeLifetime: { value: "Unavailable", detail: "Source unsupported" },
        managerObserved: { value: "$1,234.56", available: true },
        strategies: [{ label: "Strategy 1", strategyType: "RBO", instrument: "NQ 09-26", enabled: "Enabled" }],
      }],
    });
    expect(model.accounts[0].managerObservedSince).not.toBe("Unavailable");
  });
});

describe("EOD snapshot dashboard", () => {
  it("renders partial empty evidence explicitly without inventing accounts or zero P&L", () => {
    const value = snapshot({
      completeness: {
        overall: "partial",
        scopes: {
          ...snapshot().completeness.scopes,
          accounts: { status: "partial", itemCount: 0, errors: [{ code: "SOURCE_ERROR", retryable: true }] },
          pnl: { status: "unavailable", itemCount: 0, errors: [{ code: "CAPABILITY_UNSUPPORTED", retryable: false }] },
        },
      },
      accounts: [],
    });
    const markup = renderToStaticMarkup(<EodSnapshotDashboard latest={value} history={[summary(value)]} />);

    expect(markup).toContain("Snapshot evidence is");
    expect(markup).toContain("partial");
    expect(markup).toContain("incomplete account evidence does not prove that no accounts exist");
    expect(markup).not.toContain("$0.00");
  });

  it("renders safe masked evidence and excludes source IDs, hashes, opaque refs, and process IDs", () => {
    const value = snapshot();
    const markup = renderToStaticMarkup(<EodSnapshotDashboard latest={value} history={[summary(value)]} />);

    expect(markup).toContain("2026-07-21");
    expect(markup).toContain("******M101");
    expect(markup).toContain("$0.00");
    expect(markup).toContain("Unavailable");
    expect(markup).toContain("Source unsupported");
    expect(markup).toContain("Exact current strategy stack");
    expect(markup).toContain("Strategy 1");
    expect(markup).not.toContain(value.snapshotId);
    expect(markup).not.toContain(value.agentId);
    expect(markup).not.toContain(value.source.eventId);
    expect(markup).not.toContain("sha256:");
    expect(markup).not.toContain("acct_");
    expect(markup).not.toContain("processId");
  });

  it("renders a clear empty state before the first capture", () => {
    const markup = renderToStaticMarkup(<EodSnapshotDashboard latest={null} history={[]} />);
    expect(markup).toContain("No EOD snapshot has been captured");
  });
});
