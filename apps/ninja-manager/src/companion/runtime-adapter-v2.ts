import { createHmac } from "node:crypto";

import { z } from "zod";

import {
  RUNTIME_OBSERVATION_V2_PROTOCOL,
  parseRuntimeObservationV2,
  runtimeObservationV2StateDigest,
  runtimeObservationV2StateSchema,
  type RuntimeEnvironmentClassificationV2,
  type RuntimeMoneyObservationV2,
} from "@/lib/domain/runtime-observation-v2";

/**
 * Local-only DTO emitted by the NinjaTrader/companion collection boundary.
 * Raw runtime identifiers are intentionally accepted only by this schema and
 * are replaced with keyed opaque references before an observation is returned.
 */
export const RAW_ADDON_RUNTIME_OBSERVATION_V2_PROTOCOL = "ninjatrader-addon-runtime/2.0" as const;
export const RAW_NINJATRADER_ADDON_SNAPSHOT_V2_PROTOCOL = "ninjatrader-addon-snapshot/2.0" as const;

const isoTimestampSchema = z.iso.datetime({ offset: true });
const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const localIdSchema = z.string().min(1).max(1_024);
const softwareVersionSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._+-]{0,39}$/);
const safeCodeSchema = z.string().regex(/^[A-Z][A-Z0-9_.-]{0,79}$/);
const strategyTypeCodeSchema = z.string().regex(/^[A-Za-z][A-Za-z0-9_.-]{0,79}$/);
const instrumentCodeSchema = z.string().regex(/^[A-Z0-9][A-Z0-9 .:/_-]{0,39}$/);
const quantitySchema = z.number().int().positive().max(1_000_000);
const priceSchema = z.number().finite().nonnegative().max(100_000_000);
const moneyMinorSchema = z.number().int().safe().min(-100_000_000_000).max(100_000_000_000);

const rawClassificationEvidenceSchema = z.object({
  accountType: z.enum(["simulation", "live", "unknown"]),
  isSimulation: z.boolean().nullable(),
  simulationMode: z.boolean().nullable(),
  unavailableReasonCode: z.enum([
    "ADDON_OFFLINE",
    "CLASSIFICATION_UNSUPPORTED",
    "CLASSIFICATION_CONFLICT",
    "CLASSIFICATION_UNAVAILABLE",
  ]).nullable(),
}).strict().superRefine((value, context) => {
  const evidence = [
    value.accountType === "simulation" ? true : value.accountType === "live" ? false : null,
    value.isSimulation,
    value.simulationMode,
  ].filter((entry): entry is boolean => entry !== null);
  if (new Set(evidence).size > 1) {
    context.addIssue({ code: "custom", message: "NinjaTrader account classification evidence conflicts" });
  }
  if (evidence.length === 0 && value.unavailableReasonCode === null) {
    context.addIssue({ code: "custom", message: "Unavailable classification requires a typed reason" });
  }
  if (evidence.length > 0 && value.unavailableReasonCode !== null) {
    context.addIssue({ code: "custom", message: "Authoritative classification evidence cannot also be unavailable" });
  }
});

const rawProcessSchema = z.object({
  localId: localIdSchema.nullable(),
  status: z.enum(["running", "starting", "stopping", "not_running", "unknown"]),
  health: z.enum(["healthy", "degraded", "offline", "unknown"]),
  processId: z.number().int().positive().max(4_294_967_295).nullable(),
  version: softwareVersionSchema.nullable(),
  startedAt: isoTimestampSchema.nullable(),
}).strict();

const companionOpaqueProcessSchema = z.discriminatedUnion("status", [
  z.object({
    processRef: z.string().regex(/^process_[a-f0-9]{64}$/),
    status: z.literal("running"),
    health: z.literal("healthy"),
    version: softwareVersionSchema.nullable(),
    startedAt: isoTimestampSchema,
  }).strict(),
  z.object({
    processRef: z.null(),
    status: z.literal("not_running"),
    health: z.literal("offline"),
    version: z.null(),
    startedAt: z.null(),
  }).strict(),
]);

