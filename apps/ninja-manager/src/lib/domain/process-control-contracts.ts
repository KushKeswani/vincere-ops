import { z } from "zod";

import {
  hashCanonicalPayload,
  RUNTIME_CANONICALIZATION,
} from "@/lib/domain/runtime-contracts";

export const PROCESS_CONTROL_PROTOCOL_VERSION = "process-control/1.0" as const;
export const MAX_PROCESS_CONTROL_TTL_MS = 60_000;
export const MAX_PROCESS_CONTROL_APPROVAL_TTL_MS = 60_000;
export const MAX_QUIT_RUNTIME_STATE_AGE_MS = 30_000;
export const MAX_LAUNCH_READINESS_AGE_MS = 5_000;

const sha256 = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const isoTimestamp = z.iso.datetime({ offset: true });
const installationRef = z.string().regex(/^install_[a-z0-9]{16,64}$/);
const processRef = z.string().regex(/^process_[a-z0-9]{16,64}$/);
const boundedCount = z.number().int().min(0).max(100_000);

const launchReadinessSource = z.literal("authenticated_runtime_v2_addon_ipc");

export const launchReadinessObservationSchema = z.discriminatedUnion("state", [
  z.object({
    state: z.literal("ready"),
    observedAt: isoTimestamp,
    source: launchReadinessSource,
    authenticated: z.literal(true),
    reasonCode: z.null(),
  }).strict(),
  z.object({
    state: z.literal("not_ready"),
    observedAt: isoTimestamp,
    source: launchReadinessSource,
    authenticated: z.literal(true),
    reasonCode: z.enum(["ADDON_RUNTIME_NOT_READY", "LOGIN_REQUIRED"]),
  }).strict(),
  z.object({
    state: z.literal("unknown"),
    observedAt: isoTimestamp,
    source: launchReadinessSource,
    authenticated: z.boolean(),
    reasonCode: z.enum([
      "PROVIDER_UNAVAILABLE",
      "PROVIDER_ERROR",
      "PROVIDER_INVALID_RESPONSE",
      "OBSERVATION_STALE",
      "OBSERVATION_TIME_INVALID",
      "ADDON_STATE_UNAVAILABLE",
    ]),
  }).strict(),
]);

export type LaunchReadinessObservation = z.infer<typeof launchReadinessObservationSchema>;

export function isFreshAuthenticatedLaunchReadiness(
  readiness: LaunchReadinessObservation | null | undefined,
  postObservedAt: string | null,
  occurredAt: string,
): readiness is Extract<LaunchReadinessObservation, { state: "ready" }> {
  if (!readiness || readiness.state !== "ready" || !postObservedAt) return false;
  const readinessMs = Date.parse(readiness.observedAt);
  const postMs = Date.parse(postObservedAt);
  const occurredMs = Date.parse(occurredAt);
  return Number.isFinite(readinessMs)
    && Number.isFinite(postMs)
    && Number.isFinite(occurredMs)
    && readinessMs >= postMs
    && readinessMs <= occurredMs
    && occurredMs - readinessMs <= MAX_LAUNCH_READINESS_AGE_MS;
}

const launchTargetSchema = z.object({
  installationRef,
}).strict();

const quitTargetSchema = z.object({
  installationRef,
  processRef,
}).strict();

export const processQuitSafetySummarySchema = z.object({
  armedScheduleCount: boundedCount,
  accountCounts: z.object({
    simulation: boundedCount,
    evaluation: boundedCount,
    funded: boundedCount,
    live: boundedCount,
    unknown: boundedCount,
  }).strict(),
  strategyCounts: z.object({
    enabled: boundedCount,
    unknown: boundedCount,
  }).strict(),
  positionCounts: z.object({
    open: boundedCount,
    unknown: boundedCount,
  }).strict(),
  orderCounts: z.object({
    working: boundedCount,
    transitional: boundedCount,
    unknown: boundedCount,
  }).strict(),
  commandCounts: z.object({
    inFlight: boundedCount,
    indeterminate: boundedCount,
  }).strict(),
}).strict();

