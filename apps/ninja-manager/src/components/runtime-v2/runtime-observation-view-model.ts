import type {
  RuntimeCollectionScopeV2,
  RuntimeMoneyObservationV2,
  RuntimeObservationV2,
} from "@/lib/domain/runtime-observation-v2";

export const RUNTIME_V2_DETAIL_LIMIT = 100;
const STRATEGY_PARAMETER_LIMIT = 12;

const scopeLabels = {
  process: "NinjaTrader process",
  addon: "NinjaTrader Add-On",
  connections: "Connections",
  accounts: "Accounts",
  strategies: "Strategies",
  positions: "Positions",
  orders: "Orders",
  executions: "Executions",
  pnl: "P&L",
} as const;

type ScopeKey = keyof typeof scopeLabels;

export interface RuntimeObservationV2DisplayInput {
  observation: RuntimeObservationV2;
  receivedAt: Date | string;
}

export interface RuntimeScopeDisplay {
  key: ScopeKey;
  label: string;
  status: RuntimeCollectionScopeV2["status"];
  itemCount: number;
  issues: string[];
}

export interface MoneyDisplay {
  available: boolean;
  primary: string;
  detail: string;
}

interface LimitedRows<T> {
  rows: T[];
  total: number;
  omitted: number;
}

export interface RuntimeObservationV2DisplayModel {
  sourceLabel: string;
  asOf: string;
  receivedAt: string;
  freshness: "fresh" | "stale" | "unknown";
  freshnessDetail: string;
  overall: "complete" | "partial" | "unavailable";
  scopes: RuntimeScopeDisplay[];
  collectionIssues: string[];
  process: null | {
    status: string;
    health: string;
    version: string;
    startedAt: string;
  };
  addon: null | {
    status: string;
    health: string;
    version: string;
    ipc: string;
    capabilities: string[];
  };
  connections: LimitedRows<{
    label: string;
    kind: string;
    provider: string;
    status: string;
    health: string;
    marketData: string;
    changedAt: string;
  }>;
  accounts: LimitedRows<{
    label: string;
    maskedIdentifier: string;
    classification: string;
    classificationDetail: string;
    connections: string;
    status: string;
  }>;
  strategies: LimitedRows<{
    label: string;
    strategyType: string;
    account: string;
    instrument: string;
    enabled: string;
    runtimeState: string;
    synchronizationState: string;
    parameters: string;
    changedAt: string;
  }>;
  positions: LimitedRows<{
    account: string;
    strategy: string;
    instrument: string;
    side: string;
    quantity: string;
    averagePrice: string;
    markPrice: string;
  }>;
  workingOrders: LimitedRows<OrderDisplay>;
  completedOrders: LimitedRows<OrderDisplay>;
  executions: LimitedRows<{
    account: string;
    strategy: string;
    instrument: string;
    side: string;
    quantity: string;
    price: string;
    commission: string;
    executedAt: string;
  }>;
  pnl: LimitedRows<{
    account: string;
    sessionDate: string;
    realized: MoneyDisplay;
    unrealized: MoneyDisplay;
    total: MoneyDisplay;
    nativeLifetime: MoneyDisplay;
    managerCumulative: MoneyDisplay;
    managerObservedSince: string;
  }>;
}

interface OrderDisplay {
  account: string;
  strategy: string;
  instrument: string;
  state: string;
  side: string;
  orderType: string;
  quantity: string;
  prices: string;
  submittedAt: string;
  completedAt: string;
}

function humanize(value: string): string {
  return value.replaceAll("_", " ").toLowerCase();
}

function formatTimestamp(value: Date | string | null): string {
  if (value === null) return "Not reported";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "Invalid timestamp";
  return `${new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "medium",
    timeZone: "America/New_York",
  }).format(date)} ET`;
}

