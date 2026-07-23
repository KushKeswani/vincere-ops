import type {
  RuntimeCollectionScopeV2,
  RuntimeObservationV2,
} from "./runtime-observation-v2";

export const FEED_ALGO_HEALTH_VERSION = "feed-algo-health/1.0" as const;
export const FEED_ALGO_TRANSITION_WARN_MS = 60_000;

export type FeedAlgoHealthSeverity = "info" | "warning" | "critical";

export interface FeedAlgoHealthObservationInput {
  observation: RuntimeObservationV2;
  occurredAt: Date | string;
  receivedAt: Date | string;
}

export interface FeedAlgoHealthFinding {
  code: string;
  severity: FeedAlgoHealthSeverity;
  title: string;
  summary: string;
  evidence: string[];
  blockerCodes: string[];
  guidedSteps: string[];
}

export interface FeedAlgoHealthAnalysis {
  version: typeof FEED_ALGO_HEALTH_VERSION;
  severity: FeedAlgoHealthSeverity;
  observationStatus: "current" | "stale" | "missing";
  sourceLabel: string;
  observedAt: string;
  occurredAt: string;
  receivedAt: string;
  findings: FeedAlgoHealthFinding[];
  blockerCodes: string[];
  limitations: string[];
}

export interface AnalyzeFeedAlgoHealthInput {
  current: FeedAlgoHealthObservationInput | null;
  prior?: FeedAlgoHealthObservationInput | null;
  now: Date | string;
}

const severityRank: Record<FeedAlgoHealthSeverity, number> = { info: 0, warning: 1, critical: 2 };
const scopeLabels: Record<keyof RuntimeObservationV2["state"]["collection"]["scopes"], string> = {
  process: "NinjaTrader process",
  addon: "NinjaTrader Add-On",
  connections: "connections",
  accounts: "accounts",
  strategies: "strategies",
  positions: "positions",
  orders: "orders",
  executions: "executions",
  pnl: "P&L",
};

const refreshStep = "Obtain a new authenticated Runtime v2 observation, then reassess this view.";
const providerStep = "Inspect each provider in the NinjaTrader Control Center Connections menu and distinguish order-server status from price-server status.";
const logStep = "Inspect today's NinjaTrader Control Center Log tab for the matching Warning, Error, or Alert details.";
const reconcileStep = "Manually reconcile the exact masked account, working orders, open positions, and strategy runtime/synchronization state before any supervised operation.";
const strategyStep = "Inspect the strategy's ConnectionLossHandling, DisconnectDelaySeconds, and StartBehavior settings in NinjaTrader.";

function displayTimestamp(value: Date | string): string {
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Unavailable";
  return parsed.toISOString();
}

function safeConnectionLabel(connection: RuntimeObservationV2["state"]["connections"][number]): string {
  return `${connection.displayLabel}${connection.providerCode ? ` (${connection.providerCode})` : ""}`;
}

function safeAccountLabel(account: RuntimeObservationV2["state"]["accounts"][number]): string {
  return `${account.displayLabel} (${account.maskedIdentifier})`;
}

function safeStrategyLabel(
  strategy: RuntimeObservationV2["state"]["strategies"][number],
  accounts: Map<string, string>,
): string {
  return `${strategy.displayLabel} / ${strategy.strategyTypeCode} / ${strategy.instrumentCode} / ${accounts.get(strategy.accountRef) ?? "Unknown masked account"}`;
}

function finding(
  code: string,
  severity: FeedAlgoHealthSeverity,
  title: string,
  summary: string,
  evidence: string[],
  guidedSteps: string[],
  blocks = true,
): FeedAlgoHealthFinding {
  return { code, severity, title, summary, evidence, blockerCodes: blocks ? [code] : [], guidedSteps };
}

function affectedEvidence(label: string, values: string[]): string[] {
  const displayed = values.slice(0, 20);
  const omitted = values.length - displayed.length;
  return [`${label}: ${displayed.join("; ")}${omitted > 0 ? `; +${omitted} more` : ""}`];
}

