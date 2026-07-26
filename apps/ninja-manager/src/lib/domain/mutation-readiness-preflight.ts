import { z } from "zod";

export const ADDON_MUTATION_READINESS_PROTOCOL =
  "ninjatrader-addon-mutation-readiness/1.0" as const;
export const MUTATION_READINESS_PREFLIGHT_PROTOCOL =
  "mutation-readiness-preflight/1.0" as const;
export const MAX_MUTATION_READINESS_AGE_MS = 5_000;

const isoTimestamp = z.iso.datetime({ offset: true });
const boundedCount = z.number().int().min(0).max(10_000);
const stateDigest = z.string().regex(/^hmac-sha256:[a-f0-9]{64}$/);

export const mutationReadinessBlockerCodeSchema = z.enum([
  "ACCOUNT_CONNECTION_UNREADY",
  "NO_ACCOUNTS",
  "NON_SIMULATION_ACCOUNT_PRESENT",
  "ORDER_STATE_UNKNOWN",
  "POSITION_STATE_UNKNOWN",
  "RUNTIME_CHANGED_DURING_PREFLIGHT",
  "SOURCE_UNAVAILABLE",
  "STRATEGY_STATE_UNKNOWN",
]);

export const mutationReadinessSafetySummarySchema = z.object({
  stateDigest,
  accounts: z.object({
    total: boundedCount,
    simulation: boundedCount,
    nonSimulationOrUnknown: boundedCount,
    connected: boundedCount,
    disconnectedOrUnknown: boundedCount,
  }).strict(),
  strategies: z.object({
    total: boundedCount,
    enabled: boundedCount,
    unknown: boundedCount,
  }).strict(),
  positions: z.object({
    open: boundedCount,
    unknown: boundedCount,
  }).strict(),
  orders: z.object({
    working: boundedCount,
    transitional: boundedCount,
    unknown: boundedCount,
  }).strict(),
}).strict().superRefine((value, context) => {
  const accountClassified = value.accounts.simulation + value.accounts.nonSimulationOrUnknown;
  const accountConnected = value.accounts.connected + value.accounts.disconnectedOrUnknown;
  if (accountClassified !== value.accounts.total) {
    context.addIssue({ code: "custom", message: "Account classifications must cover every account" });
  }
  if (accountConnected !== value.accounts.total) {
    context.addIssue({ code: "custom", message: "Account connection states must cover every account" });
  }
  if (value.strategies.enabled > value.strategies.total
    || value.strategies.unknown > value.strategies.total) {
    context.addIssue({ code: "custom", message: "Strategy counts cannot exceed the total" });
  }
  if (value.orders.transitional > value.orders.working
    || value.orders.unknown > value.orders.working) {
    context.addIssue({ code: "custom", message: "Order sub-counts cannot exceed working orders" });
  }
  if (value.positions.unknown > value.positions.open) {
    context.addIssue({ code: "custom", message: "Unknown positions cannot exceed open positions" });
  }
});

export type MutationReadinessSafetySummary = z.infer<
  typeof mutationReadinessSafetySummarySchema
>;

