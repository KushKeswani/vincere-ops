import { z } from "zod";

import { hashCanonicalPayload } from "./canonical-json";

export const EOD_SNAPSHOT_VERSION = "eod-snapshot/1.0" as const;
export const EOD_DEFAULT_TIME_ZONE = "America/New_York" as const;
export const EOD_MAX_CAPTURE_LIST_LIMIT = 100;
export const EOD_MAX_SOURCE_AGE_MS = 45_000;
export const EOD_DECLARED_AGE_TOLERANCE_MS = 2_000;

const isoTimestamp = z.iso.datetime({ offset: true });
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const uuid = z.uuid();
const sha256 = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const timeZone = z.literal(EOD_DEFAULT_TIME_ZONE);
const idempotencyKey = z.string().regex(/^[A-Za-z0-9:._-]{16,200}$/);

export const eodCaptureInputSchema = z.object({
  agentId: uuid,
  sourceEventId: uuid,
  idempotencyKey,
}).strict();

export const eodSnapshotListInputSchema = z.object({
  agentId: uuid.optional(),
  limit: z.number().int().min(1).max(EOD_MAX_CAPTURE_LIST_LIMIT).optional(),
}).strict();

export const eodCollectionErrorSchema = z.object({
  code: z.enum([
    "ADDON_OFFLINE",
    "CAPABILITY_UNSUPPORTED",
    "COLLECTION_TIMEOUT",
    "CONNECTION_UNAVAILABLE",
    "INCONSISTENT_RUNTIME_STATE",
    "SOURCE_ERROR",
  ]),
  retryable: z.boolean(),
}).strict();

export const eodCollectionScopeSchema = z.object({
  status: z.enum(["complete", "partial", "unavailable"]),
  itemCount: z.number().int().min(0).max(1_000_000),
  errors: z.array(eodCollectionErrorSchema).max(20),
}).strict();

export const eodCollectionScopesSchema = z.object({
  process: eodCollectionScopeSchema,
  addon: eodCollectionScopeSchema,
  connections: eodCollectionScopeSchema,
  accounts: eodCollectionScopeSchema,
  strategies: eodCollectionScopeSchema,
  positions: eodCollectionScopeSchema,
  orders: eodCollectionScopeSchema,
  executions: eodCollectionScopeSchema,
  pnl: eodCollectionScopeSchema,
}).strict();

export const eodMoneyValueSchema = z.discriminatedUnion("availability", [
  z.object({
    availability: z.literal("available"),
    currency: z.literal("USD"),
    amountMinor: z.number().int().safe().min(-100_000_000_000).max(100_000_000_000),
    source: z.enum([
      "ninjatrader_account_item",
      "ninjatrader_performance",
      "calculated_by_companion",
      "manager_ledger",
    ]),
    reason: z.null(),
  }).strict(),
  z.object({
    availability: z.literal("unavailable"),
    currency: z.literal("USD"),
    amountMinor: z.null(),
    source: z.null(),
    reason: z.enum([
      "ADDON_OFFLINE",
      "ACCOUNT_DISCONNECTED",
      "SOURCE_UNSUPPORTED",
      "SOURCE_ERROR",
      "NOT_OBSERVED_YET",
    ]),
  }).strict(),
]);

