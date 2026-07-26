import {
  processQuitRuntimeStateDigest,
  type ProcessControlCommand,
  type ProcessQuitSafetySummary,
} from "@/lib/domain/process-control-contracts";
import { isSequentialInventoryScopeUsable } from "@/lib/domain/runtime-observation-v2";
import type {
  AgentInstallation,
  LatestRuntimeObservationV2,
} from "@/lib/repositories/runtime-repository";
import type { ProcessControlCommandSafetyCounts } from "@/lib/repositories/process-control-repository";

const MAX_PROCESS_EVIDENCE_AGE_MS = 45_000;
const MAX_QUIT_RUNTIME_AGE_MS = 30_000;

type ProcessCommandType = ProcessControlCommand["commandType"];

export type ProcessApprovalInput =
  | {
      agentId: string;
      commandType: "LAUNCH_NINJATRADER";
      expectedProcessStateVersion: string;
      target: { installationRef: string };
    }
  | {
      agentId: string;
      commandType: "REQUEST_NINJATRADER_QUIT";
      expectedProcessStateVersion: string;
      target: { installationRef: string; processRef: string };
      runtimeState: {
        observedAt: string;
        digest: string;
        summary: ProcessQuitSafetySummary;
      };
    };

export interface ProcessControlGate {
  ready: boolean;
  reason: string;
  approvalInput: ProcessApprovalInput | null;
}

export interface ProcessControlPreflight {
  launch: ProcessControlGate;
  quit: ProcessControlGate;
}

export interface ProcessControlDashboardModel {
  agentId: string | null;
  installationLabel: string;
  processStatus: "not observed" | "not running" | "running" | "needs review";
  launch: { ready: boolean; reason: string };
  quit: { ready: boolean; reason: string };
}

function blocked(reason: string): ProcessControlGate {
  return { ready: false, reason, approvalInput: null };
}

function processEvidenceReason(
  agent: AgentInstallation,
  now: Date,
): string | null {
  if (!agent.capabilities.includes("process.control")) {
    return "The selected companion has not enrolled the process.control capability.";
  }
  const process = agent.processObservation;
  if (!process) return "No authenticated process observation has been received.";
  const observedAtMs = process.observedAt.getTime();
  const receivedAtMs = process.receivedAt.getTime();
  const nowMs = now.getTime();
  const ageMs = nowMs - Math.min(observedAtMs, receivedAtMs);
  if (
    process.freshness.status !== "fresh"
    || !Number.isFinite(ageMs)
    || observedAtMs > receivedAtMs
    || receivedAtMs > nowMs
    || ageMs < 0
    || ageMs > Math.min(MAX_PROCESS_EVIDENCE_AGE_MS, process.freshness.maxAgeMs)
  ) return "The authenticated process observation is stale or has an invalid timestamp.";
  return null;
}

function commandOverlapReason(counts: ProcessControlCommandSafetyCounts): string | null {
  if (counts.indeterminate > 0) {
    return "An earlier process command is indeterminate and requires manual reconciliation.";
  }
  if (counts.inFlight > 0) {
    return "Another process command is queued or delivered for this installation.";
  }
  return null;
}

function runtimeFreshnessReason(latest: LatestRuntimeObservationV2 | null, now: Date): string | null {
  if (!latest) return "Graceful quit requires a fresh authenticated Runtime v2 observation.";
  const asOfMs = Date.parse(latest.observation.asOf);
  const occurredAtMs = latest.occurredAt.getTime();
  const receivedAtMs = latest.receivedAt.getTime();
  const nowMs = now.getTime();
  const ageMs = nowMs - Math.min(asOfMs, occurredAtMs, receivedAtMs);
  if (
    latest.observation.freshness.status !== "fresh"
    || !Number.isFinite(ageMs)
    || asOfMs > occurredAtMs
    || occurredAtMs > receivedAtMs
    || receivedAtMs > nowMs
    || ageMs < 0
    || ageMs > Math.min(MAX_QUIT_RUNTIME_AGE_MS, latest.observation.freshness.maxAgeMs)
  ) return "The Runtime v2 observation is stale or has an invalid timestamp.";
  return null;
}

function quitRuntimeReason(
  agent: AgentInstallation,
  latest: LatestRuntimeObservationV2 | null,
  now: Date,
): string | null {
  const freshnessReason = runtimeFreshnessReason(latest, now);
  if (freshnessReason || !latest) return freshnessReason;
  if (latest.agentId !== agent.id) return "Runtime evidence belongs to a different installation.";
  const state = latest.observation.state;
  if (
    state.collection.scopes.process.status !== "complete"
    || state.collection.scopes.addon.status !== "complete"
  ) return "Graceful quit preview requires complete process and Add-On evidence.";
  for (const scope of ["accounts", "strategies", "positions", "orders"] as const) {
    if (!isSequentialInventoryScopeUsable(state.collection.scopes[scope])) {
      return "Graceful quit preview requires usable sequential account, strategy, position, and order evidence with no source error.";
    }
  }
  if (
    state.addon?.status !== "connected"
    || state.addon.health !== "healthy"
    || !state.addon.ipcAuthenticated
  ) return "Graceful quit requires a connected, healthy, authenticated NinjaTrader Add-On.";

  const process = agent.processObservation;
  if (
    !process
    || process.state !== "running"
    || process.matchedProcessCount !== 1
    || !process.processRef
    || !process.processStateVersion
    || latest.observation.source.installationRef !== process.installationRef
    || state.process?.status !== "running"
    || state.process.processRef !== process.processRef
  ) return "Runtime v2 process identity does not match the one exact running process observation.";

  if (state.accounts.some((account) => account.classification.environment !== "simulation")) {
    return "Graceful quit is blocked because a live or unknown account is present.";
  }
  if (state.strategies.some((strategy) =>
    strategy.enabled
    || strategy.runtimeState !== "disabled"
    || strategy.synchronizationState === "unknown"
    || strategy.synchronizationState === "pending"
  )) return "Graceful quit is blocked until every strategy is definitively disabled and stable.";
  if (state.positions.length > 0) return "Graceful quit is blocked while any position is open.";
  if (state.orders.some((order) => order.lifecycle === "working")) {
    return "Graceful quit is blocked while any order is working, transitional, or unknown.";
  }
  return null;
}