export const addonMutationReadinessPayloadSchema = z.object({
  protocolVersion: z.literal(ADDON_MUTATION_READINESS_PROTOCOL),
  startedAt: isoTimestamp,
  completedAt: isoTimestamp,
  sampleCount: z.literal(2),
  consistencyMethod: z.literal("bounded_consecutive_stability"),
  atomicity: z.literal("not_guaranteed"),
  status: z.enum(["ready", "blocked"]),
  blockerCodes: z.array(mutationReadinessBlockerCodeSchema).max(8),
  summary: mutationReadinessSafetySummarySchema.nullable(),
}).strict().superRefine((value, context) => {
  const startedAt = Date.parse(value.startedAt);
  const completedAt = Date.parse(value.completedAt);
  if (completedAt < startedAt || completedAt - startedAt > MAX_MUTATION_READINESS_AGE_MS) {
    context.addIssue({
      code: "custom",
      message: "The bounded preflight must complete within five seconds",
      path: ["completedAt"],
    });
  }
  if (!value.blockerCodes.every((code, index) => index === 0 || value.blockerCodes[index - 1] < code)) {
    context.addIssue({
      code: "custom",
      message: "Blocker codes must be unique and sorted",
      path: ["blockerCodes"],
    });
  }
  if (value.status === "ready") {
    if (value.summary === null || value.blockerCodes.length > 0) {
      context.addIssue({ code: "custom", message: "Ready preflight requires one stable blocker-free summary" });
      return;
    }
    if (value.summary.accounts.total === 0
      || value.summary.accounts.nonSimulationOrUnknown > 0
      || value.summary.accounts.disconnectedOrUnknown > 0
      || value.summary.strategies.unknown > 0
      || value.summary.positions.unknown > 0
      || value.summary.orders.unknown > 0) {
      context.addIssue({ code: "custom", message: "Ready preflight violates the simulation baseline" });
    }
  } else if (value.blockerCodes.length === 0) {
    context.addIssue({ code: "custom", message: "Blocked preflight requires at least one blocker" });
  }
  if (value.summary === null
    && !value.blockerCodes.some((code) => [
      "RUNTIME_CHANGED_DURING_PREFLIGHT",
      "SOURCE_UNAVAILABLE",
    ].includes(code))) {
    context.addIssue({ code: "custom", message: "Missing summary requires an unavailable or unstable blocker" });
  }
});

export type AddonMutationReadinessPayload = z.infer<
  typeof addonMutationReadinessPayloadSchema
>;

export const mutationReadinessPreflightSchema = z.object({
  protocolVersion: z.literal(MUTATION_READINESS_PREFLIGHT_PROTOCOL),
  preflightId: z.uuid(),
  receivedAt: isoTimestamp,
  expiresAt: isoTimestamp,
  source: z.object({
    command: z.literal("GET_MUTATION_READINESS_PREFLIGHT"),
    transport: z.literal("authenticated_local_ipc"),
    ipcAuthenticated: z.literal(true),
  }).strict(),
  addon: addonMutationReadinessPayloadSchema,
}).strict().superRefine((value, context) => {
  const completedAt = Date.parse(value.addon.completedAt);
  const receivedAt = Date.parse(value.receivedAt);
  const expiresAt = Date.parse(value.expiresAt);
  if (receivedAt < completedAt - 1_000) {
    context.addIssue({ code: "custom", message: "Preflight completion is too far in the future", path: ["receivedAt"] });
  }
  if (expiresAt <= completedAt || expiresAt - completedAt > MAX_MUTATION_READINESS_AGE_MS) {
    context.addIssue({ code: "custom", message: "Preflight expiry exceeds the five-second JIT window", path: ["expiresAt"] });
  }
});

export type MutationReadinessPreflight = z.infer<
  typeof mutationReadinessPreflightSchema
>;

export function isFreshMutationReadinessEvidence(
  input: MutationReadinessPreflight,
  now = new Date(),
): boolean {
  const parsed = mutationReadinessPreflightSchema.safeParse(input);
  return parsed.success
    && parsed.data.addon.status === "ready"
    && parsed.data.addon.summary !== null
    && now.getTime() >= Date.parse(parsed.data.addon.completedAt) - 1_000
    && now.getTime() <= Date.parse(parsed.data.expiresAt);
}

/**
 * The current Add-On has no documented transaction spanning all four NinjaTrader
 * collections. Consecutive stability is useful evidence, but never sufficient
 * authority for actuation; consumers remain fail-closed until a future protocol
 * can truthfully guarantee atomicity.
 */
export function permitsMutationActuation(
  _input: MutationReadinessPreflight,
  _now = new Date(),
): false {
  void _input;
  void _now;
  return false;
}