export const processQuitBlockerCodeSchema = z.enum([
  "SCHEDULES_ARMED",
  "NON_SIMULATION_ACCOUNT_PRESENT",
  "STRATEGY_ENABLED_OR_UNKNOWN",
  "POSITION_OPEN_OR_UNKNOWN",
  "ORDER_WORKING_TRANSITIONAL_OR_UNKNOWN",
  "COMMAND_IN_FLIGHT_OR_INDETERMINATE",
  "INSTALLATION_NOT_ALLOWLISTED",
  "TARGET_NOT_FOUND",
  "TARGET_AMBIGUOUS",
  "PROCESS_STATE_CHANGED",
  "RUNTIME_STATE_STALE",
]);

export type ProcessQuitSafetySummary = z.infer<typeof processQuitSafetySummarySchema>;
export type ProcessQuitBlockerCode = z.infer<typeof processQuitBlockerCodeSchema>;

export function processQuitBlockers(summary: ProcessQuitSafetySummary): ProcessQuitBlockerCode[] {
  const blockers: ProcessQuitBlockerCode[] = [];
  if (summary.armedScheduleCount > 0) blockers.push("SCHEDULES_ARMED");
  if (
    summary.accountCounts.evaluation > 0
    || summary.accountCounts.funded > 0
    || summary.accountCounts.live > 0
    || summary.accountCounts.unknown > 0
  ) blockers.push("NON_SIMULATION_ACCOUNT_PRESENT");
  if (summary.strategyCounts.enabled > 0 || summary.strategyCounts.unknown > 0) {
    blockers.push("STRATEGY_ENABLED_OR_UNKNOWN");
  }
  if (summary.positionCounts.open > 0 || summary.positionCounts.unknown > 0) {
    blockers.push("POSITION_OPEN_OR_UNKNOWN");
  }
  if (
    summary.orderCounts.working > 0
    || summary.orderCounts.transitional > 0
    || summary.orderCounts.unknown > 0
  ) blockers.push("ORDER_WORKING_TRANSITIONAL_OR_UNKNOWN");
  if (summary.commandCounts.inFlight > 0 || summary.commandCounts.indeterminate > 0) {
    blockers.push("COMMAND_IN_FLIGHT_OR_INDETERMINATE");
  }
  return blockers.sort();
}

export const processQuitRuntimeStateSchema = z.object({
  observedAt: isoTimestamp,
  digest: sha256,
  summary: processQuitSafetySummarySchema,
}).strict().superRefine((value, context) => {
  if (value.digest !== processQuitRuntimeStateDigest(value.observedAt, value.summary)) {
    context.addIssue({ code: "custom", message: "Quit runtime state digest mismatch", path: ["digest"] });
  }
});

const processControlApprovalSchema = z.object({
  approvalId: z.uuid(),
  interactiveConfirmationId: z.uuid(),
  approvedCommandType: z.enum(["LAUNCH_NINJATRADER", "REQUEST_NINJATRADER_QUIT"]),
  issuedAt: isoTimestamp,
  expiresAt: isoTimestamp,
  intentHash: sha256,
}).strict();

const commandEnvelopeShape = {
  protocolVersion: z.literal(PROCESS_CONTROL_PROTOCOL_VERSION),
  commandId: z.uuid(),
  correlationId: z.uuid(),
  agentId: z.uuid(),
  idempotencyKey: z.string().regex(/^[A-Za-z0-9:._-]{16,200}$/),
  issuedAt: isoTimestamp,
  expiresAt: isoTimestamp,
  expectedProcessStateVersion: sha256,
  dryRun: z.literal(false),
  safetyPhase: z.literal("local_supervised_process_control"),
  approval: processControlApprovalSchema,
};

const launchNinjaTraderCommandSchema = z.object({
  ...commandEnvelopeShape,
  commandType: z.literal("LAUNCH_NINJATRADER"),
  payload: z.object({
    target: launchTargetSchema,
    reasonCode: z.literal("MANUAL_OPERATOR_LAUNCH"),
  }).strict(),
}).strict();

const requestNinjaTraderQuitCommandSchema = z.object({
  ...commandEnvelopeShape,
  commandType: z.literal("REQUEST_NINJATRADER_QUIT"),
  payload: z.object({
    target: quitTargetSchema,
    reasonCode: z.literal("MANUAL_OPERATOR_QUIT"),
    runtimeState: processQuitRuntimeStateSchema,
  }).strict(),
}).strict();

