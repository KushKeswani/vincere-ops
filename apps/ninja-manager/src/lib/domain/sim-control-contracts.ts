import { z } from "zod";

import {
  hashCanonicalPayload,
  RUNTIME_CANONICALIZATION,
} from "@/lib/domain/runtime-contracts";

export const SIM_CONTROL_PROTOCOL_VERSION = "sim-control/1.0" as const;
export const MAX_SIM_CONTROL_TTL_MS = 60_000;

const sha256 = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const isoTimestamp = z.iso.datetime({ offset: true });
const opaqueAccountRef = z.string().regex(/^acct_[a-z0-9]{16,64}$/);
const opaqueStrategyRef = z.string().regex(/^strat_[a-z0-9]{16,64}$/);
const scheduleOccurrenceKey = z.string().regex(/^schedule_occurrence:sha256:[a-f0-9]{64}$/);

export const simStrategyControlPayloadSchema = z.object({
  accountRef: opaqueAccountRef,
  strategyRef: opaqueStrategyRef,
  expectedAccountType: z.literal("simulation"),
  expectedConnectionStatus: z.literal("connected"),
  expectedEnabled: z.boolean(),
  desiredEnabled: z.boolean(),
  expectedRuntimeState: z.enum(["disabled", "waiting_sync", "running", "error", "unknown"]),
  reasonCode: z.enum([
    "OPERATOR_IMMEDIATE",
    "SCHEDULED_WEEKLY_AUTHORITY",
    "EMERGENCY_SIM_DISABLE",
  ]),
  scheduleOccurrenceKey: scheduleOccurrenceKey.nullable(),
  weeklyAuthorityId: z.uuid().nullable(),
  weeklyAuthorityHash: sha256.nullable(),
  interactiveConfirmationId: z.uuid().nullable(),
}).strict().superRefine((value, context) => {
  if (value.expectedEnabled === value.desiredEnabled) {
    context.addIssue({
      code: "custom",
      message: "Expected and desired strategy states must differ",
      path: ["desiredEnabled"],
    });
  }
  const scheduled = value.reasonCode === "SCHEDULED_WEEKLY_AUTHORITY";
  const scheduleFields = [value.scheduleOccurrenceKey, value.weeklyAuthorityId, value.weeklyAuthorityHash];
  if (scheduled && scheduleFields.some((field) => field === null)) {
    context.addIssue({ code: "custom", message: "Scheduled control requires exact weekly authority and occurrence evidence" });
  }
  if (!scheduled && scheduleFields.some((field) => field !== null)) {
    context.addIssue({ code: "custom", message: "Only scheduled weekly authority may carry schedule evidence" });
  }
  if (scheduled && value.interactiveConfirmationId !== null) {
    context.addIssue({ code: "custom", message: "Scheduled weekly authority must not claim a daily interactive confirmation", path: ["interactiveConfirmationId"] });
  }
  if (!scheduled && value.interactiveConfirmationId === null) {
    context.addIssue({ code: "custom", message: "Manual SIM control requires an interactive confirmation", path: ["interactiveConfirmationId"] });
  }
  if (value.reasonCode === "EMERGENCY_SIM_DISABLE" && value.desiredEnabled) {
    context.addIssue({
      code: "custom",
      message: "Emergency SIM control can only disable an exact strategy",
      path: ["desiredEnabled"],
    });
  }
});