function formatDuration(ageMs: number): string {
  if (ageMs < 1_000) return `${ageMs} ms`;
  const seconds = Math.floor(ageMs / 1_000);
  if (seconds < 60) return `${seconds} sec`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} hr`;
  return `${Math.floor(hours / 24)} days`;
}

function limitRows<T>(rows: T[]): LimitedRows<T> {
  return {
    rows: rows.slice(0, RUNTIME_V2_DETAIL_LIMIT),
    total: rows.length,
    omitted: Math.max(0, rows.length - RUNTIME_V2_DETAIL_LIMIT),
  };
}

function formatPrice(value: number | null): string {
  if (value === null) return "Not reported";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 8 }).format(value);
}

function sourceLabel(source: string): string {
  const labels: Record<string, string> = {
    ninjatrader_account_item: "NinjaTrader account item",
    ninjatrader_performance: "NinjaTrader performance",
    calculated_by_companion: "companion calculation",
    manager_ledger: "manager ledger",
  };
  return labels[source] ?? humanize(source);
}

function reasonLabel(reason: string): string {
  const labels: Record<string, string> = {
    ADDON_OFFLINE: "Add-On offline",
    ACCOUNT_DISCONNECTED: "account disconnected",
    SOURCE_UNSUPPORTED: "source unsupported",
    SOURCE_ERROR: "source error",
    NOT_OBSERVED_YET: "not observed yet",
  };
  return labels[reason] ?? humanize(reason);
}

export function formatRuntimeMoney(value: RuntimeMoneyObservationV2): MoneyDisplay {
  if (value.availability === "unavailable") {
    return {
      available: false,
      primary: "Unavailable",
      detail: reasonLabel(value.reasonCode),
    };
  }
  return {
    available: true,
    primary: new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: value.currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value.amountMinor / 100),
    detail: sourceLabel(value.source),
  };
}

function parameterText(parameters: RuntimeObservationV2["state"]["strategies"][number]["operationalParameters"]): string {
  if (parameters.length === 0) return "None reported";
  const rendered = parameters.slice(0, STRATEGY_PARAMETER_LIMIT).map((parameter) =>
    `${parameter.parameterCode}=${String(parameter.value.value)}`,
  );
  const omitted = parameters.length - rendered.length;
  return omitted > 0 ? `${rendered.join(", ")} (+${omitted} more)` : rendered.join(", ");
}

function accountClassification(
  classification: RuntimeObservationV2["state"]["accounts"][number]["classification"],
): { classification: string; detail: string } {
  if (classification.environment === "unknown") {
    return { classification: "Unknown", detail: `Unavailable: ${humanize(classification.reasonCode)}` };
  }
  return {
    classification: classification.environment === "simulation" ? "Simulation" : "Live",
    detail: "Authoritative NinjaTrader classification",
  };
}

function buildOrder(
  order: RuntimeObservationV2["state"]["orders"][number],
  accountLabels: Map<string, string>,
  strategyLabels: Map<string, string>,
): OrderDisplay {
  const prices = [
    order.limitPrice === null ? null : `Limit ${formatPrice(order.limitPrice)}`,
    order.stopPrice === null ? null : `Stop ${formatPrice(order.stopPrice)}`,
  ].filter((value): value is string => value !== null).join(" · ") || "No limit/stop price";
  return {
    account: accountLabels.get(order.accountRef) ?? "Unknown masked account",
    strategy: order.strategyRef === null ? "Not attributed" : strategyLabels.get(order.strategyRef) ?? "Unknown strategy",
    instrument: order.instrumentCode,
    state: humanize(order.state),
    side: order.side,
    orderType: humanize(order.orderType),
    quantity: `${order.filledQuantity} / ${order.quantity} filled`,
    prices,
    submittedAt: formatTimestamp(order.submittedAt),
    completedAt: formatTimestamp(order.completedAt),
  };
}

export function buildRuntimeObservationV2DisplayModel(
  input: RuntimeObservationV2DisplayInput,
  now = new Date(),
): RuntimeObservationV2DisplayModel {
  const { observation } = input;
  const state = observation.state;
  const asOfMs = Date.parse(observation.asOf);
  const liveAgeMs = Number.isNaN(asOfMs) ? null : Math.max(0, now.getTime() - asOfMs);
  const freshness = observation.freshness.status === "unknown"
    ? "unknown"
    : observation.freshness.status === "stale"
      || liveAgeMs === null
      || liveAgeMs > observation.freshness.maxAgeMs ? "stale" : "fresh";
  const freshnessDetail = liveAgeMs === null
    ? "Age cannot be measured from the reported timestamp"
    : `${formatDuration(liveAgeMs)} old · threshold ${formatDuration(observation.freshness.maxAgeMs)}`;

  const scopes = (Object.keys(scopeLabels) as ScopeKey[]).map((key) => {
    const scope = state.collection.scopes[key];
    return {
      key,
      label: scopeLabels[key],
      status: scope.status,
      itemCount: scope.itemCount,
      issues: scope.errors.map((error) =>
        `${humanize(error.code)} · ${error.retryable ? "retryable" : "manual review required"}`,
      ),
    };
  });
  const collectionIssues = scopes.flatMap((scope) => scope.issues.map((issue) => `${scope.label}: ${issue}`));
  const connectionLabels = new Map(state.connections.map((connection) => [connection.connectionRef, connection.displayLabel]));
  const accountLabels = new Map(state.accounts.map((account) => [account.accountRef, `${account.displayLabel} (${account.maskedIdentifier})`]));
  const strategyLabels = new Map(state.strategies.map((strategy) => [strategy.strategyRef, strategy.displayLabel]));

  const connections = state.connections.map((connection) => ({
    label: connection.displayLabel,
    kind: humanize(connection.kind),
    provider: connection.providerCode ?? "Not reported",
    status: connection.status,
    health: connection.health,
    marketData: humanize(connection.marketDataStatus),
    changedAt: formatTimestamp(connection.lastStateChangeAt),
  }));
  const accounts = state.accounts.map((account) => {
    const classification = accountClassification(account.classification);
    return {
      label: account.displayLabel,
      maskedIdentifier: account.maskedIdentifier,
      ...classification,
      classificationDetail: classification.detail,
      connections: account.connectionRefs.map((ref) => connectionLabels.get(ref) ?? "Unknown connection").join(", ") || "None reported",
      status: account.status,
    };
  });
  const strategies = state.strategies.map((strategy) => ({
    label: strategy.displayLabel,
    strategyType: strategy.strategyTypeCode,
    account: accountLabels.get(strategy.accountRef) ?? "Unknown masked account",
    instrument: strategy.instrumentCode,
    enabled: strategy.enabled ? "Enabled" : "Disabled",
    runtimeState: strategy.runtimeState,
    synchronizationState: strategy.synchronizationState,
    parameters: parameterText(strategy.operationalParameters),
    changedAt: formatTimestamp(strategy.lastStateChangeAt),
  }));
  const positions = state.positions.map((position) => ({
    account: accountLabels.get(position.accountRef) ?? "Unknown masked account",
    strategy: position.strategyRef === null ? "Not attributed" : strategyLabels.get(position.strategyRef) ?? "Unknown strategy",
    instrument: position.instrumentCode,
    side: position.side,
    quantity: String(position.quantity),
    averagePrice: formatPrice(position.averagePrice),
    markPrice: formatPrice(position.markPrice),
  }));
  const workingOrders = state.orders
    .filter((order) => order.lifecycle === "working")
    .sort((left, right) => Date.parse(right.submittedAt) - Date.parse(left.submittedAt))
    .map((order) => buildOrder(order, accountLabels, strategyLabels));
  const completedOrders = state.orders
    .filter((order) => order.lifecycle === "completed")
    .sort((left, right) => Date.parse(right.completedAt) - Date.parse(left.completedAt))
    .map((order) => buildOrder(order, accountLabels, strategyLabels));
  const executions = [...state.executions]
    .sort((left, right) => Date.parse(right.executedAt) - Date.parse(left.executedAt))
    .map((execution) => ({
      account: accountLabels.get(execution.accountRef) ?? "Unknown masked account",
      strategy: execution.strategyRef === null ? "Not attributed" : strategyLabels.get(execution.strategyRef) ?? "Unknown strategy",
      instrument: execution.instrumentCode,
      side: execution.side,
      quantity: String(execution.quantity),
      price: formatPrice(execution.price),
      commission: execution.commissionMinor === null
        ? "Not reported"
        : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(execution.commissionMinor / 100),
      executedAt: formatTimestamp(execution.executedAt),
    }));
  const pnl = state.pnl.map((row) => ({
    account: accountLabels.get(row.accountRef) ?? "Unknown masked account",
    sessionDate: row.sessionDate,
    realized: formatRuntimeMoney(row.daily.realized),
    unrealized: formatRuntimeMoney(row.daily.unrealized),
    total: formatRuntimeMoney(row.daily.total),
    nativeLifetime: formatRuntimeMoney(row.nativeLifetime),
    managerCumulative: formatRuntimeMoney(row.managerObservedCumulative.value),
    managerObservedSince: formatTimestamp(row.managerObservedCumulative.observedSince),
  }));

  return {
    sourceLabel: "NinjaTrader Runtime Observation v2",
    asOf: formatTimestamp(observation.asOf),
    receivedAt: formatTimestamp(input.receivedAt),
    freshness,
    freshnessDetail,
    overall: state.collection.overall,
    scopes,
    collectionIssues,
    process: state.process === null ? null : {
      status: state.process.status,
      health: state.process.health,
      version: state.process.version ?? "Not reported",
      startedAt: formatTimestamp(state.process.startedAt),
    },
    addon: state.addon === null ? null : {
      status: state.addon.status,
      health: state.addon.health,
      version: state.addon.version ?? "Not reported",
      ipc: state.addon.ipcAuthenticated ? "Authenticated IPC" : "IPC not authenticated",
      capabilities: state.addon.capabilities,
    },
    connections: limitRows(connections),
    accounts: limitRows(accounts),
    strategies: limitRows(strategies),
    positions: limitRows(positions),
    workingOrders: limitRows(workingOrders),
    completedOrders: limitRows(completedOrders),
    executions: limitRows(executions),
    pnl: limitRows(pnl),
  };
}