export const processControlCommandSchema = z.discriminatedUnion("commandType", [
  launchNinjaTraderCommandSchema,
  requestNinjaTraderQuitCommandSchema,
]).superRefine((value, context) => {
  const issuedAt = Date.parse(value.issuedAt);
  const expiresAt = Date.parse(value.expiresAt);
  if (expiresAt <= issuedAt) {
    context.addIssue({ code: "custom", message: "Command expiry must follow issue time", path: ["expiresAt"] });
  }
  if (expiresAt - issuedAt > MAX_PROCESS_CONTROL_TTL_MS) {
    context.addIssue({ code: "custom", message: "Process command lifetime exceeds 60 seconds", path: ["expiresAt"] });
  }

  const approvalIssuedAt = Date.parse(value.approval.issuedAt);
  const approvalExpiresAt = Date.parse(value.approval.expiresAt);
  if (approvalExpiresAt <= approvalIssuedAt) {
    context.addIssue({ code: "custom", message: "Approval expiry must follow issue time", path: ["approval", "expiresAt"] });
  }
  if (approvalExpiresAt - approvalIssuedAt > MAX_PROCESS_CONTROL_APPROVAL_TTL_MS) {
    context.addIssue({ code: "custom", message: "Process approval lifetime exceeds 60 seconds", path: ["approval", "expiresAt"] });
  }
  if (approvalIssuedAt > issuedAt || approvalExpiresAt < expiresAt) {
    context.addIssue({
      code: "custom",
      message: "Command must be issued and expire inside its approval window",
      path: ["approval"],
    });
  }
  if (value.approval.approvedCommandType !== value.commandType) {
    context.addIssue({ code: "custom", message: "Approval command type mismatch", path: ["approval", "approvedCommandType"] });
  }
  if (value.approval.intentHash !== processControlApprovalIntentHash(value)) {
    context.addIssue({ code: "custom", message: "Process approval intent hash mismatch", path: ["approval", "intentHash"] });
  }

  if (value.commandType === "REQUEST_NINJATRADER_QUIT") {
    const observedAt = Date.parse(value.payload.runtimeState.observedAt);
    if (observedAt > issuedAt) {
      context.addIssue({ code: "custom", message: "Quit runtime state cannot be observed after command issue", path: ["payload", "runtimeState", "observedAt"] });
    }
    if (issuedAt - observedAt > MAX_QUIT_RUNTIME_STATE_AGE_MS) {
      context.addIssue({ code: "custom", message: "Quit runtime state is older than 30 seconds", path: ["payload", "runtimeState", "observedAt"] });
    }
    const blockers = processQuitBlockers(value.payload.runtimeState.summary);
    if (blockers.length > 0) {
      context.addIssue({
        code: "custom",
        message: `Quit preflight is blocked: ${blockers.join(",")}`,
        path: ["payload", "runtimeState", "summary"],
      });
    }
  }
});

const deliveryIntegritySchema = z.object({
  canonicalization: z.literal(RUNTIME_CANONICALIZATION),
  payloadHash: sha256,
  semanticHash: sha256,
  envelopeHash: sha256,
}).strict();

export const deliveredProcessControlCommandSchema = z.object({
  command: processControlCommandSchema,
  integrity: deliveryIntegritySchema,
}).strict().superRefine((value, context) => {
  const payloadHash = hashCanonicalPayload(value.command.payload);
  const semanticHash = processControlSemanticHash(value.command);
  const envelopeHash = processControlDeliveryEnvelopeHash(value.command, payloadHash, semanticHash);
  if (value.integrity.payloadHash !== payloadHash) {
    context.addIssue({ code: "custom", message: "Process payload hash mismatch", path: ["integrity", "payloadHash"] });
  }
  if (value.integrity.semanticHash !== semanticHash) {
    context.addIssue({ code: "custom", message: "Process semantic hash mismatch", path: ["integrity", "semanticHash"] });
  }
  if (value.integrity.envelopeHash !== envelopeHash) {
    context.addIssue({ code: "custom", message: "Process envelope hash mismatch", path: ["integrity", "envelopeHash"] });
  }
});

export const processControlOutcomeStatusSchema = z.enum([
  "completed",
  "blocked",
  "attention_required",
  "indeterminate",
]);