export const eodPnlSnapshotSchema = z.object({
  sessionDate: isoDate,
  daily: z.object({
    realized: eodMoneyValueSchema,
    unrealized: eodMoneyValueSchema,
    total: eodMoneyValueSchema,
  }).strict(),
  nativeLifetime: eodMoneyValueSchema,
  managerObservedCumulative: z.object({
    value: eodMoneyValueSchema,
    observedSince: isoTimestamp.nullable(),
  }).strict(),
}).strict().superRefine((value, context) => {
  const { realized, unrealized, total } = value.daily;
  if (realized.availability === "available" && !["ninjatrader_account_item", "ninjatrader_performance"].includes(realized.source)) {
    context.addIssue({ code: "custom", message: "Daily realized P&L requires a NinjaTrader source", path: ["daily", "realized", "source"] });
  }
  if (unrealized.availability === "available" && unrealized.source !== "ninjatrader_account_item") {
    context.addIssue({ code: "custom", message: "Daily unrealized P&L requires the NinjaTrader account item source", path: ["daily", "unrealized", "source"] });
  }
  if (realized.availability === "available" && unrealized.availability === "available") {
    if (total.availability !== "available") {
      context.addIssue({ code: "custom", message: "Daily total must be available when both components are available", path: ["daily", "total"] });
    } else if (total.amountMinor !== realized.amountMinor + unrealized.amountMinor) {
      context.addIssue({ code: "custom", message: "Daily total must equal realized plus unrealized P&L", path: ["daily", "total", "amountMinor"] });
    }
  } else if (total.availability !== "unavailable") {
    context.addIssue({ code: "custom", message: "Daily total must be unavailable when a component is unavailable", path: ["daily", "total"] });
  }
  if (total.availability === "available" && total.source !== "calculated_by_companion") {
    context.addIssue({ code: "custom", message: "Daily total must be calculated by the companion", path: ["daily", "total", "source"] });
  }
  if (value.nativeLifetime.availability === "available" && value.nativeLifetime.source !== "ninjatrader_performance") {
    context.addIssue({ code: "custom", message: "Native lifetime P&L requires the NinjaTrader performance source", path: ["nativeLifetime", "source"] });
  }
  const manager = value.managerObservedCumulative;
  if (manager.value.availability === "available") {
    if (manager.value.source !== "manager_ledger" || manager.observedSince === null) {
      context.addIssue({ code: "custom", message: "Manager cumulative P&L requires its ledger source and observation start", path: ["managerObservedCumulative"] });
    }
  } else if (manager.observedSince !== null) {
    context.addIssue({ code: "custom", message: "Unavailable manager cumulative P&L cannot claim an observation start", path: ["managerObservedCumulative", "observedSince"] });
  }
});

export const eodAccountClassificationSchema = z.discriminatedUnion("environment", [
  z.object({
    environment: z.literal("simulation"),
    authority: z.literal("authoritative"),
    source: z.literal("ninjatrader_simulation_account"),
    reason: z.null(),
  }).strict(),
  z.object({
    environment: z.literal("live"),
    authority: z.literal("authoritative"),
    source: z.literal("ninjatrader_live_account"),
    reason: z.null(),
  }).strict(),
  z.object({
    environment: z.literal("unknown"),
    authority: z.literal("unavailable"),
    source: z.null(),
    reason: z.enum([
      "ADDON_OFFLINE",
      "CLASSIFICATION_UNSUPPORTED",
      "CLASSIFICATION_CONFLICT",
      "CLASSIFICATION_UNAVAILABLE",
    ]),
  }).strict(),
]);

export const eodStrategySnapshotSchema = z.object({
  ordinal: z.number().int().min(1).max(10_000),
  displayLabel: z.string().min(1).max(80),
  strategyType: z.string().regex(/^[A-Za-z][A-Za-z0-9_.-]{0,79}$/),
  instrument: z.string().regex(/^[A-Z0-9][A-Z0-9 .:/_-]{0,39}$/),
  enabled: z.boolean(),
  runtimeState: z.enum(["disabled", "enabling", "waiting_sync", "running", "disabling", "error", "unknown"]),
  synchronizationState: z.enum(["synchronized", "not_synchronized", "pending", "not_applicable", "unknown"]),
}).strict();

export const eodAccountSnapshotSchema = z.object({
  ordinal: z.number().int().min(1).max(500),
  maskedIdentifier: z.string().regex(/^\*{4,16}[A-Za-z0-9]{2,8}$/),
  displayLabel: z.string().min(1).max(80),
  classification: eodAccountClassificationSchema,
  pnl: eodPnlSnapshotSchema.nullable(),
  strategies: z.array(eodStrategySnapshotSchema).max(10_000),
}).strict();

const eodSnapshotContentShape = {
  version: z.literal(EOD_SNAPSHOT_VERSION),
  snapshotId: uuid,
  agentId: uuid,
  source: z.object({
    eventId: uuid,
    sequence: z.number().int().safe().positive(),
    stateDigest: sha256,
    asOf: isoTimestamp,
    occurredAt: isoTimestamp,
    receivedAt: isoTimestamp,
  }).strict(),
  capturedAt: isoTimestamp,
  intendedLocalDate: isoDate,
  timeZone,
  completeness: z.object({
    overall: z.enum(["complete", "partial", "unavailable"]),
    scopes: eodCollectionScopesSchema,
  }).strict(),
  accounts: z.array(eodAccountSnapshotSchema).max(500),
};