function incompleteScopeFinding(
  key: keyof RuntimeObservationV2["state"]["collection"]["scopes"],
  scope: RuntimeCollectionScopeV2,
): FeedAlgoHealthFinding {
  const codes = scope.errors.map((error) => error.code).join(", ");
  return finding(
    scope.status === "unavailable" ? `SCOPE_${key.toUpperCase()}_UNAVAILABLE` : `SCOPE_${key.toUpperCase()}_PARTIAL`,
    scope.status === "unavailable" ? "critical" : "warning",
    `${scopeLabels[key]} evidence is ${scope.status}`,
    `Absence within this ${scope.status} scope is not proof of a clear state.`,
    [`Observed items: ${scope.itemCount}`, `Collector codes: ${codes || "none reported"}`],
    [refreshStep, logStep, reconcileStep],
  );
}

function addStrategyFindings(
  findings: FeedAlgoHealthFinding[],
  observation: RuntimeObservationV2,
  accountLabels: Map<string, string>,
): void {
  const strategies = observation.state.strategies;
  const labels = (rows: typeof strategies) => rows.map((row) => safeStrategyLabel(row, accountLabels));
  const disabled = strategies.filter((row) => !row.enabled || row.runtimeState === "disabled");
  const errors = strategies.filter((row) => row.runtimeState === "error");
  const unknown = strategies.filter((row) => row.runtimeState === "unknown" || row.synchronizationState === "unknown");
  const waiting = strategies.filter((row) => row.runtimeState === "waiting_sync" || row.synchronizationState === "pending");
  const notSynchronized = strategies.filter((row) => row.synchronizationState === "not_synchronized");

  if (disabled.length) findings.push(finding(
    "STRATEGY_DISABLED_OBSERVED", "info", "Disabled strategy observed",
    "A disabled strategy is a state observation, not a failure claim, but it blocks an assumption that the configured stack is active.",
    affectedEvidence("Affected", labels(disabled)), [strategyStep, reconcileStep],
  ));
  if (errors.length) findings.push(finding(
    "STRATEGY_ERROR_OBSERVED", "critical", "Strategy error observed",
    "Runtime v2 reports one or more strategies in an error state.",
    affectedEvidence("Affected", labels(errors)), [logStep, strategyStep, reconcileStep],
  ));
  if (unknown.length) findings.push(finding(
    "STRATEGY_STATE_UNKNOWN", "critical", "Strategy state is unknown",
    "The exact runtime or synchronization state is unavailable and must not be inferred.",
    affectedEvidence("Affected", labels(unknown)), [refreshStep, strategyStep, reconcileStep],
  ));
  if (waiting.length) findings.push(finding(
    "STRATEGY_WAITING_FOR_SYNC", "warning", "Strategy is waiting for synchronization",
    "A pending synchronization state does not establish that the strategy can safely resume operations.",
    affectedEvidence("Affected", labels(waiting)), [strategyStep, logStep, reconcileStep],
  ));
  if (notSynchronized.length) findings.push(finding(
    "STRATEGY_NOT_SYNCHRONIZED", "critical", "Strategy is not synchronized",
    "The strategy's observed position state does not match a synchronized runtime state.",
    affectedEvidence("Affected", labels(notSynchronized)), [strategyStep, logStep, reconcileStep],
  ));
}

function addOrderAndPositionFindings(findings: FeedAlgoHealthFinding[], observation: RuntimeObservationV2, accountLabels: Map<string, string>): void {
  const working = observation.state.orders.filter((row) => row.lifecycle === "working" && row.state === "working");
  const transitional = observation.state.orders.filter((row) => row.lifecycle === "working" && row.state !== "working" && row.state !== "unknown");
  const unknown = observation.state.orders.filter((row) => row.lifecycle === "working" && row.state === "unknown");
  const orderEvidence = (rows: typeof observation.state.orders) => rows.map((row) =>
    `${accountLabels.get(row.accountRef) ?? "Unknown masked account"} / ${row.instrumentCode} / ${row.state}`,
  );
  if (working.length) findings.push(finding(
    "WORKING_ORDERS_PRESENT", "warning", "Working orders are present",
    "Current working order evidence requires exact manual reconciliation before any supervised strategy operation.",
    affectedEvidence("Observed", orderEvidence(working)), [reconcileStep],
  ));
  if (transitional.length) findings.push(finding(
    "TRANSITIONAL_ORDERS_PRESENT", "warning", "Orders are in transitional states",
    "Submitted, accepted, change-pending, or cancel-pending evidence is not a settled order state.",
    affectedEvidence("Observed", orderEvidence(transitional)), [refreshStep, logStep, reconcileStep],
  ));
  if (unknown.length) findings.push(finding(
    "ORDER_STATE_UNKNOWN", "critical", "Order state is unknown",
    "The order lifecycle cannot be safely inferred from this observation.",
    affectedEvidence("Observed", orderEvidence(unknown)), [refreshStep, logStep, reconcileStep],
  ));

  if (observation.state.positions.length) findings.push(finding(
    "OPEN_POSITIONS_PRESENT", "warning", "Open positions are present",
    "Runtime v2 reports one or more non-flat positions; this view makes no recommendation to alter them.",
    affectedEvidence("Observed", observation.state.positions.map((row) =>
      `${accountLabels.get(row.accountRef) ?? "Unknown masked account"} / ${row.instrumentCode} / ${row.side} ${row.quantity}`,
    )), [reconcileStep],
  ));
  if (observation.state.collection.scopes.orders.status !== "complete") findings.push(finding(
    "ORDERS_UNKNOWN", "critical", "Complete order state is unknown",
    "The orders scope is not complete, so unobserved orders may exist.",
    [`Orders scope: ${observation.state.collection.scopes.orders.status}`], [refreshStep, logStep, reconcileStep],
  ));
  if (observation.state.collection.scopes.positions.status !== "complete") findings.push(finding(
    "POSITIONS_UNKNOWN", "critical", "Complete position state is unknown",
    "The positions scope is not complete, so flatness cannot be established.",
    [`Positions scope: ${observation.state.collection.scopes.positions.status}`], [refreshStep, reconcileStep],
  ));
}

