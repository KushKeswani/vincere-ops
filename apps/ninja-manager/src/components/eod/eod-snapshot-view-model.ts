import {
  EOD_DECLARED_AGE_TOLERANCE_MS,
  EOD_MAX_SOURCE_AGE_MS,
  type EodMoneyValue,
  type EodSnapshot,
  type EodSnapshotSummary,
} from "@/lib/domain/eod-snapshot-contracts";
import type { LatestRuntimeObservationV2 } from "@/lib/repositories/runtime-repository";

const reasonLabels: Record<string, string> = {
  ADDON_OFFLINE: "Add-On offline",
  ACCOUNT_DISCONNECTED: "Account disconnected",
  SOURCE_UNSUPPORTED: "Source unsupported",
  SOURCE_ERROR: "Source error",
  NOT_OBSERVED_YET: "Not observed yet",
  CLASSIFICATION_UNSUPPORTED: "Classification unsupported",
  CLASSIFICATION_CONFLICT: "Classification conflict",
  CLASSIFICATION_UNAVAILABLE: "Classification unavailable",
};

const moneySourceLabels: Record<NonNullable<EodMoneyValue["source"]>, string> = {
  ninjatrader_account_item: "NinjaTrader account item",
  ninjatrader_performance: "NinjaTrader performance",
  calculated_by_companion: "Companion calculation",
  manager_ledger: "Manager ledger",
};

export interface EodMoneyDisplay {
  available: boolean;
  value: string;
  detail: string;
}

export interface EodAccountDisplay {
  key: string;
  label: string;
  maskedIdentifier: string;
  classification: string;
  classificationDetail: string;
  sessionDate: string;
  dailyRealized: EodMoneyDisplay;
  dailyUnrealized: EodMoneyDisplay;
  dailyTotal: EodMoneyDisplay;
  nativeLifetime: EodMoneyDisplay;
  managerObserved: EodMoneyDisplay;
  managerObservedSince: string;
  strategies: Array<{
    key: string;
    label: string;
    strategyType: string;
    instrument: string;
    enabled: string;
    runtimeState: string;
    synchronizationState: string;
  }>;
}

export interface EodSnapshotDisplayModel {
  intendedDate: string;
  capturedAt: string;
  timeZone: string;
  overall: "complete" | "partial" | "unavailable";
  scopes: Array<{
    key: string;
    label: string;
    status: "complete" | "partial" | "unavailable";
    itemCount: number;
    issues: string[];
  }>;
  accounts: EodAccountDisplay[];
  strategyCount: number;
}

export interface EodSnapshotHistoryDisplay {
  key: string;
  intendedDate: string;
  capturedAt: string;
  completeness: "complete" | "partial" | "unavailable";
  accountCount: number;
  strategyCount: number;
}

function formatTimestamp(value: string | Date): string {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/New_York",
  }).format(new Date(value));
}

function safeReason(value: string | null): string {
  if (!value) return "No reason reported";
  return reasonLabels[value] ?? "Unavailable from the authoritative source";
}

export function formatEodMoney(value: EodMoneyValue): EodMoneyDisplay {
  if (value.availability === "unavailable") {
    return { available: false, value: "Unavailable", detail: safeReason(value.reason) };
  }
  return {
    available: true,
    value: new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value.amountMinor / 100),
    detail: (value.amountMinor === 0 ? "Available zero · " : "") + moneySourceLabels[value.source],
  };
}

const unavailableMoney: EodMoneyDisplay = {
  available: false,
  value: "Unavailable",
  detail: "No P&L observation was retained for this account",
};

export function isRuntimeObservationCaptureReady(
  latest: LatestRuntimeObservationV2 | null,
  now = new Date(),
): latest is LatestRuntimeObservationV2 {
  if (!latest || latest.observation.freshness.status !== "fresh") return false;
  const asOf = Date.parse(latest.observation.asOf);
  const occurredAt = latest.occurredAt.getTime();
  const receivedAt = latest.receivedAt.getTime();
  const capturedAt = now.getTime();
  const declaredAge = latest.observation.freshness.ageMs;
  return declaredAge !== null
    && [asOf, occurredAt, receivedAt, capturedAt].every(Number.isFinite)
    && asOf <= occurredAt
    && occurredAt <= receivedAt
    && receivedAt <= capturedAt
    && capturedAt - asOf <= EOD_MAX_SOURCE_AGE_MS
    && Math.abs(declaredAge - (occurredAt - asOf)) <= EOD_DECLARED_AGE_TOLERANCE_MS;
}

export function buildEodSnapshotDisplayModel(snapshot: EodSnapshot): EodSnapshotDisplayModel {
  const accounts = snapshot.accounts.map((account) => {
    const classification = account.classification.environment === "unknown"
      ? "Unknown classification"
      : `Authoritative ${account.classification.environment}`;
    const classificationDetail = account.classification.environment === "unknown"
      ? safeReason(account.classification.reason)
      : "Classified by NinjaTrader";
    const pnl = account.pnl;
    return {
      key: `account-${account.ordinal}`,
      label: account.displayLabel,
      maskedIdentifier: account.maskedIdentifier,
      classification,
      classificationDetail,
      sessionDate: pnl?.sessionDate ?? "Unavailable",
      dailyRealized: pnl ? formatEodMoney(pnl.daily.realized) : unavailableMoney,
      dailyUnrealized: pnl ? formatEodMoney(pnl.daily.unrealized) : unavailableMoney,
      dailyTotal: pnl ? formatEodMoney(pnl.daily.total) : unavailableMoney,
      nativeLifetime: pnl ? formatEodMoney(pnl.nativeLifetime) : unavailableMoney,
      managerObserved: pnl ? formatEodMoney(pnl.managerObservedCumulative.value) : unavailableMoney,
      managerObservedSince: pnl?.managerObservedCumulative.observedSince
        ? formatTimestamp(pnl.managerObservedCumulative.observedSince)
        : "Unavailable",
      strategies: account.strategies.map((strategy) => ({
        key: `strategy-${account.ordinal}-${strategy.ordinal}`,
        label: strategy.displayLabel,
        strategyType: strategy.strategyType,
        instrument: strategy.instrument,
        enabled: strategy.enabled ? "Enabled" : "Disabled",
        runtimeState: strategy.runtimeState,
        synchronizationState: strategy.synchronizationState,
      })),
    };
  });
  return {
    intendedDate: snapshot.intendedLocalDate,
    capturedAt: formatTimestamp(snapshot.capturedAt),
    timeZone: snapshot.timeZone,
    overall: snapshot.completeness.overall,
    scopes: Object.entries(snapshot.completeness.scopes).map(([key, value]) => ({
      key,
      label: key === "pnl" ? "P&L" : key[0].toUpperCase() + key.slice(1),
      status: value.status,
      itemCount: value.itemCount,
      issues: value.errors.map((error) => `${safeReason(error.code)}${error.retryable ? "; retryable" : "; manual review required"}`),
    })),
    accounts,
    strategyCount: accounts.reduce((count, account) => count + account.strategies.length, 0),
  };
}

export function buildEodSnapshotHistoryDisplay(
  summaries: EodSnapshotSummary[],
): EodSnapshotHistoryDisplay[] {
  return summaries.map((summary) => ({
    key: summary.snapshotId,
    intendedDate: summary.intendedLocalDate,
    capturedAt: formatTimestamp(summary.capturedAt),
    completeness: summary.completeness.overall,
    accountCount: summary.accountCount,
    strategyCount: summary.strategyCount,
  }));
}