const acknowledgementEnvelopeShape = {
  protocolVersion: z.literal(PROCESS_CONTROL_PROTOCOL_VERSION),
  acknowledgementId: z.uuid(),
  commandId: z.uuid(),
  correlationId: z.uuid(),
  agentId: z.uuid(),
  leaseId: z.uuid(),
  sequence: z.number().int().safe().positive(),
  status: processControlOutcomeStatusSchema,
  occurredAt: isoTimestamp,
};

const launchAcknowledgementSchema = z.object({
  ...acknowledgementEnvelopeShape,
  commandType: z.literal("LAUNCH_NINJATRADER"),
  outcomeCode: z.enum([
    "LAUNCHED",
    "ALREADY_RUNNING",
    "LAUNCHED_READINESS_UNCONFIRMED",
    "ALREADY_RUNNING_READINESS_UNCONFIRMED",
    "WAITING_FOR_LOGIN",
    "INSTALLATION_NOT_ALLOWLISTED",
    "TARGET_AMBIGUOUS",
    "PROCESS_STATE_CHANGED",
    "LAUNCH_RESULT_UNKNOWN",
  ]),
  evidence: z.object({
    target: launchTargetSchema,
    preProcessStateVersion: sha256,
    postProcessStateVersion: sha256.nullable(),
    postObservedAt: isoTimestamp.nullable(),
    preProcessState: z.enum(["stopped", "running", "unknown"]),
    postProcessState: z.enum(["stopped", "starting", "running", "waiting_for_login", "unknown"]),
    processRef: processRef.nullable(),
    matchedInstallationCount: z.number().int().min(0).max(2),
    actuatorInvoked: z.boolean(),
    mutationMayHaveOccurred: z.boolean(),
    retrySafe: z.boolean(),
    launchReadiness: launchReadinessObservationSchema.optional(),
  }).strict(),
  evidenceHash: sha256,
}).strict();

const quitAcknowledgementSchema = z.object({
  ...acknowledgementEnvelopeShape,
  commandType: z.literal("REQUEST_NINJATRADER_QUIT"),
  outcomeCode: z.enum([
    "GRACEFUL_QUIT_VERIFIED",
    "ALREADY_STOPPED",
    "PREFLIGHT_BLOCKED",
    "GRACEFUL_QUIT_NOT_CONFIRMED",
    "QUIT_RESULT_UNKNOWN",
  ]),
  evidence: z.object({
    target: quitTargetSchema,
    runtimeStateDigest: sha256,
    runtimeObservedAt: isoTimestamp,
    preflight: processQuitSafetySummarySchema,
    blockers: z.array(processQuitBlockerCodeSchema).max(11).refine(
      (values) => values.every((value, index) => index === 0 || values[index - 1] < value),
      "Quit blockers must be unique and sorted",
    ),
    preProcessStateVersion: sha256,
    postProcessStateVersion: sha256.nullable(),
    postObservedAt: isoTimestamp.nullable(),
    preProcessState: z.enum(["running", "stopped", "unknown"]),
    postProcessState: z.enum(["running", "stopping", "stopped", "unknown"]),
    matchedProcessCount: z.number().int().min(0).max(2),
    gracefulQuitRequested: z.boolean(),
    forceKillUsed: z.literal(false),
    cancelOrdersUsed: z.literal(false),
    flattenPositionsUsed: z.literal(false),
    disconnectConnectionsUsed: z.literal(false),
    mutationMayHaveOccurred: z.boolean(),
    retrySafe: z.boolean(),
  }).strict(),
  evidenceHash: sha256,
}).strict();