export const simStrategyControlCommandSchema = z.object({
  protocolVersion: z.literal(SIM_CONTROL_PROTOCOL_VERSION),
  commandType: z.literal("SET_SIM_STRATEGY_GRID_ENABLED"),
  commandId: z.uuid(),
  correlationId: z.uuid(),
  agentId: z.uuid(),
  idempotencyKey: z.string().regex(/^[A-Za-z0-9:._-]{16,200}$/),
  issuedAt: isoTimestamp,
  expiresAt: isoTimestamp,
  expectedStateVersion: sha256,
  approvalId: z.uuid(),
  dryRun: z.literal(false),
  safetyPhase: z.literal("supervised_sim_only"),
  actuator: z.literal("ninjatrader_control_center_uia"),
  payload: simStrategyControlPayloadSchema,
}).strict().superRefine((value, context) => {
  const issuedAt = Date.parse(value.issuedAt);
  const expiresAt = Date.parse(value.expiresAt);
  if (expiresAt <= issuedAt) {
    context.addIssue({ code: "custom", message: "Command expiry must follow issue time", path: ["expiresAt"] });
  }
  if (expiresAt - issuedAt > MAX_SIM_CONTROL_TTL_MS) {
    context.addIssue({
      code: "custom",
      message: "Supervised SIM command lifetime exceeds 60 seconds",
      path: ["expiresAt"],
    });
  }
});

const deliveryIntegritySchema = z.object({
  canonicalization: z.literal(RUNTIME_CANONICALIZATION),
  payloadHash: sha256,
  semanticHash: sha256,
  envelopeHash: sha256,
}).strict();

export const deliveredSimStrategyControlCommandSchema = z.object({
  command: simStrategyControlCommandSchema,
  integrity: deliveryIntegritySchema,
}).strict().superRefine((value, context) => {
  const payloadHash = hashCanonicalPayload(value.command.payload);
  const semanticHash = simControlSemanticHash(value.command);
  const envelopeHash = simControlDeliveryEnvelopeHash(value.command, payloadHash, semanticHash);
  if (value.integrity.payloadHash !== payloadHash) {
    context.addIssue({ code: "custom", message: "Control payload hash mismatch", path: ["integrity", "payloadHash"] });
  }
  if (value.integrity.semanticHash !== semanticHash) {
    context.addIssue({ code: "custom", message: "Control semantic hash mismatch", path: ["integrity", "semanticHash"] });
  }
  if (value.integrity.envelopeHash !== envelopeHash) {
    context.addIssue({ code: "custom", message: "Control envelope hash mismatch", path: ["integrity", "envelopeHash"] });
  }
});

export const simControlAcknowledgementStatusSchema = z.enum([
  "accepted",
  "rejected",
  "started",
  "completed",
  "failed",
  "indeterminate",
]);

export const simControlAcknowledgementEvidenceSchema = z.object({
  actuator: z.literal("ninjatrader_control_center_uia"),
  preStateVersion: sha256,
  postStateEventId: z.uuid().nullable(),
  postStateVersion: sha256.nullable(),
  accountRef: opaqueAccountRef,
  strategyRef: opaqueStrategyRef,
  desiredEnabled: z.boolean(),
  observedEnabled: z.boolean().nullable(),
  observedSync: z.boolean().nullable(),
  observedRuntimeState: z.enum(["disabled", "waiting_sync", "running", "error", "unknown"]).nullable(),
  matchedRowCount: z.number().int().min(0).max(2),
  changedRowCount: z.number().int().min(0).max(1),
  mutationMayHaveOccurred: z.boolean(),
  retrySafe: z.boolean(),
  errorCode: z.enum([
    "NONE",
    "ADDON_OFFLINE",
    "DESKTOP_NOT_INTERACTIVE",
    "TARGET_NOT_FOUND",
    "TARGET_AMBIGUOUS",
    "STATE_CHANGED",
    "TOGGLE_PATTERN_UNAVAILABLE",
    "ACTUATOR_TIMEOUT",
    "POST_STATE_MISMATCH",
    "INTERNAL_ERROR",
  ]),
  recoveryCode: z.enum([
    "NONE",
    "REFRESH_ONLY",
    "RECONCILE_MANUALLY",
    "NEW_APPROVAL_REQUIRED",
  ]),
}).strict();