const rawAddonSchema = z.object({
  localId: localIdSchema.nullable(),
  status: z.enum(["connected", "initializing", "disconnected", "degraded", "unknown"]),
  health: z.enum(["healthy", "degraded", "offline", "unknown"]),
  version: softwareVersionSchema.nullable(),
  ipcAuthenticated: z.boolean(),
  capabilities: z.array(safeCodeSchema).max(100),
}).strict();

const rawConnectionSchema = z.object({
  localId: localIdSchema,
  kind: z.enum(["simulation", "brokerage", "market_data", "playback", "unknown"]),
  providerCode: safeCodeSchema.nullable(),
  status: z.enum(["connected", "connecting", "disconnecting", "disconnected", "error", "unknown"]),
  health: z.enum(["healthy", "degraded", "offline", "unknown"]),
  marketDataStatus: z.enum(["live", "delayed", "stale", "unavailable", "not_applicable", "unknown"]),
  lastStateChangeAt: isoTimestampSchema.nullable(),
}).strict();

/**
 * Add-On invariant: localId is the stable raw NinjaTrader account identifier
 * previously supplied to protocol v1. It never leaves the local adapter.
 * accountIdentifier is also local-only and is used solely to derive the mask.
 */
const rawAccountSchema = z.object({
  localId: localIdSchema,
  accountIdentifier: z.string().min(1).max(256),
  classificationEvidence: rawClassificationEvidenceSchema,
  connectionLocalIds: z.array(localIdSchema).max(20),
  status: z.enum(["connected", "disconnected", "unavailable", "unknown"]),
}).strict();

const parameterValueSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("boolean"), value: z.boolean() }).strict(),
  z.object({ kind: z.literal("integer"), value: z.number().int().safe().min(-1_000_000_000).max(1_000_000_000) }).strict(),
  z.object({ kind: z.literal("number"), value: z.number().finite().min(-1_000_000_000).max(1_000_000_000) }).strict(),
  z.object({ kind: z.literal("code"), value: safeCodeSchema }).strict(),
]);

const operationalParameterSchema = z.object({
  parameterCode: safeCodeSchema,
  value: parameterValueSchema,
}).strict();

const rawStrategySchema = z.object({
  localId: localIdSchema,
  accountLocalId: localIdSchema,
  strategyTypeCode: strategyTypeCodeSchema,
  instrumentCode: instrumentCodeSchema,
  enabled: z.boolean(),
  runtimeState: z.enum(["disabled", "enabling", "waiting_sync", "running", "disabling", "error", "unknown"]),
  synchronizationState: z.enum(["synchronized", "not_synchronized", "pending", "not_applicable", "unknown"]),
  operationalParameters: z.array(operationalParameterSchema).max(200),
  lastStateChangeAt: isoTimestampSchema.nullable(),
}).strict();

const rawPositionSchema = z.object({
  localId: localIdSchema,
  accountLocalId: localIdSchema,
  strategyLocalId: localIdSchema.nullable(),
  instrumentCode: instrumentCodeSchema,
  side: z.enum(["long", "short"]),
  quantity: quantitySchema,
  averagePrice: priceSchema,
  markPrice: priceSchema.nullable(),
}).strict();

const rawOrderCommon = {
  localId: localIdSchema,
  accountLocalId: localIdSchema,
  strategyLocalId: localIdSchema.nullable(),
  instrumentCode: instrumentCodeSchema,
  side: z.enum(["buy", "sell"]),
  orderType: z.enum(["market", "limit", "stop_market", "stop_limit", "unknown"]),
  quantity: quantitySchema,
  filledQuantity: z.number().int().min(0).max(1_000_000),
  limitPrice: priceSchema.nullable(),
  stopPrice: priceSchema.nullable(),
  submittedAt: isoTimestampSchema,
};

const rawOrderSchema = z.discriminatedUnion("lifecycle", [
  z.object({
    ...rawOrderCommon,
    lifecycle: z.literal("working"),
    state: z.enum(["submitted", "accepted", "working", "change_pending", "cancel_pending", "unknown"]),
    completedAt: z.null(),
  }).strict(),
  z.object({
    ...rawOrderCommon,
    lifecycle: z.literal("completed"),
    state: z.enum(["filled", "cancelled", "rejected", "expired"]),
    completedAt: isoTimestampSchema,
  }).strict(),
]);