export function analyzeFeedAndAlgoHealth(input: AnalyzeFeedAlgoHealthInput): FeedAlgoHealthAnalysis {
  const now = new Date(input.now);
  if (!input.current) {
    const missing = finding(
      "OBSERVATION_MISSING", "critical", "Runtime observation is missing",
      "No authorized Runtime v2 evidence is available for diagnosis.", [], [refreshStep],
    );
    return {
      version: FEED_ALGO_HEALTH_VERSION,
      severity: "critical",
      observationStatus: "missing",
      sourceLabel: "NinjaTrader Runtime Observation v2",
      observedAt: "Unavailable",
      occurredAt: "Unavailable",
      receivedAt: "Unavailable",
      findings: [missing],
      blockerCodes: missing.blockerCodes,
      limitations: ["No runtime state, provider route, account state, order state, position state, or strategy state can be inferred."],
    };
  }

  const observation = input.current.observation;
  const findings: FeedAlgoHealthFinding[] = [];
  const asOfMs = Date.parse(observation.asOf);
  const occurredAtMs = new Date(input.current.occurredAt).getTime();
  const receivedAtMs = new Date(input.current.receivedAt).getTime();
  const nowMs = now.getTime();
  const trustworthyClock = [nowMs, asOfMs, occurredAtMs, receivedAtMs].every(Number.isFinite)
    && asOfMs <= occurredAtMs
    && occurredAtMs <= receivedAtMs
    && receivedAtMs <= nowMs;
  const evidenceAtMs = Math.min(asOfMs, occurredAtMs, receivedAtMs);
  const ageMs = nowMs - evidenceAtMs;
  const stale = !trustworthyClock || ageMs > observation.freshness.maxAgeMs || observation.freshness.status !== "fresh";
  if (!trustworthyClock) findings.push(finding(
    "OBSERVATION_TIME_UNTRUSTWORTHY", "critical", "Observation time cannot be trusted",
    "The evidence chronology must satisfy runtime as-of, event occurrence, manager receipt, then analysis time.",
    [
      `Runtime as-of: ${displayTimestamp(observation.asOf)}`,
      `Event occurred: ${displayTimestamp(input.current.occurredAt)}`,
      `Manager received: ${displayTimestamp(input.current.receivedAt)}`,
      `Analysis time: ${displayTimestamp(input.now)}`,
    ], [refreshStep],
  ));
  else if (stale) findings.push(finding(
    "OBSERVATION_STALE", "critical", "Runtime observation is stale",
    "The latest evidence is outside its declared freshness window.",
    [`Age: ${ageMs} ms`, `Freshness limit: ${observation.freshness.maxAgeMs} ms`], [refreshStep],
  ));
  else findings.push(finding(
    "OBSERVATION_CURRENT", "info", "Runtime observation is current",
    "Freshness permits diagnosis only; it does not establish mutation readiness.",
    [`Age: ${ageMs} ms`, `Freshness limit: ${observation.freshness.maxAgeMs} ms`], [], false,
  ));

  const addon = observation.state.addon;
  if (!addon || addon.status === "disconnected" || addon.health === "offline") findings.push(finding(
    "ADDON_OFFLINE", "critical", "NinjaTrader Add-On is offline",
    "Authoritative in-process runtime evidence is unavailable or disconnected.",
    [addon ? `Status: ${addon.status}; health: ${addon.health}` : "No Add-On row was observed"], [refreshStep, logStep],
  ));
  else {
    if (!addon.ipcAuthenticated) findings.push(finding(
      "ADDON_IPC_UNAUTHENTICATED", "critical", "Add-On IPC is not authenticated",
      "Unauthenticated IPC cannot be treated as authoritative runtime evidence.",
      [`Status: ${addon.status}; health: ${addon.health}`], [refreshStep],
    ));
    if (addon.status === "degraded" || addon.health === "degraded") findings.push(finding(
      "ADDON_DEGRADED", "warning", "NinjaTrader Add-On is degraded",
      "The Add-On reports degraded collection health and gaps must remain explicit.",
      [`Status: ${addon.status}; health: ${addon.health}`], [refreshStep, logStep],
    ));
    if (addon.status === "initializing" || addon.status === "unknown" || addon.health === "unknown") findings.push(finding(
      "ADDON_STATE_UNKNOWN", "critical", "NinjaTrader Add-On state is not settled",
      "Initializing or unknown Add-On state cannot establish authoritative operational readiness.",
      [`Status: ${addon.status}; health: ${addon.health}`], [refreshStep, logStep],
    ));
  }

  for (const [key, scope] of Object.entries(observation.state.collection.scopes) as [keyof typeof observation.state.collection.scopes, RuntimeCollectionScopeV2][]) {
    if (scope.status !== "complete") findings.push(incompleteScopeFinding(key, scope));
  }

  const activeConnections = observation.state.connections.filter((row) => row.status !== "disconnected");
  for (const connection of observation.state.connections) {
    const label = safeConnectionLabel(connection);
    if (["disconnected", "error", "unknown"].includes(connection.status)) findings.push(finding(
      `ORDER_CONNECTION_${connection.status.toUpperCase()}`, "critical", "Provider order connection is not ready",
      "Runtime v2 provider status reflects the order-adapter side separately from price-feed status.",
      [`${label}: ${connection.status}; health ${connection.health}`], [providerStep, logStep, reconcileStep],
    ));
    if (connection.status === "connected" && ["unavailable", "stale", "unknown"].includes(connection.marketDataStatus)) findings.push(finding(
      `PRICE_FEED_${connection.marketDataStatus.toUpperCase()}`, connection.marketDataStatus === "unknown" ? "warning" : "critical",
      "Order connection is present but price-feed evidence is not ready",
      "A connected order adapter does not prove that its price feed is usable.",
      [`${label}: order connected; market data ${connection.marketDataStatus}`], [providerStep, logStep, reconcileStep],
    ));
    if (connection.status === "connected" && connection.marketDataStatus === "delayed") findings.push(finding(
      "PRICE_FEED_DELAYED", "warning", "Price feed is delayed",
      "Delayed market data is distinct from a live price feed and must remain visible.",
      [`${label}: order connected; market data delayed`], [providerStep, logStep, reconcileStep],
    ));
    if (connection.status === "connected" && connection.health === "degraded") findings.push(finding(
      "CONNECTION_DEGRADED", "warning", "Provider connection is degraded",
      "Connected status does not override the provider's degraded health evidence.",
      [`${label}: health degraded`], [providerStep, logStep, reconcileStep],
    ));
    if (["connecting", "disconnecting"].includes(connection.status) && trustworthyClock && connection.lastStateChangeAt) {
      const changedAt = Date.parse(connection.lastStateChangeAt);
      if (Number.isFinite(changedAt) && changedAt <= asOfMs) {
        const transitionAgeMs = asOfMs - changedAt;
        if (transitionAgeMs > FEED_ALGO_TRANSITION_WARN_MS) findings.push(finding(
          "CONNECTION_TRANSITION_TOO_LONG", "warning", "Provider connection transition is taking too long",
          "A long connecting or disconnecting state is reported only because a trustworthy state-change time is present.",
          [`${label}: ${connection.status} for ${transitionAgeMs} ms`], [refreshStep, providerStep, logStep, reconcileStep],
        ));
      }
    }
  }
  if (activeConnections.length > 1) findings.push(finding(
    "PROVIDER_ROUTING_AMBIGUOUS", "warning", "Multiple-provider routing is not proven",
    "Runtime v2 does not report NinjaTrader preferred-connection settings, instrument-class route selection, or connection order.",
    affectedEvidence("Active providers", activeConnections.map(safeConnectionLabel)),
    ["Inspect NinjaTrader Market Data preferred-connection settings and connection order for the exact instrument class.", providerStep, reconcileStep],
  ));

  const accountLabels = new Map(observation.state.accounts.map((row) => [row.accountRef, safeAccountLabel(row)]));
  for (const status of ["disconnected", "unavailable", "unknown"] as const) {
    const affected = observation.state.accounts.filter((row) => row.status === status);
    if (affected.length) findings.push(finding(
      `ACCOUNT_${status.toUpperCase()}`, status === "disconnected" ? "warning" : "critical",
      `Account state is ${status.replaceAll("_", " ")}`,
      "Account readiness must be established from exact provider and runtime evidence, never from its name.",
      affectedEvidence("Affected", affected.map(safeAccountLabel)), [refreshStep, providerStep, reconcileStep],
    ));
  }

  addStrategyFindings(findings, observation, accountLabels);
  addOrderAndPositionFindings(findings, observation, accountLabels);

  const prior = input.prior?.observation;
  if (prior) {
    const priorAsOfMs = Date.parse(prior.asOf);
    const priorOccurredAtMs = new Date(input.prior!.occurredAt).getTime();
    const priorReceivedAtMs = new Date(input.prior!.receivedAt).getTime();
    const priorTrustworthy = [priorAsOfMs, priorOccurredAtMs, priorReceivedAtMs].every(Number.isFinite)
      && priorAsOfMs <= priorOccurredAtMs
      && priorOccurredAtMs <= priorReceivedAtMs
      && priorReceivedAtMs <= nowMs;
    if (!priorTrustworthy) findings.push(finding(
      "PRIOR_OBSERVATION_TIME_UNTRUSTWORTHY", "warning", "Prior observation time cannot be trusted",
      "The optional prior observation is excluded from state-change diagnosis because its evidence chronology is invalid or future-dated.",
      [
        `Prior runtime as-of: ${displayTimestamp(prior.asOf)}`,
        `Prior event occurred: ${displayTimestamp(input.prior!.occurredAt)}`,
        `Prior manager received: ${displayTimestamp(input.prior!.receivedAt)}`,
      ], [refreshStep],
    ));
    else {
      const priorConnections = new Map(prior.state.connections.map((row) => [row.connectionRef, row]));
      const returned = observation.state.connections.filter((row) =>
        row.status === "connected" && priorConnections.has(row.connectionRef) && priorConnections.get(row.connectionRef)!.status !== "connected",
      );
      if (returned.length) findings.push(finding(
        "CONNECTION_RETURNED_UNVERIFIED", "warning", "Connected state returned; strategy recovery is not established",
        "A provider returning to connected does not prove order, position, or strategy recovery under NinjaTrader connection-loss behavior.",
        affectedEvidence("Returned connected", returned.map(safeConnectionLabel)), [strategyStep, refreshStep, logStep, reconcileStep],
      ));
    }
  }

  const severity = findings.reduce<FeedAlgoHealthSeverity>((highest, row) =>
    severityRank[row.severity] > severityRank[highest] ? row.severity : highest, "info");
  const blockerCodes = [...new Set(findings.flatMap((row) => row.blockerCodes))].sort();
  return {
    version: FEED_ALGO_HEALTH_VERSION,
    severity,
    observationStatus: stale ? "stale" : "current",
    sourceLabel: "NinjaTrader Runtime Observation v2",
    observedAt: displayTimestamp(observation.asOf),
    occurredAt: displayTimestamp(input.current.occurredAt),
    receivedAt: displayTimestamp(input.current.receivedAt),
    findings,
    blockerCodes,
    limitations: [
      "Provider order status and price-feed status are distinct; Runtime v2 does not identify the effective instrument route when multiple providers are present.",
      "Runtime v2 has no market-data value named degraded; delayed, stale, unavailable, and unknown are rendered as the available price-feed concern classes.",
      "Collection is sequential and non-atomic. This diagnosis cannot prove a safe control preflight.",
      "No raw logs are parsed. The operator must inspect today's NinjaTrader Log tab when guided by a finding.",
      "A connected provider state never proves that strategies recovered; exact account, order, position, runtime, and synchronization state must be reconciled.",
    ],
  };
}