function validateSnapshotStructure(
  snapshot: {
    source: { asOf: string; occurredAt: string; receivedAt: string };
    capturedAt: string;
    intendedLocalDate: string;
    accounts: Array<{
      ordinal: number;
      pnl: z.infer<typeof eodPnlSnapshotSchema> | null;
      strategies: Array<{ ordinal: number }>;
    }>;
  },
  context: z.RefinementCtx,
): void {
  const chronology = [
    snapshot.source.asOf,
    snapshot.source.occurredAt,
    snapshot.source.receivedAt,
    snapshot.capturedAt,
  ].map(Date.parse);
  if (!chronology.every((value, index) => index === 0 || chronology[index - 1] <= value)) {
    context.addIssue({ code: "custom", message: "EOD source chronology is invalid", path: ["source"] });
  }
  if (!snapshot.accounts.every((account, index) => account.ordinal === index + 1)) {
    context.addIssue({ code: "custom", message: "Account ordinals must be contiguous", path: ["accounts"] });
  }
  let strategyCount = 0;
  snapshot.accounts.forEach((account, accountIndex) => {
    if (account.pnl) {
      const values = [
        account.pnl.daily.realized,
        account.pnl.daily.unrealized,
        account.pnl.daily.total,
        account.pnl.nativeLifetime,
        account.pnl.managerObservedCumulative.value,
      ];
      if (
        values.some((value) => value.availability === "available")
        && account.pnl.sessionDate !== snapshot.intendedLocalDate
      ) {
        context.addIssue({
          code: "custom",
          message: "Available P&L session date must match the intended EOD local date",
          path: ["accounts", accountIndex, "pnl", "sessionDate"],
        });
      }
    }
    strategyCount += account.strategies.length;
    if (!account.strategies.every((strategy, index) => strategy.ordinal === index + 1)) {
      context.addIssue({
        code: "custom",
        message: "Per-account strategy ordinals must be contiguous",
        path: ["accounts", accountIndex, "strategies"],
      });
    }
  });
  if (strategyCount > 10_000) {
    context.addIssue({ code: "custom", message: "Snapshot strategy count exceeds the source contract bound", path: ["accounts"] });
  }
}

export const eodSnapshotContentSchema = z.object(eodSnapshotContentShape).strict().superRefine(validateSnapshotStructure);

export const eodSnapshotSchema = z.object({
  ...eodSnapshotContentShape,
  contentHash: sha256,
}).strict().superRefine((snapshot, context) => {
  validateSnapshotStructure(snapshot, context);
  const { contentHash, ...content } = snapshot;
  if (contentHash !== hashCanonicalPayload(content)) {
    context.addIssue({ code: "custom", message: "EOD snapshot content hash does not match its contents", path: ["contentHash"] });
  }
});

export const eodSnapshotSummarySchema = z.object({
  version: z.literal(EOD_SNAPSHOT_VERSION),
  snapshotId: uuid,
  agentId: uuid,
  source: z.object({
    eventId: uuid,
    sequence: z.number().int().safe().positive(),
    stateDigest: sha256,
    asOf: isoTimestamp,
    occurredAt: isoTimestamp,
    receivedAt: isoTimestamp,
  }).strict(),
  capturedAt: isoTimestamp,
  intendedLocalDate: isoDate,
  timeZone,
  contentHash: sha256,
  completeness: z.object({
    overall: z.enum(["complete", "partial", "unavailable"]),
    scopes: eodCollectionScopesSchema,
  }).strict(),
  accountCount: z.number().int().min(0).max(500),
  strategyCount: z.number().int().min(0).max(10_000),
}).strict();

export type EodCaptureInput = z.infer<typeof eodCaptureInputSchema>;
export type EodSnapshotListInput = z.infer<typeof eodSnapshotListInputSchema>;
export type EodMoneyValue = z.infer<typeof eodMoneyValueSchema>;
export type EodSnapshotContent = z.infer<typeof eodSnapshotContentSchema>;
export type EodSnapshot = z.infer<typeof eodSnapshotSchema>;
export type EodSnapshotSummary = z.infer<typeof eodSnapshotSummarySchema>;

export function eodCaptureRequestHash(input: {
  agentId: string;
  sourceEventId: string;
  intendedLocalDate: string;
  timeZone: string;
}): string {
  return hashCanonicalPayload({
    agentId: input.agentId,
    intendedLocalDate: input.intendedLocalDate,
    sourceEventId: input.sourceEventId,
    timeZone: input.timeZone,
    version: EOD_SNAPSHOT_VERSION,
  });
}

export function eodSnapshotContentHash(input: unknown): string {
  return hashCanonicalPayload(eodSnapshotContentSchema.parse(input));
}

export function localDateInTimeZone(at: Date, zone: string = EOD_DEFAULT_TIME_ZONE): string {
  if (!Number.isFinite(at.getTime())) throw new Error("A valid capture timestamp is required");
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(at)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  return isoDate.parse(`${parts.year}-${parts.month}-${parts.day}`);
}