function buildQuitSummary(
  latest: LatestRuntimeObservationV2,
  counts: ProcessControlCommandSafetyCounts,
): ProcessQuitSafetySummary {
  const state = latest.observation.state;
  return {
    // There is not yet a scheduler actuator in this process-control milestone.
    // This literal must be replaced by durable scheduler authority before the
    // scheduler and process control can be enabled together.
    armedScheduleCount: 0,
    accountCounts: {
      simulation: state.accounts.filter((account) => account.classification.environment === "simulation").length,
      evaluation: 0,
      funded: 0,
      live: state.accounts.filter((account) => account.classification.environment === "live").length,
      unknown: state.accounts.filter((account) => account.classification.environment === "unknown").length,
    },
    strategyCounts: {
      enabled: state.strategies.filter((strategy) => strategy.enabled).length,
      unknown: state.strategies.filter((strategy) =>
        strategy.runtimeState === "unknown"
        || strategy.runtimeState === "error"
        || strategy.synchronizationState === "unknown"
      ).length,
    },
    positionCounts: { open: state.positions.length, unknown: 0 },
    orderCounts: {
      working: state.orders.filter((order) =>
        order.lifecycle === "working"
        && ["submitted", "accepted", "working"].includes(order.state)
      ).length,
      transitional: state.orders.filter((order) =>
        order.lifecycle === "working"
        && ["change_pending", "cancel_pending"].includes(order.state)
      ).length,
      unknown: state.orders.filter((order) => order.lifecycle === "working" && order.state === "unknown").length,
    },
    commandCounts: counts,
  };
}

export function evaluateProcessControlPreflight(input: {
  agent: AgentInstallation | null;
  latestRuntime: LatestRuntimeObservationV2 | null;
  commandCounts: ProcessControlCommandSafetyCounts;
  now?: Date;
}): ProcessControlPreflight {
  const now = input.now ?? new Date();
  const { agent, latestRuntime, commandCounts } = input;
  if (!agent) {
    const reason = "No authorized local companion installation is selected.";
    return { launch: blocked(reason), quit: blocked(reason) };
  }
  const evidenceReason = processEvidenceReason(agent, now);
  if (evidenceReason) return { launch: blocked(evidenceReason), quit: blocked(evidenceReason) };
  const process = agent.processObservation!;
  const overlapReason = commandOverlapReason(commandCounts);
  if (overlapReason) return { launch: blocked(overlapReason), quit: blocked(overlapReason) };

  const launch = process.state === "not_running"
    && process.matchedProcessCount === 0
    && process.processRef === null
    && process.processStateVersion !== null
    ? {
        ready: true,
        reason: "Fresh evidence confirms NinjaTrader is not running; launch can be queued for this installation.",
        approvalInput: {
          agentId: agent.id,
          commandType: "LAUNCH_NINJATRADER" as const,
          expectedProcessStateVersion: process.processStateVersion,
          target: { installationRef: process.installationRef },
        },
      }
    : blocked(process.state === "running"
      ? "NinjaTrader is already running, so launch is unavailable."
      : "Launch requires one fresh, exact not-running process observation.");

  let quit = blocked(process.state === "not_running"
    ? "NinjaTrader is not running, so graceful quit is unavailable."
    : "Graceful quit requires one fresh, exact running process observation.");
  if (
    process.state === "running"
    && process.matchedProcessCount === 1
    && process.processRef
    && process.processStateVersion
  ) {
    const reason = quitRuntimeReason(agent, latestRuntime, now);
    if (reason) quit = blocked(reason);
    else if (latestRuntime) {
      const summary = buildQuitSummary(latestRuntime, commandCounts);
      const observedAt = latestRuntime.observation.asOf;
      quit = {
        ready: true,
        reason: "Fresh complete SIM-only evidence is safe for one queued graceful-quit request.",
        approvalInput: {
          agentId: agent.id,
          commandType: "REQUEST_NINJATRADER_QUIT",
          expectedProcessStateVersion: process.processStateVersion,
          target: {
            installationRef: process.installationRef,
            processRef: process.processRef,
          },
          runtimeState: {
            observedAt,
            digest: processQuitRuntimeStateDigest(observedAt, summary),
            summary,
          },
        },
      };
    }
  }
  return { launch, quit };
}

export function buildProcessControlDashboardModel(
  agent: AgentInstallation | null,
  preflight: ProcessControlPreflight,
): ProcessControlDashboardModel {
  const state = agent?.processObservation?.state;
  const processStatus = state === "running" || state === "not_running"
    ? state === "running" ? "running" : "not running"
    : state ? "needs review" : "not observed";
  return {
    agentId: agent?.id ?? null,
    installationLabel: agent?.displayName ?? "No local installation",
    processStatus,
    launch: { ready: preflight.launch.ready, reason: preflight.launch.reason },
    quit: { ready: preflight.quit.ready, reason: preflight.quit.reason },
  };
}

export function expectedProcessConfirmation(commandType: ProcessCommandType): string {
  return commandType === "LAUNCH_NINJATRADER" ? "LAUNCH NINJATRADER" : "QUIT NINJATRADER";
}
