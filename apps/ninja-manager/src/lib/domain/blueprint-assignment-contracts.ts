import { z } from "zod";

import {
  BLUEPRINT_MAX_ASSIGNMENTS,
  blueprintAssignmentPreviewSchema,
  type BlueprintAssignmentPreview,
  type BlueprintPreviewResult,
} from "./blueprint-import-contracts";
import { hashCanonicalPayload } from "./canonical-json";

export const BLUEPRINT_ASSIGNMENT_VERSION = "blueprint-assignment/1.0" as const;
export const BLUEPRINT_PREVIEW_EXPIRY_MS = 30 * 60 * 1_000;
export const BLUEPRINT_RUNTIME_MAX_AGE_MS = 30 * 1_000;
export const BLUEPRINT_DECLARED_AGE_TOLERANCE_MS = 1_000;

const sha256Schema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const idempotencyKeySchema = z.string().min(16).max(200).regex(/^[A-Za-z0-9:._-]+$/);
const opaqueAccountRefSchema = z.string().regex(/^acct_[a-z0-9]{16,64}$/);
const opaqueStrategyRefSchema = z.string().regex(/^strat_[a-z0-9]{16,64}$/);
const runtimeEventRefSchema = z.uuid();
const isoTimestampSchema = z.iso.datetime({ offset: true });

export const blueprintPreviewIdSchema = z.uuid();
export const blueprintAssignmentRevisionRefSchema = z.string().regex(/^assignment_rev_[a-z0-9]{16,64}$/);

export const blueprintStageInputSchema = z.object({
  idempotencyKey: idempotencyKeySchema,
}).strict();

export const blueprintAccountMappingSchema = z.object({
  accountLabel: blueprintAssignmentPreviewSchema.shape.accountLabel,
  accountRef: opaqueAccountRefSchema,
}).strict();

export const blueprintCommitInputSchema = z.object({
  previewId: blueprintPreviewIdSchema,
  agentId: z.uuid(),
  idempotencyKey: idempotencyKeySchema,
  mappings: z.array(blueprintAccountMappingSchema).min(1).max(500),
}).strict().superRefine((value, context) => {
  const labels = new Set<string>();
  const accountRefs = new Set<string>();
  value.mappings.forEach((mapping, index) => {
    if (labels.has(mapping.accountLabel)) {
      context.addIssue({ code: "custom", message: "Logical account mappings must be unique", path: ["mappings", index, "accountLabel"] });
    }
    if (accountRefs.has(mapping.accountRef)) {
      context.addIssue({ code: "custom", message: "Runtime accounts may be mapped only once", path: ["mappings", index, "accountRef"] });
    }
    labels.add(mapping.accountLabel);
    accountRefs.add(mapping.accountRef);
  });
});

export const blueprintApproveInputSchema = z.object({
  revisionRef: blueprintAssignmentRevisionRefSchema,
  expectedVersion: z.number().int().positive().max(2_147_483_647),
  idempotencyKey: idempotencyKeySchema,
}).strict();

export const blueprintStagedPreviewSchema = z.object({
  version: z.literal(BLUEPRINT_ASSIGNMENT_VERSION),
  previewId: blueprintPreviewIdSchema,
  stagedAt: isoTimestampSchema,
  expiresAt: isoTimestampSchema,
  expired: z.boolean(),
  dataRowCount: z.number().int().min(0).max(500),
  assignmentCount: z.number().int().min(1).max(BLUEPRINT_MAX_ASSIGNMENTS),
  uniqueAccountCount: z.number().int().min(1).max(500),
  assignments: z.array(blueprintAssignmentPreviewSchema).min(1).max(BLUEPRINT_MAX_ASSIGNMENTS),
}).strict().superRefine((value, context) => {
  if (value.assignmentCount !== value.assignments.length) {
    context.addIssue({ code: "custom", message: "Assignment count does not match staged assignments", path: ["assignmentCount"] });
  }
  if (value.uniqueAccountCount !== new Set(value.assignments.map((entry) => entry.accountLabel)).size) {
    context.addIssue({ code: "custom", message: "Unique account count does not match staged assignments", path: ["uniqueAccountCount"] });
  }
});

export const blueprintBoundAccountSchema = z.object({
  accountLabel: blueprintAssignmentPreviewSchema.shape.accountLabel,
  accountRef: opaqueAccountRefSchema,
  maskedIdentifier: z.string().regex(/^\*{4,16}[A-Za-z0-9]{2,8}$/),
  displayLabel: z.string().min(1).max(80),
}).strict();

export const blueprintBoundAssignmentSchema = blueprintAssignmentPreviewSchema.extend({
  accountRef: opaqueAccountRefSchema,
  strategyRef: opaqueStrategyRefSchema,
}).strict();