export const processControlAcknowledgementSchema = z.discriminatedUnion("commandType", [
  launchAcknowledgementSchema,
  quitAcknowledgementSchema,
]).superRefine((value, context) => {
  if (value.commandType === "LAUNCH_NINJATRADER") {
    const evidence = value.evidence;
    const hasPostStateVersion = evidence.postProcessStateVersion !== null;
    const hasPostObservation = evidence.postObservedAt !== null;
    if (hasPostStateVersion !== hasPostObservation) {
      context.addIssue({ code: "custom", message: "Launch post-state version and observation time must be present together" });
    }
    if (evidence.postObservedAt !== null && Date.parse(evidence.postObservedAt) > Date.parse(value.occurredAt)) {
      context.addIssue({ code: "custom", message: "Launch post-state observation cannot follow acknowledgement time" });
    }
    const expectedStatus = value.outcomeCode === "LAUNCHED" || value.outcomeCode === "ALREADY_RUNNING"
      ? "completed"
      : value.outcomeCode === "WAITING_FOR_LOGIN"
        || value.outcomeCode === "LAUNCHED_READINESS_UNCONFIRMED"
        || value.outcomeCode === "ALREADY_RUNNING_READINESS_UNCONFIRMED"
        ? "attention_required"
        : value.outcomeCode === "LAUNCH_RESULT_UNKNOWN"
          ? "indeterminate"
          : "blocked";
    if (value.status !== expectedStatus) {
      context.addIssue({ code: "custom", message: "Launch outcome code does not match its status" });
    }
    if (value.status === "completed" && value.outcomeCode === "LAUNCHED" && !(
      evidence.preProcessState === "stopped"
      && evidence.postProcessState === "running"
      && evidence.postProcessStateVersion !== null
      && evidence.postProcessStateVersion !== evidence.preProcessStateVersion
      && evidence.postObservedAt !== null
      && evidence.processRef !== null
      && evidence.matchedInstallationCount === 1
      && evidence.actuatorInvoked
      && evidence.mutationMayHaveOccurred
      && !evidence.retrySafe
      && isFreshAuthenticatedLaunchReadiness(
        evidence.launchReadiness,
        evidence.postObservedAt,
        value.occurredAt,
      )
    )) context.addIssue({ code: "custom", message: "Completed launch lacks verified running post-state" });
    if (value.status === "completed" && value.outcomeCode === "ALREADY_RUNNING" && !(
      evidence.preProcessState === "running"
      && evidence.postProcessState === "running"
      && evidence.postProcessStateVersion !== null
      && evidence.postProcessStateVersion === evidence.preProcessStateVersion
      && evidence.postObservedAt !== null
      && evidence.processRef !== null
      && evidence.matchedInstallationCount === 1
      && !evidence.actuatorInvoked
      && !evidence.mutationMayHaveOccurred
      && evidence.retrySafe
      && isFreshAuthenticatedLaunchReadiness(
        evidence.launchReadiness,
        evidence.postObservedAt,
        value.occurredAt,
      )
    )) context.addIssue({ code: "custom", message: "Already-running completion must be a verified no-op" });
    if (value.status === "attention_required" && value.outcomeCode === "WAITING_FOR_LOGIN" && !(
      evidence.postProcessState === "waiting_for_login"
      && evidence.postProcessStateVersion !== null
      && evidence.postProcessStateVersion !== evidence.preProcessStateVersion
      && evidence.postObservedAt !== null
      && evidence.processRef !== null
      && evidence.matchedInstallationCount === 1
      && evidence.actuatorInvoked
      && evidence.mutationMayHaveOccurred
      && !evidence.retrySafe
      && evidence.launchReadiness?.state === "not_ready"
      && evidence.launchReadiness.reasonCode === "LOGIN_REQUIRED"
      && Date.parse(evidence.launchReadiness.observedAt) >= Date.parse(evidence.postObservedAt)
      && Date.parse(evidence.launchReadiness.observedAt) <= Date.parse(value.occurredAt)
      && Date.parse(value.occurredAt) - Date.parse(evidence.launchReadiness.observedAt)
        <= MAX_LAUNCH_READINESS_AGE_MS
    )) context.addIssue({ code: "custom", message: "Waiting-for-login outcome lacks verified process evidence" });
    if (value.status === "attention_required" && value.outcomeCode === "ALREADY_RUNNING_READINESS_UNCONFIRMED" && !(
      evidence.preProcessState === "running"
      && evidence.postProcessState === "running"
      && evidence.postProcessStateVersion !== null
      && evidence.postProcessStateVersion === evidence.preProcessStateVersion
      && evidence.postObservedAt !== null
      && evidence.processRef !== null
      && evidence.matchedInstallationCount === 1
      && !evidence.actuatorInvoked
      && !evidence.mutationMayHaveOccurred
      && evidence.retrySafe
      && evidence.launchReadiness !== undefined
      && !isFreshAuthenticatedLaunchReadiness(
        evidence.launchReadiness,
        evidence.postObservedAt,
        value.occurredAt,
      )
    )) context.addIssue({ code: "custom", message: "Unconfirmed already-running readiness must be a verified no-op" });
    if (value.status === "attention_required" && value.outcomeCode === "LAUNCHED_READINESS_UNCONFIRMED" && !(
      evidence.preProcessState === "stopped"
      && (evidence.postProcessState === "running" || evidence.postProcessState === "waiting_for_login")
      && evidence.postProcessStateVersion !== null
      && evidence.postProcessStateVersion !== evidence.preProcessStateVersion
      && evidence.postObservedAt !== null
      && evidence.processRef !== null
      && evidence.matchedInstallationCount === 1
      && evidence.actuatorInvoked
      && evidence.mutationMayHaveOccurred
      && !evidence.retrySafe
      && evidence.launchReadiness !== undefined
      && !isFreshAuthenticatedLaunchReadiness(
        evidence.launchReadiness,
        evidence.postObservedAt,
        value.occurredAt,
      )
    )) context.addIssue({ code: "custom", message: "Unconfirmed launched readiness lacks verified process mutation evidence" });
    if (value.status === "indeterminate" && !(
      value.outcomeCode === "LAUNCH_RESULT_UNKNOWN"
      && evidence.matchedInstallationCount === 1
      && evidence.actuatorInvoked
      && evidence.mutationMayHaveOccurred
      && !evidence.retrySafe
    )) context.addIssue({ code: "custom", message: "Indeterminate launch cannot be retried automatically" });
    if (value.status === "blocked") {
      const matchedCountIsValid = value.outcomeCode === "INSTALLATION_NOT_ALLOWLISTED"
        ? evidence.matchedInstallationCount === 0 && evidence.processRef === null
        : value.outcomeCode === "TARGET_AMBIGUOUS"
          ? evidence.matchedInstallationCount === 2 && evidence.processRef === null
          : evidence.matchedInstallationCount === 1;
      if (
        evidence.postProcessStateVersion !== null
        || evidence.postObservedAt !== null
        || evidence.actuatorInvoked
        || evidence.mutationMayHaveOccurred
        || evidence.retrySafe
        || !matchedCountIsValid
      ) {
        context.addIssue({ code: "custom", message: "Blocked launch must carry exact no-actuation evidence" });
      }
    }
  } else {
    const evidence = value.evidence;
    const observedBlockers = processQuitBlockers(evidence.preflight);
    if (hashCanonicalPayload({ observedAt: evidence.runtimeObservedAt, summary: evidence.preflight }) !== evidence.runtimeStateDigest) {
      context.addIssue({ code: "custom", message: "Quit acknowledgement runtime state digest mismatch" });
    }
    if (observedBlockers.some((blocker) => !evidence.blockers.includes(blocker))) {
      context.addIssue({ code: "custom", message: "Quit acknowledgement omits a preflight blocker" });
    }
    if (evidence.gracefulQuitRequested && evidence.matchedProcessCount !== 1) {
      context.addIssue({ code: "custom", message: "Quit actuation requires one exact process target" });
    }
    if (evidence.postObservedAt !== null && (
      Date.parse(evidence.postObservedAt) < Date.parse(evidence.runtimeObservedAt)
      || Date.parse(evidence.postObservedAt) > Date.parse(value.occurredAt)
    )) context.addIssue({ code: "custom", message: "Quit post-state observation time is outside the evidence window" });
    if (value.status === "completed") {
      const verifiedPostState = evidence.postProcessStateVersion !== null && evidence.postObservedAt !== null;
      const gracefulCompletion = value.outcomeCode === "GRACEFUL_QUIT_VERIFIED"
        && evidence.blockers.length === 0
        && evidence.preProcessState === "running"
        && evidence.postProcessState === "stopped"
        && evidence.matchedProcessCount === 1
        && evidence.gracefulQuitRequested
        && evidence.mutationMayHaveOccurred
        && !evidence.retrySafe
        && verifiedPostState;
      const postStateChanged = evidence.postProcessStateVersion !== evidence.preProcessStateVersion;
      const stoppedNoOp = value.outcomeCode === "ALREADY_STOPPED"
        && evidence.blockers.length === 0
        && evidence.preProcessState === "stopped"
        && evidence.postProcessState === "stopped"
        && evidence.matchedProcessCount === 1
        && !evidence.gracefulQuitRequested
        && !evidence.mutationMayHaveOccurred
        && evidence.retrySafe
        && verifiedPostState;
      if (!(gracefulCompletion && postStateChanged) && !stoppedNoOp) {
        context.addIssue({ code: "custom", message: "Completed quit lacks verified stopped post-state" });
      }
    }
    if (value.status === "blocked" && !(
      value.outcomeCode === "PREFLIGHT_BLOCKED"
      && evidence.blockers.length > 0
      && !evidence.gracefulQuitRequested
      && !evidence.mutationMayHaveOccurred
    )) context.addIssue({ code: "custom", message: "Blocked quit must not invoke process control" });
    if (value.status === "attention_required" && !(
      value.outcomeCode === "GRACEFUL_QUIT_NOT_CONFIRMED"
      && evidence.blockers.length === 0
      && evidence.gracefulQuitRequested
      && evidence.postProcessState !== "stopped"
      && evidence.mutationMayHaveOccurred
      && !evidence.retrySafe
    )) context.addIssue({ code: "custom", message: "Unconfirmed graceful quit requires operator attention" });
    if (value.status === "indeterminate" && !(
      value.outcomeCode === "QUIT_RESULT_UNKNOWN"
      && evidence.blockers.length === 0
      && evidence.gracefulQuitRequested
      && evidence.mutationMayHaveOccurred
      && !evidence.retrySafe
    )) context.addIssue({ code: "custom", message: "Indeterminate quit cannot be retried automatically" });
  }
});