const rawExecutionSchema = z.object({
  localId: localIdSchema,
  orderLocalId: localIdSchema,
  accountLocalId: localIdSchema,
  strategyLocalId: localIdSchema.nullable(),
  instrumentCode: instrumentCodeSchema,
  side: z.enum(["buy", "sell"]),
  quantity: quantitySchema,
  price: priceSchema,
  commissionMinor: moneyMinorSchema.nullable(),
  executedAt: isoTimestampSchema,
}).strict();

const unavailableMoneySchema = z.object({
  availability: z.literal("unavailable"),
  currency: z.literal("USD"),
  amountMinor: z.null(),
  source: z.null(),
  reasonCode: z.enum([
    "ADDON_OFFLINE",
    "ACCOUNT_DISCONNECTED",
    "SOURCE_UNSUPPORTED",
    "SOURCE_ERROR",
    "NOT_OBSERVED_YET",
  ]),
}).strict();

function availableMoneySchema<const T extends readonly [string, ...string[]]>(sources: T) {
  return z.object({
    availability: z.literal("available"),
    currency: z.literal("USD"),
    amountMinor: moneyMinorSchema,
    source: z.enum(sources),
  }).strict();
}

const rawRealizedMoneySchema = z.discriminatedUnion("availability", [
  availableMoneySchema(["ninjatrader_account_item", "ninjatrader_performance"]),
  unavailableMoneySchema,
]);
const rawUnrealizedMoneySchema = z.discriminatedUnion("availability", [
  availableMoneySchema(["ninjatrader_account_item"]),
  unavailableMoneySchema,
]);
const rawNativeLifetimeMoneySchema = z.discriminatedUnion("availability", [
  availableMoneySchema(["ninjatrader_performance"]),
  unavailableMoneySchema,
]);
const rawManagerMoneySchema = z.discriminatedUnion("availability", [
  availableMoneySchema(["manager_ledger"]),
  unavailableMoneySchema,
]);

const rawAddonPnlSchema = z.object({
  accountLocalId: localIdSchema,
  sessionDate: isoDateSchema,
  daily: z.object({
    realized: rawRealizedMoneySchema,
    unrealized: rawUnrealizedMoneySchema,
  }).strict(),
  nativeLifetime: rawNativeLifetimeMoneySchema,
}).strict();

const rawManagerObservedCumulativeSchema = z.object({
  value: rawManagerMoneySchema,
  observedSince: isoTimestampSchema.nullable(),
}).strict();

const rawPnlSchema = rawAddonPnlSchema.extend({
  managerObservedCumulative: rawManagerObservedCumulativeSchema,
}).strict();

