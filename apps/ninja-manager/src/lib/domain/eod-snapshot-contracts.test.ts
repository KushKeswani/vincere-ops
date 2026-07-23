import { describe, expect, it } from "vitest";

import {
  EOD_DEFAULT_TIME_ZONE,
  eodCaptureInputSchema,
  eodCaptureRequestHash,
  eodMoneyValueSchema,
  eodPnlSnapshotSchema,
  localDateInTimeZone,
} from "./eod-snapshot-contracts";

describe("EOD snapshot contracts", () => {
  it("accepts only bounded strict manual capture intents", () => {
    const input = {
      agentId: "40000000-0000-4000-8000-000000000001",
      sourceEventId: "50000000-0000-4000-8000-000000000001",
      idempotencyKey: "eod:manual:request:0001",
    };
    expect(eodCaptureInputSchema.parse(input)).toEqual(input);
    expect(() => eodCaptureInputSchema.parse({ ...input, unexpected: true })).toThrow();
    expect(() => eodCaptureInputSchema.parse({ ...input, idempotencyKey: "short" })).toThrow();
    expect(() => eodCaptureInputSchema.parse({ ...input, timeZone: "../secret" })).toThrow();
    expect(() => eodCaptureInputSchema.parse({ ...input, timeZone: "UTC" })).toThrow();
    expect(() => eodCaptureInputSchema.parse({ ...input, intendedLocalDate: "2099-01-01" })).toThrow();
  });

  it("hashes the exact resolved request and changes on every semantic field", () => {
    const input = {
      agentId: "40000000-0000-4000-8000-000000000001",
      sourceEventId: "50000000-0000-4000-8000-000000000001",
      intendedLocalDate: "2026-07-21",
      timeZone: EOD_DEFAULT_TIME_ZONE,
    };
    const hash = eodCaptureRequestHash(input);
    expect(hash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(eodCaptureRequestHash({ ...input })).toBe(hash);
    expect(eodCaptureRequestHash({ ...input, intendedLocalDate: "2026-07-22" })).not.toBe(hash);
    expect(eodCaptureRequestHash({ ...input, timeZone: "UTC" })).not.toBe(hash);
  });

  it("uses a DST-aware America/New_York calendar date", () => {
    expect(localDateInTimeZone(new Date("2026-01-01T04:30:00.000Z"))).toBe("2025-12-31");
    expect(localDateInTimeZone(new Date("2026-07-21T04:30:00.000Z"))).toBe("2026-07-21");
    expect(localDateInTimeZone(new Date("2026-03-08T04:30:00.000Z"))).toBe("2026-03-07");
    expect(localDateInTimeZone(new Date("2026-11-01T05:30:00.000Z"))).toBe("2026-11-01");
  });

  it("keeps available zero distinct from unavailable money", () => {
    const zero = eodMoneyValueSchema.parse({
      availability: "available",
      currency: "USD",
      amountMinor: 0,
      source: "ninjatrader_account_item",
      reason: null,
    });
    const unavailable = eodMoneyValueSchema.parse({
      availability: "unavailable",
      currency: "USD",
      amountMinor: null,
      source: null,
      reason: "SOURCE_UNSUPPORTED",
    });
    expect(zero.amountMinor).toBe(0);
    expect(unavailable.amountMinor).toBeNull();
    expect(() => eodMoneyValueSchema.parse({ ...unavailable, amountMinor: 0 })).toThrow();
  });

  it("preserves manager observation windows and enforces per-metric P&L semantics", () => {
    const unavailable = {
      availability: "unavailable" as const,
      currency: "USD" as const,
      amountMinor: null,
      source: null,
      reason: "SOURCE_UNSUPPORTED" as const,
    };
    const pnl = {
      sessionDate: "2026-07-21",
      daily: {
        realized: { availability: "available" as const, currency: "USD" as const, amountMinor: 100, source: "ninjatrader_performance" as const, reason: null },
        unrealized: { availability: "available" as const, currency: "USD" as const, amountMinor: -25, source: "ninjatrader_account_item" as const, reason: null },
        total: { availability: "available" as const, currency: "USD" as const, amountMinor: 75, source: "calculated_by_companion" as const, reason: null },
      },
      nativeLifetime: { availability: "available" as const, currency: "USD" as const, amountMinor: 500, source: "ninjatrader_performance" as const, reason: null },
      managerObservedCumulative: {
        value: { availability: "available" as const, currency: "USD" as const, amountMinor: 250, source: "manager_ledger" as const, reason: null },
        observedSince: "2026-07-14T21:00:00.000Z",
      },
    };
    expect(eodPnlSnapshotSchema.parse(pnl).managerObservedCumulative.observedSince).toBe("2026-07-14T21:00:00.000Z");
    expect(() => eodPnlSnapshotSchema.parse({
      ...pnl,
      daily: { ...pnl.daily, total: { ...pnl.daily.total, amountMinor: 76 } },
    })).toThrow();
    expect(() => eodPnlSnapshotSchema.parse({
      ...pnl,
      nativeLifetime: { ...pnl.nativeLifetime, source: "manager_ledger" },
    })).toThrow();
    expect(() => eodPnlSnapshotSchema.parse({
      ...pnl,
      managerObservedCumulative: { ...pnl.managerObservedCumulative, observedSince: null },
    })).toThrow();
    expect(() => eodPnlSnapshotSchema.parse({
      ...pnl,
      daily: { realized: unavailable, unrealized: unavailable, total: pnl.daily.total },
    })).toThrow();
  });
});