export const simControlAcknowledgementSchema = z.object({
  protocolVersion: z.literal(SIM_CONTROL_PROTOCOL_VERSION),
  acknowledgementId: z.uuid(),
  commandId: z.uuid(),
  correlationId: z.uuid(),
  agentId: z.uuid(),
  leaseId: z.uuid(),
  sequence: z.number().int().safe().positive(),
  status: simControlAcknowledgementStatusSchema,
  evidence: simControlAcknowledgementEvidenceSchema,
  evidenceHash: sha256,
  occurredAt: isoTimestamp,
}).strict().superRefine((value, context) => {
  const evidence = value.evidence;
  if (value.status === "completed") {
    if (
      evidence.errorCode !== "NONE"
      || evidence.matchedRowCount !== 1
      || evidence.observedEnabled !== evidence.desiredEnabled
      || evidence.postStateEventId === null
      || evidence.postStateVersion === null
    ) {
      context.addIssue({ code: "custom", message: "Completed control acknowledgement lacks verified post-state" });
    }
    if (evidence.desiredEnabled && (
      evidence.observedSync !== true
      || evidence.observedRuntimeState !== "running"
    )) {
      context.addIssue({ code: "custom", message: "Enabled completion requires running, synchronized evidence" });
    }
    if (!evidence.desiredEnabled && evidence.observedRuntimeState !== "disabled") {
      context.addIssue({ code: "custom", message: "Disabled completion requires disabled post-state evidence" });
    }
  }
  if (value.status === "indeterminate" && (!evidence.mutationMayHaveOccurred || evidence.retrySafe)) {
    context.addIssue({ code: "custom", message: "Indeterminate control cannot be retried automatically" });
  }
  if (value.status === "started" && (value.sequence !== 1 || evidence.postStateEventId !== null || evidence.postStateVersion !== null)) {
    context.addIssue({ code: "custom", message: "Actuator start must be sequence 1 without post-state evidence" });
  }
  if (value.status !== "started" && value.sequence !== 2) {
    context.addIssue({ code: "custom", message: "A terminal SIM acknowledgement must be sequence 2" });
  }
});

export type SimStrategyControlCommand = z.infer<typeof simStrategyControlCommandSchema>;
export type DeliveredSimStrategyControlCommand = z.infer<typeof deliveredSimStrategyControlCommandSchema>;
export type SimControlAcknowledgement = z.infer<typeof simControlAcknowledgementSchema>;

export function simControlSemanticHash(command: SimStrategyControlCommand): string {
  return hashCanonicalPayload({
    protocolVersion: command.protocolVersion,
    commandType: command.commandType,
    agentId: command.agentId,
    expectedStateVersion: command.expectedStateVersion,
    approvalId: command.approvalId,
    dryRun: command.dryRun,
    safetyPhase: command.safetyPhase,
    actuator: command.actuator,
    payload: command.payload,
  });
}

export function simControlDeliveryEnvelopeHash(
  command: SimStrategyControlCommand,
  payloadHash = hashCanonicalPayload(command.payload),
  semanticHash = simControlSemanticHash(command),
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

export function createDeliveredSimStrategyControlCommand(
  input: SimStrategyControlCommand,
): DeliveredSimStrategyControlCommand {
  const command = simStrategyControlCommandSchema.parse(input);
  const payloadHash = hashCanonicalPayload(command.payload);
  const semanticHash = simControlSemanticHash(command);
  return deliveredSimStrategyControlCommandSchema.parse({
    command,
    integrity: {
      canonicalization: RUNTIME_CANONICALIZATION,
      payloadHash,
      semanticHash,
      envelopeHash: simControlDeliveryEnvelopeHash(command, payloadHash, semanticHash),
    },
  });
}

export function parseDeliveredSimStrategyControlCommand(input: unknown): DeliveredSimStrategyControlCommand {
  return deliveredSimStrategyControlCommandSchema.parse(input);
}

export function parseSimControlAcknowledgement(input: unknown): SimControlAcknowledgement {
  const acknowledgement = simControlAcknowledgementSchema.parse(input);
  if (hashCanonicalPayload(acknowledgement.evidence) !== acknowledgement.evidenceHash) {
    throw new Error("Control acknowledgement evidence hash does not match its contents");
  }
  return acknowledgement;
}