const collectionErrorSchema = z.object({
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

const collectionScopeSchema = z.object({
  status: z.enum(["complete", "partial", "unavailable"]),
  itemCount: z.number().int().min(0).max(1_000_000),
  errors: z.array(collectionErrorSchema).max(20),
}).strict();

const collectionStatusSchema = z.object({
  status: z.enum(["complete", "partial", "unavailable"]),
  errors: z.array(collectionErrorSchema).max(20),
}).strict().superRefine((value, context) => {
  if (value.status === "complete" && value.errors.length !== 0) {
    context.addIssue({ code: "custom", message: "A complete collection cannot contain errors", path: ["errors"] });
  }
  if (value.status !== "complete" && value.errors.length === 0) {
    context.addIssue({ code: "custom", message: "An incomplete collection requires a typed error", path: ["errors"] });
  }
  if (new Set(value.errors.map((error) => error.code)).size !== value.errors.length) {
    context.addIssue({ code: "custom", message: "Collection error codes must be unique", path: ["errors"] });
  }
});

const collectionSchema = z.object({
  overall: z.enum(["complete", "partial", "unavailable"]),
  scopes: z.object({
    process: collectionScopeSchema,
    addon: collectionScopeSchema,
    connections: collectionScopeSchema,
    accounts: collectionScopeSchema,
    strategies: collectionScopeSchema,
    positions: collectionScopeSchema,
    orders: collectionScopeSchema,
    executions: collectionScopeSchema,
    pnl: collectionScopeSchema,
  }).strict(),
}).strict();

export const rawAddonRuntimeObservationV2Schema = z.object({
  protocolVersion: z.literal(RAW_ADDON_RUNTIME_OBSERVATION_V2_PROTOCOL),
  observationId: z.uuid(),
  installationLocalId: localIdSchema,
  collectionSessionLocalId: localIdSchema,
  observedAt: isoTimestampSchema,
  receivedAt: isoTimestampSchema,
  freshnessMaxAgeMs: z.number().int().positive().max(3_600_000),
  process: rawProcessSchema.nullable(),
  addon: rawAddonSchema.nullable(),
  connections: z.array(rawConnectionSchema).max(100),
  accounts: z.array(rawAccountSchema).max(500),
  strategies: z.array(rawStrategySchema).max(10_000),
  positions: z.array(rawPositionSchema).max(10_000),
  orders: z.array(rawOrderSchema).max(10_000),
  executions: z.array(rawExecutionSchema).max(10_000),
  pnl: z.array(rawPnlSchema).max(500),
  collection: collectionSchema,
}).strict();

export type RawAddonRuntimeObservationV2 = z.infer<typeof rawAddonRuntimeObservationV2Schema>;

const addonCollectionStatusesSchema = z.object({
  addon: collectionStatusSchema,
  connections: collectionStatusSchema,
  accounts: collectionStatusSchema,
  strategies: collectionStatusSchema,
  positions: collectionStatusSchema,
  orders: collectionStatusSchema,
  executions: collectionStatusSchema,
  pnl: collectionStatusSchema,
}).strict();

export const rawNinjaTraderAddonSnapshotV2Schema = z.object({
  protocolVersion: z.literal(RAW_NINJATRADER_ADDON_SNAPSHOT_V2_PROTOCOL),
  observedAt: isoTimestampSchema,
  addon: rawAddonSchema.nullable(),
  connections: z.array(rawConnectionSchema).max(100),
  accounts: z.array(rawAccountSchema).max(500),
  strategies: z.array(rawStrategySchema).max(10_000),
  positions: z.array(rawPositionSchema).max(10_000),
  orders: z.array(rawOrderSchema).max(10_000),
  executions: z.array(rawExecutionSchema).max(10_000),
  pnl: z.array(rawAddonPnlSchema).max(500),
  collectionScopes: addonCollectionStatusesSchema,
}).strict();

export type RawNinjaTraderAddonSnapshotV2 = z.infer<typeof rawNinjaTraderAddonSnapshotV2Schema>;

export const companionRuntimeObservationV2MetadataSchema = z.object({
  observationId: z.uuid(),
  installationLocalId: localIdSchema,
  collectionSessionLocalId: localIdSchema,
  receivedAt: isoTimestampSchema,
  freshnessMaxAgeMs: z.number().int().positive().max(3_600_000),
  process: companionOpaqueProcessSchema.nullable(),
  processCollectionScope: collectionStatusSchema,
  managerObservedCumulativeByAccountLocalId: z.record(localIdSchema, rawManagerObservedCumulativeSchema),
}).strict();

export type CompanionRuntimeObservationV2Metadata = z.infer<typeof companionRuntimeObservationV2MetadataSchema>;

function keyedHex(secret: Uint8Array, purpose: string, value: string): string {
  return createHmac("sha256", secret).update(`${purpose}\n${value}`, "utf8").digest("hex");
}

function opaqueRef(secret: Uint8Array, prefix: string, purpose: string, localId: string): string {
  return `${prefix}_${keyedHex(secret, purpose, localId).slice(0, 32)}`;
}

/**
 * The process heartbeat and Runtime Observation v2 must address the same local
 * NinjaTrader installation. Keep this derivation as the single source of truth;
 * the raw installation identifier remains local to the companion.
 */
export function deriveRuntimeInstallationRefV2(
  identitySecret: Uint8Array,
  installationLocalIdInput: unknown,
): string {
  if (identitySecret.byteLength !== 32) {
    throw new Error("Identity secret must contain exactly 32 bytes");
  }
  const installationLocalId = localIdSchema.parse(installationLocalIdInput);
  return opaqueRef(identitySecret, "install", "installation-ref-v2", installationLocalId);
}

function buildRefMap(
  secret: Buffer,
  prefix: string,
  purpose: string,
  localIds: readonly string[],
  scope: string,
): Map<string, string> {
  const refs = new Map<string, string>();
  const reverse = new Set<string>();
  for (const localId of localIds) {
    if (refs.has(localId)) throw new Error(`Add-On returned a duplicate ${scope} local identifier`);
    const ref = opaqueRef(secret, prefix, purpose, localId);
    if (reverse.has(ref)) throw new Error(`Opaque ${scope} reference collision`);
    refs.set(localId, ref);
    reverse.add(ref);
  }
  return refs;
}

function requireRef(refs: Map<string, string>, localId: string, relationship: string): string {
  const ref = refs.get(localId);
  if (!ref) throw new Error(`Add-On returned a ${relationship} reference outside this observation`);
  return ref;
}

function optionalRef(refs: Map<string, string>, localId: string | null, relationship: string): string | null {
  return localId === null ? null : requireRef(refs, localId, relationship);
}

function maskAccountIdentifier(value: string): string {
  const ascii = value.replace(/[^A-Za-z0-9]/g, "");
  if (ascii.length < 2) throw new Error("Account identifier cannot be represented by the privacy-safe mask");
  return `****${ascii.slice(-4)}`;
}

function classificationFromEvidence(
  evidence: z.infer<typeof rawClassificationEvidenceSchema>,
): RuntimeEnvironmentClassificationV2 {
  const values = [
    evidence.accountType === "simulation" ? true : evidence.accountType === "live" ? false : null,
    evidence.isSimulation,
    evidence.simulationMode,
  ].filter((entry): entry is boolean => entry !== null);
  if (new Set(values).size > 1) throw new Error("NinjaTrader account classification evidence conflicts");
  const isSimulation = values[0];
  if (isSimulation === undefined) {
    if (evidence.unavailableReasonCode === null) throw new Error("NinjaTrader account classification is unavailable without a reason");
    return {
      environment: "unknown",
      authority: "unavailable",
      source: null,
      reasonCode: evidence.unavailableReasonCode,
    };
  }
  if (evidence.unavailableReasonCode !== null) throw new Error("NinjaTrader account classification evidence is inconsistent");
  return isSimulation
    ? { environment: "simulation", authority: "authoritative", source: "ninjatrader_simulation_account" }
    : { environment: "live", authority: "authoritative", source: "ninjatrader_live_account" };
}

function sorted(values: readonly string[]): string[] {
  return [...values].sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
}

function totalDailyPnl(
  realized: z.infer<typeof rawRealizedMoneySchema>,
  unrealized: z.infer<typeof rawUnrealizedMoneySchema>,
): RuntimeMoneyObservationV2 {
  if (realized.availability === "available" && unrealized.availability === "available") {
    return {
      availability: "available",
      currency: "USD",
      amountMinor: realized.amountMinor + unrealized.amountMinor,
      source: "calculated_by_companion",
    };
  }
  const reasonCode = realized.availability === "unavailable"
    ? realized.reasonCode
    : unrealized.availability === "unavailable"
      ? unrealized.reasonCode
      : "SOURCE_ERROR";
  return {
    availability: "unavailable",
    currency: "USD",
    amountMinor: null,
    source: null,
    reasonCode,
  };
}

export function adaptAddonRuntimeObservationV2(
  input: unknown,
  identitySecret: Buffer,
  companionProcessInput?: unknown,
) {
  if (identitySecret.length !== 32) throw new Error("Identity secret must contain exactly 32 bytes");
  const raw = rawAddonRuntimeObservationV2Schema.parse(input);
  const observedAtMs = Date.parse(raw.observedAt);
  const receivedAtMs = Date.parse(raw.receivedAt);
  const ageMs = receivedAtMs - observedAtMs;
  if (ageMs < 0 || ageMs > 86_400_000) {
    throw new Error("Observation freshness cannot be measured within the supported window");
  }

  const connectionRefs = buildRefMap(identitySecret, "conn", "connection-ref-v2", raw.connections.map((entry) => entry.localId), "connection");
  const accountRefs = buildRefMap(identitySecret, "acct", "account-ref-v1", raw.accounts.map((entry) => entry.localId), "account");
  const strategyRefs = buildRefMap(identitySecret, "strat", "strategy-ref-v1", raw.strategies.map((entry) => entry.localId), "strategy");
  const positionRefs = buildRefMap(identitySecret, "pos", "position-ref-v2", raw.positions.map((entry) => entry.localId), "position");
  const orderRefs = buildRefMap(identitySecret, "ord", "order-ref-v2", raw.orders.map((entry) => entry.localId), "order");
  const executionRefs = buildRefMap(identitySecret, "exec", "execution-ref-v2", raw.executions.map((entry) => entry.localId), "execution");

  const connections = raw.connections.map((connection) => ({
    connectionRef: requireRef(connectionRefs, connection.localId, "connection"),
    raw: connection,
  })).sort((left, right) => left.connectionRef < right.connectionRef ? -1 : left.connectionRef > right.connectionRef ? 1 : 0)
    .map(({ connectionRef, raw: connection }, index) => ({
      connectionRef,
      displayLabel: `Connection ${index + 1}`,
      kind: connection.kind,
      providerCode: connection.providerCode,
      status: connection.status,
      health: connection.health,
      marketDataStatus: connection.marketDataStatus,
      lastStateChangeAt: connection.lastStateChangeAt,
    }));

  const accounts = raw.accounts.map((account) => ({
    accountRef: requireRef(accountRefs, account.localId, "account"),
    raw: account,
    classification: classificationFromEvidence(account.classificationEvidence),
  })).sort((left, right) => left.accountRef < right.accountRef ? -1 : left.accountRef > right.accountRef ? 1 : 0)
    .map(({ accountRef, raw: account, classification }, index) => {
      return {
        accountRef,
        maskedIdentifier: maskAccountIdentifier(account.accountIdentifier),
        identifierFingerprint: `hmac-sha256:${keyedHex(identitySecret, "account-fingerprint-v1", account.localId)}`,
        displayLabel: `${classification.environment === "simulation" ? "Simulation" : classification.environment === "live" ? "Live" : "Unknown"} account ${index + 1}`,
        classification,
        connectionRefs: sorted(account.connectionLocalIds.map((localId) => requireRef(connectionRefs, localId, "account-to-connection"))),
        status: account.status,
      };
    });

  const strategyByRef = new Map<string, { accountRef: string; instrumentCode: string }>();
  const strategies = raw.strategies.map((strategy) => {
    const strategyRef = requireRef(strategyRefs, strategy.localId, "strategy");
    const accountRef = requireRef(accountRefs, strategy.accountLocalId, "strategy-to-account");
    strategyByRef.set(strategyRef, { accountRef, instrumentCode: strategy.instrumentCode });
    return { strategyRef, accountRef, raw: strategy };
  }).sort((left, right) => left.strategyRef < right.strategyRef ? -1 : left.strategyRef > right.strategyRef ? 1 : 0)
    .map(({ strategyRef, accountRef, raw: strategy }, index) => ({
      strategyRef,
      accountRef,
      displayLabel: `Strategy ${index + 1}`,
      strategyTypeCode: strategy.strategyTypeCode,
      instrumentCode: strategy.instrumentCode,
      enabled: strategy.enabled,
      runtimeState: strategy.runtimeState,
      synchronizationState: strategy.synchronizationState,
      operationalParameters: [...strategy.operationalParameters].sort((left, right) => left.parameterCode < right.parameterCode ? -1 : left.parameterCode > right.parameterCode ? 1 : 0),
      lastStateChangeAt: strategy.lastStateChangeAt,
    }));

  const relation = (accountLocalId: string, strategyLocalId: string | null, scope: string) => {
    const accountRef = requireRef(accountRefs, accountLocalId, `${scope}-to-account`);
    const strategyRef = optionalRef(strategyRefs, strategyLocalId, `${scope}-to-strategy`);
    if (strategyRef !== null && strategyByRef.get(strategyRef)?.accountRef !== accountRef) {
      throw new Error(`Add-On returned an inconsistent ${scope} account/strategy relationship`);
    }
    return { accountRef, strategyRef };
  };

  const positions = raw.positions.map((position) => ({
    positionRef: requireRef(positionRefs, position.localId, "position"),
    ...relation(position.accountLocalId, position.strategyLocalId, "position"),
    instrumentCode: position.instrumentCode,
    side: position.side,
    quantity: position.quantity,
    averagePrice: position.averagePrice,
    markPrice: position.markPrice,
  })).sort((left, right) => left.positionRef < right.positionRef ? -1 : left.positionRef > right.positionRef ? 1 : 0);

  const orderByRef = new Map<string, { accountRef: string; strategyRef: string | null; instrumentCode: string }>();
  const orders = raw.orders.map((order) => {
    const orderRef = requireRef(orderRefs, order.localId, "order");
    const relationship = relation(order.accountLocalId, order.strategyLocalId, "order");
    orderByRef.set(orderRef, { ...relationship, instrumentCode: order.instrumentCode });
    return {
      orderRef,
      ...relationship,
      instrumentCode: order.instrumentCode,
      lifecycle: order.lifecycle,
      state: order.state,
      side: order.side,
      orderType: order.orderType,
      quantity: order.quantity,
      filledQuantity: order.filledQuantity,
      limitPrice: order.limitPrice,
      stopPrice: order.stopPrice,
      submittedAt: order.submittedAt,
      completedAt: order.completedAt,
    };
  }).sort((left, right) => left.orderRef < right.orderRef ? -1 : left.orderRef > right.orderRef ? 1 : 0);

  const executions = raw.executions.map((execution) => {
    const relationship = relation(execution.accountLocalId, execution.strategyLocalId, "execution");
    const orderRef = requireRef(orderRefs, execution.orderLocalId, "execution-to-order");
    const order = orderByRef.get(orderRef);
    if (!order || order.accountRef !== relationship.accountRef || order.strategyRef !== relationship.strategyRef || order.instrumentCode !== execution.instrumentCode) {
      throw new Error("Add-On returned an inconsistent execution/order relationship");
    }
    return {
      executionRef: requireRef(executionRefs, execution.localId, "execution"),
      orderRef,
      ...relationship,
      instrumentCode: execution.instrumentCode,
      side: execution.side,
      quantity: execution.quantity,
      price: execution.price,
      commissionMinor: execution.commissionMinor,
      executedAt: execution.executedAt,
    };
  }).sort((left, right) => left.executionRef < right.executionRef ? -1 : left.executionRef > right.executionRef ? 1 : 0);

  const pnl = raw.pnl.map((entry) => ({
    accountRef: requireRef(accountRefs, entry.accountLocalId, "pnl-to-account"),
    sessionDate: entry.sessionDate,
    daily: {
      realized: entry.daily.realized,
      unrealized: entry.daily.unrealized,
      total: totalDailyPnl(entry.daily.realized, entry.daily.unrealized),
    },
    nativeLifetime: entry.nativeLifetime,
    managerObservedCumulative: entry.managerObservedCumulative,
  })).sort((left, right) => left.accountRef < right.accountRef ? -1 : left.accountRef > right.accountRef ? 1 : 0);

  const companionProcess = companionProcessInput === undefined
    ? undefined
    : companionOpaqueProcessSchema.nullable().parse(companionProcessInput);
  const state = runtimeObservationV2StateSchema.parse({
    process: companionProcess !== undefined
      ? companionProcess
      : raw.process === null ? null : {
        processRef: raw.process.localId === null ? null : opaqueRef(identitySecret, "process", "process-ref-v2", raw.process.localId),
        status: raw.process.status,
        health: raw.process.health,
        version: raw.process.version,
        startedAt: raw.process.startedAt,
      },
    addon: raw.addon === null ? null : {
      addonRef: raw.addon.localId === null ? null : opaqueRef(identitySecret, "addon", "addon-ref-v2", raw.addon.localId),
      status: raw.addon.status,
      health: raw.addon.health,
      version: raw.addon.version,
      ipcAuthenticated: raw.addon.ipcAuthenticated,
      capabilities: sorted(raw.addon.capabilities),
    },
    connections,
    accounts,
    strategies,
    positions,
    orders,
    executions,
    pnl,
    collection: raw.collection,
  });

  return parseRuntimeObservationV2({
    protocolVersion: RUNTIME_OBSERVATION_V2_PROTOCOL,
    observationId: raw.observationId,
    source: {
      collector: "vps_companion_agent",
      authority: "ninjatrader_runtime",
      installationRef: deriveRuntimeInstallationRefV2(identitySecret, raw.installationLocalId),
      collectionSessionRef: opaqueRef(identitySecret, "session", "collection-session-ref-v2", raw.collectionSessionLocalId),
    },
    asOf: raw.observedAt,
    freshness: {
      status: ageMs <= raw.freshnessMaxAgeMs ? "fresh" : "stale",
      ageMs,
      maxAgeMs: raw.freshnessMaxAgeMs,
    },
    stateDigest: runtimeObservationV2StateDigest(state),
    state,
  });
}

function scopeWithDerivedCount(
  scope: z.infer<typeof collectionStatusSchema>,
  itemCount: number,
) {
  return { ...scope, itemCount };
}

function derivedOverall(
  scopes: Record<string, { status: "complete" | "partial" | "unavailable" }>,
): "complete" | "partial" | "unavailable" {
  const statuses = Object.values(scopes).map((scope) => scope.status);
  if (statuses.every((status) => status === "complete")) return "complete";
  if (statuses.every((status) => status === "unavailable")) return "unavailable";
  return "partial";
}

export function assembleNinjaTraderAddonRuntimeObservationV2(
  addonInput: unknown,
  companionMetadataInput: unknown,
  identitySecret: Buffer,
) {
  const addon = rawNinjaTraderAddonSnapshotV2Schema.parse(addonInput);
  const metadata = companionRuntimeObservationV2MetadataSchema.parse(companionMetadataInput);

  const accountLocalIds = addon.accounts.map((account) => account.localId);
  const uniqueAccountLocalIds = new Set(accountLocalIds);
  if (uniqueAccountLocalIds.size !== accountLocalIds.length) {
    throw new Error("Add-On returned a duplicate account local identifier");
  }
  const managerAccountLocalIds = Object.keys(metadata.managerObservedCumulativeByAccountLocalId);
  if (
    managerAccountLocalIds.length !== uniqueAccountLocalIds.size
    || managerAccountLocalIds.some((localId) => !uniqueAccountLocalIds.has(localId))
  ) {
    throw new Error("Manager cumulative P&L keys must exactly match the Add-On account inventory");
  }

  const scopes = {
    process: scopeWithDerivedCount(metadata.processCollectionScope, metadata.process === null ? 0 : 1),
    addon: scopeWithDerivedCount(addon.collectionScopes.addon, addon.addon === null ? 0 : 1),
    connections: scopeWithDerivedCount(addon.collectionScopes.connections, addon.connections.length),
    accounts: scopeWithDerivedCount(addon.collectionScopes.accounts, addon.accounts.length),
    strategies: scopeWithDerivedCount(addon.collectionScopes.strategies, addon.strategies.length),
    positions: scopeWithDerivedCount(addon.collectionScopes.positions, addon.positions.length),
    orders: scopeWithDerivedCount(addon.collectionScopes.orders, addon.orders.length),
    executions: scopeWithDerivedCount(addon.collectionScopes.executions, addon.executions.length),
    pnl: scopeWithDerivedCount(addon.collectionScopes.pnl, addon.pnl.length),
  };

  const pnl = addon.pnl.map((entry) => {
    const managerObservedCumulative = metadata.managerObservedCumulativeByAccountLocalId[entry.accountLocalId];
    if (managerObservedCumulative === undefined) {
      throw new Error("Add-On P&L references an account without explicit manager cumulative evidence");
    }
    return { ...entry, managerObservedCumulative };
  });

  return adaptAddonRuntimeObservationV2({
    protocolVersion: RAW_ADDON_RUNTIME_OBSERVATION_V2_PROTOCOL,
    observationId: metadata.observationId,
    installationLocalId: metadata.installationLocalId,
    collectionSessionLocalId: metadata.collectionSessionLocalId,
    observedAt: addon.observedAt,
    receivedAt: metadata.receivedAt,
    freshnessMaxAgeMs: metadata.freshnessMaxAgeMs,
    process: null,
    addon: addon.addon,
    connections: addon.connections,
    accounts: addon.accounts,
    strategies: addon.strategies,
    positions: addon.positions,
    orders: addon.orders,
    executions: addon.executions,
    pnl,
    collection: {
      overall: derivedOverall(scopes),
      scopes,
    },
  }, identitySecret, metadata.process);
}