export type ProcessControlCommand = z.infer<typeof processControlCommandSchema>;
export type DeliveredProcessControlCommand = z.infer<typeof deliveredProcessControlCommandSchema>;
export type ProcessControlAcknowledgement = z.infer<typeof processControlAcknowledgementSchema>;

export function processQuitRuntimeStateDigest(
  observedAt: string,
  summary: ProcessQuitSafetySummary,
): string {
  return hashCanonicalPayload({ observedAt, summary });
}

export function processControlApprovalIntentHash(command: ProcessControlCommand): string {
  return hashCanonicalPayload(command.commandType === "LAUNCH_NINJATRADER"
    ? { commandType: command.commandType, target: command.payload.target }
    : {
        commandType: command.commandType,
        target: command.payload.target,
        runtimeStateDigest: command.payload.runtimeState.digest,
      });
}

export function processControlSemanticHash(command: ProcessControlCommand): string {
  return hashCanonicalPayload({
    protocolVersion: command.protocolVersion,
    commandType: command.commandType,
    agentId: command.agentId,
    expectedProcessStateVersion: command.expectedProcessStateVersion,
    dryRun: command.dryRun,
    safetyPhase: command.safetyPhase,
    approval: command.approval,
    payload: command.payload,
  });
}

export function processControlDeliveryEnvelopeHash(
  command: ProcessControlCommand,
  payloadHash = hashCanonicalPayload(command.payload),
  semanticHash = processControlSemanticHash(command),
): string {
  return hashCanonicalPayload({
    command,
    integrity: {
      canonicalization: RUNTIME_CANONICALIZATION,
      payloadHash,
      semanticHash,
    },
  });
}

export function createDeliveredProcessControlCommand(input: ProcessControlCommand): DeliveredProcessControlCommand {
  const command = processControlCommandSchema.parse(input);
  const payloadHash = hashCanonicalPayload(command.payload);
  const semanticHash = processControlSemanticHash(command);
  return deliveredProcessControlCommandSchema.parse({
    command,
    integrity: {
      canonicalization: RUNTIME_CANONICALIZATION,
      payloadHash,
      semanticHash,
      envelopeHash: processControlDeliveryEnvelopeHash(command, payloadHash, semanticHash),
    },
  });
}

export function parseDeliveredProcessControlCommand(input: unknown): DeliveredProcessControlCommand {
  return deliveredProcessControlCommandSchema.parse(input);
}

export function parseProcessControlAcknowledgement(input: unknown): ProcessControlAcknowledgement {
  const acknowledgement = processControlAcknowledgementSchema.parse(input);
  if (hashCanonicalPayload(acknowledgement.evidence) !== acknowledgement.evidenceHash) {
    throw new Error("Process acknowledgement evidence hash does not match its contents");
  }
  return acknowledgement;
}