export const blueprintAssignmentRevisionSchema = z.object({
  version: z.literal(BLUEPRINT_ASSIGNMENT_VERSION),
  revisionRef: blueprintAssignmentRevisionRefSchema,
  agentId: z.uuid(),
  status: z.enum(["draft", "approved"]),
  stateVersion: z.number().int().min(1).max(2),
  recordedAt: isoTimestampSchema,
  source: z.object({
    eventId: runtimeEventRefSchema,
    sequence: z.number().int().positive(),
    asOf: isoTimestampSchema,
    occurredAt: isoTimestampSchema,
    receivedAt: isoTimestampSchema,
  }).strict(),
  accounts: z.array(blueprintBoundAccountSchema).min(1).max(500),
  assignments: z.array(blueprintBoundAssignmentSchema).min(1).max(BLUEPRINT_MAX_ASSIGNMENTS),
}).strict().superRefine((value, context) => {
  if ((value.status === "draft" && value.stateVersion !== 1) || (value.status === "approved" && value.stateVersion !== 2)) {
    context.addIssue({ code: "custom", message: "Revision state version and status disagree", path: ["stateVersion"] });
  }
  const accountLabels = new Set(value.accounts.map((entry) => entry.accountLabel));
  const accountRefs = new Set(value.accounts.map((entry) => entry.accountRef));
  if (accountLabels.size !== value.accounts.length || accountRefs.size !== value.accounts.length) {
    context.addIssue({ code: "custom", message: "Bound accounts must be one-to-one", path: ["accounts"] });
  }
  value.assignments.forEach((assignment, index) => {
    const account = value.accounts.find((entry) => entry.accountLabel === assignment.accountLabel);
    if (!account || account.accountRef !== assignment.accountRef) {
      context.addIssue({ code: "custom", message: "Assignment account binding is inconsistent", path: ["assignments", index, "accountRef"] });
    }
  });
});

export type BlueprintStageInput = z.infer<typeof blueprintStageInputSchema>;
export type BlueprintAccountMapping = z.infer<typeof blueprintAccountMappingSchema>;
export type BlueprintCommitInput = z.infer<typeof blueprintCommitInputSchema>;
export type BlueprintApproveInput = z.infer<typeof blueprintApproveInputSchema>;
export type BlueprintStagedPreview = z.infer<typeof blueprintStagedPreviewSchema>;
export type BlueprintAssignmentRevision = z.infer<typeof blueprintAssignmentRevisionSchema>;

export function blueprintStageRequestHash(preview: BlueprintPreviewResult): string {
  return hashCanonicalPayload({
    version: BLUEPRINT_ASSIGNMENT_VERSION,
    sourceWorkbookHash: preview.source.workbookSha256,
    canonicalPreviewHash: preview.canonicalPreviewHash,
    dataRowCount: preview.dataRowCount,
    assignments: preview.assignments,
  });
}

export function blueprintStageContentHash(input: {
  previewId: string;
  sourceWorkbookHash: string;
  canonicalPreviewHash: string;
  dataRowCount: number;
  assignments: readonly BlueprintAssignmentPreview[];
  stagedAt: string;
  expiresAt: string;
  createdBy: string;
  idempotencyKey: string;
  requestHash: string;
}): string {
  return hashCanonicalPayload({ version: BLUEPRINT_ASSIGNMENT_VERSION, ...input });
}

export function blueprintCommitRequestHash(input: BlueprintCommitInput): string {
  return hashCanonicalPayload({
    version: BLUEPRINT_ASSIGNMENT_VERSION,
    previewId: input.previewId,
    agentId: input.agentId,
    mappings: [...input.mappings].sort((left, right) => left.accountLabel.localeCompare(right.accountLabel)),
  });
}

export function blueprintRevisionContentHash(input: {
  revisionRef: string;
  previewId: string;
  agentId: string;
  source: { eventId: string; sequence: number; stateDigest: string; asOf: string; occurredAt: string; receivedAt: string };
  committedAt: string;
  createdBy: string;
  idempotencyKey: string;
  requestHash: string;
  accounts: readonly { accountLabel: string; accountRef: string; identifierFingerprint: string; maskedIdentifier: string; displayLabel: string; runtimeBindingHash: string }[];
  assignments: readonly (BlueprintAssignmentPreview & { accountRef: string; strategyRef: string; runtimeBindingHash: string })[];
}): string {
  return hashCanonicalPayload({ version: BLUEPRINT_ASSIGNMENT_VERSION, ...input });
}

export function blueprintStateRequestHash(input: BlueprintApproveInput): string {
  return hashCanonicalPayload({
    version: BLUEPRINT_ASSIGNMENT_VERSION,
    revisionRef: input.revisionRef,
    expectedVersion: input.expectedVersion,
  });
}

export function blueprintRevisionStateContentHash(input: {
  revisionRef: string;
  stateVersion: number;
  status: "draft" | "approved";
  previousStateId: string | null;
  source: { eventId: string; sequence: number; stateDigest: string; asOf: string; occurredAt: string; receivedAt: string };
  recordedAt: string;
  actorUserId: string;
  idempotencyKey: string;
  requestHash: string;
}): string {
  return hashCanonicalPayload({ version: BLUEPRINT_ASSIGNMENT_VERSION, ...input });
}

export const blueprintStoredHashSchema = sha256Schema;
