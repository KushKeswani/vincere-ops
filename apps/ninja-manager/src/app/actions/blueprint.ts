"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireUser } from "@/lib/auth/session";
import { parseXlsxBlueprint } from "@/lib/blueprints/xlsx-blueprint-parser";
import { toSafeBlueprintRevisionSummary, type SafeBlueprintRevisionSummary } from "@/components/forms/blueprint-assignment-view-model";
import { requireDeploymentCapability } from "@/lib/deployment/server";
import { blueprintAccountMappingSchema } from "@/lib/domain/blueprint-assignment-contracts";
import {
  BLUEPRINT_MAX_BYTES,
  type BlueprintIssue,
  type BlueprintPreviewResult,
} from "@/lib/domain/blueprint-import-contracts";
import { RuntimeServiceError } from "@/lib/domain/runtime-errors";
import { getBlueprintAssignmentRepository } from "@/lib/repositories/blueprint-assignment-repository";

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const SAFE_XLSX_BASENAME = /^(?=.{1,128}$)[^\\/\u0000-\u001f\u007f]+\.xlsx$/i;
const requestIdSchema = z.uuid();
const mappingPayloadSchema = z.array(blueprintAccountMappingSchema).min(1).max(500);

export type BlueprintPreviewActionIssue = Pick<BlueprintIssue, "code" | "message" | "row" | "column">;

export interface BlueprintPreviewActionAssignment {
  period: "PERIOD_1" | "PERIOD_2";
  accountLabel: string;
  propFirm: string;
  stackLevel: number;
  strategy: string;
  instrument: string;
  sourceRow: number;
  sourceSlot: number;
}

export interface BlueprintPreviewActionResult {
  valid: boolean;
  previewId: string | null;
  expiresAt: string | null;
  mappingRequestId: string | null;
  sourceFilename: string;
  sheetName: string;
  dataRowCount: number;
  assignmentCount: number;
  logicalAccountCount: number;
  periodCount: number;
  assignments: BlueprintPreviewActionAssignment[];
  warnings: BlueprintPreviewActionIssue[];
  errors: BlueprintPreviewActionIssue[];
}

export interface BlueprintPreviewActionState {
  status: "idle" | "error" | "preview";
  message: string;
  preview: BlueprintPreviewActionResult | null;
  nextRequestId: string;
}

export interface BlueprintMappingActionState {
  status: "idle" | "error" | "draft";
  message: string;
  revision: SafeBlueprintRevisionSummary | null;
  approvalRequestId: string;
}

export interface BlueprintApprovalActionState {
  status: "idle" | "error" | "approved";
  message: string;
  revision: SafeBlueprintRevisionSummary | null;
  nextRequestId: string;
}

function previewErrorState(message: string): BlueprintPreviewActionState {
  return { status: "error", message, preview: null, nextRequestId: randomUUID() };
}

function mappingErrorState(message: string): BlueprintMappingActionState {
  return { status: "error", message, revision: null, approvalRequestId: randomUUID() };
}

function approvalErrorState(message: string): BlueprintApprovalActionState {
  return { status: "error", message, revision: null, nextRequestId: randomUUID() };
}

function exactFields(formData: FormData, expected: readonly string[]): Map<string, FormDataEntryValue> | null {
  const entries = Array.from(formData.entries()).filter(([key]) => !key.startsWith("$ACTION_"));
  if (entries.length !== expected.length) return null;
  const allowed = new Set(expected);
  const values = new Map<string, FormDataEntryValue>();
  for (const [key, value] of entries) {
    if (!allowed.has(key) || values.has(key)) return null;
    values.set(key, value);
  }
  return expected.every((key) => values.has(key)) ? values : null;
}

function stringField(fields: Map<string, FormDataEntryValue>, key: string): string | null {
  const value = fields.get(key);
  return typeof value === "string" ? value : null;
}

async function requireLocalClient() {
  const user = await requireUser(["client"]);
  requireDeploymentCapability("transport.local");
  return user;
}

function toActionResult(
  result: BlueprintPreviewResult,
  staged?: { previewId: string; expiresAt: string },
): BlueprintPreviewActionResult {
  return {
    valid: result.valid,
    previewId: staged?.previewId ?? null,
    expiresAt: staged?.expiresAt ?? null,
    mappingRequestId: staged ? randomUUID() : null,
    sourceFilename: result.source.filename,
    sheetName: result.source.sheetName,
    dataRowCount: result.dataRowCount,
    assignmentCount: result.assignmentCount,
    logicalAccountCount: new Set(result.assignments.map((assignment) => assignment.accountLabel)).size,
    periodCount: new Set(result.assignments.map((assignment) => assignment.period)).size,
    assignments: result.assignments.map((assignment) => ({ ...assignment })),
    warnings: result.warnings.map(({ code, message, row, column }) => ({ code, message, row, column })),
    errors: result.errors.map(({ code, message, row, column }) => ({ code, message, row, column })),
  };
}

function safeMappingFailure(error: unknown): string {
  if (error instanceof RuntimeServiceError && error.code === "FORBIDDEN") {
    return "This staged preview or local agent is not available to the current client.";
  }
  return "The draft was not saved. The staged preview expired, the exact mapping is incomplete, or fresh authoritative SIM account and strategy evidence changed. Refresh Runtime v2 and retry.";
}

function safeApprovalFailure(error: unknown): string {
  if (error instanceof RuntimeServiceError && error.code === "FORBIDDEN") {
    return "This Blueprint revision is not available to the current client.";
  }
  return "Approval was not recorded. The draft version or authoritative Runtime-v2 SIM account and strategy evidence changed. Review the current draft and runtime state, then retry.";
}

function refreshBlueprintPageBestEffort(): void {
  try {
    revalidatePath("/client/strategy");
  } catch {
    console.warn("Blueprint mutation committed; page revalidation was unavailable.");
  }
}

export async function previewBlueprintAction(
  _state: BlueprintPreviewActionState,
  formData: FormData,
): Promise<BlueprintPreviewActionState> {
  let user;
  try {
    user = await requireLocalClient();
  } catch (error) {
    if (error instanceof RuntimeServiceError && error.code === "FORBIDDEN") throw error;
    return previewErrorState("Blueprint staging is available only from the local operator dashboard.");
  }

  const fields = exactFields(formData, ["blueprint", "requestId"]);
  const file = fields?.get("blueprint");
  const requestId = fields ? stringField(fields, "requestId") : null;
  if (!(file instanceof File) || !requestIdSchema.safeParse(requestId).success) {
    return previewErrorState("Choose exactly one XLSX workbook and retry from the current Blueprint form.");
  }
  if (!SAFE_XLSX_BASENAME.test(file.name) || file.type !== XLSX_MIME) {
    return previewErrorState("Choose a standard .xlsx workbook with the expected XLSX file type.");
  }
  if (file.size === 0) return previewErrorState("The selected XLSX workbook is empty.");
  if (file.size > BLUEPRINT_MAX_BYTES) return previewErrorState("The selected XLSX workbook exceeds the 5 MiB preview limit.");

  let parsed: BlueprintPreviewResult;
  try {
    parsed = parseXlsxBlueprint({
      filename: file.name,
      bytes: new Uint8Array(await file.arrayBuffer()),
    });
  } catch {
    return previewErrorState("The workbook could not be decoded safely. No preview was retained.");
  }

  if (!parsed.valid) {
    return {
      status: "preview",
      message: "The workbook was rejected. Correct every listed issue and preview it again. Nothing was retained.",
      preview: toActionResult(parsed),
      nextRequestId: randomUUID(),
    };
  }

  try {
    const staged = await getBlueprintAssignmentRepository().stagePreview(user, parsed, {
      idempotencyKey: `blueprint:stage:${user.id}:${requestId}`,
    });
    return {
      status: "preview",
      message: "Valid preview staged for 30 minutes. It is not approved, scheduled, or sent to NinjaTrader.",
      preview: toActionResult(parsed, {
        previewId: staged.stagedPreview.previewId,
        expiresAt: staged.stagedPreview.expiresAt,
      }),
      nextRequestId: randomUUID(),
    };
  } catch {
    return previewErrorState("The valid workbook could not be staged safely. No mapping or approval was created.");
  }
}

export async function commitBlueprintMappingAction(
  _state: BlueprintMappingActionState,
  formData: FormData,
): Promise<BlueprintMappingActionState> {
  let user;
  try {
    user = await requireLocalClient();
  } catch {
    return mappingErrorState("Blueprint mapping is available only from the local operator dashboard.");
  }
  const fields = exactFields(formData, ["previewId", "agentId", "requestId", "mappings"]);
  if (!fields) return mappingErrorState("The mapping form is incomplete or contains unexpected fields.");
  const previewId = stringField(fields, "previewId");
  const agentId = stringField(fields, "agentId");
  const requestId = stringField(fields, "requestId");
  const mappingsJson = stringField(fields, "mappings");
  if (
    !z.uuid().safeParse(previewId).success
    || !z.uuid().safeParse(agentId).success
    || !requestIdSchema.safeParse(requestId).success
    || mappingsJson === null
    || mappingsJson.length > 100_000
  ) {
    return mappingErrorState("The mapping form is incomplete or invalid.");
  }
  let mappings: z.infer<typeof mappingPayloadSchema>;
  try {
    mappings = mappingPayloadSchema.parse(JSON.parse(mappingsJson));
  } catch {
    return mappingErrorState("Map every logical account exactly once to a different authoritative SIM account.");
  }
  if (
    new Set(mappings.map((mapping) => mapping.accountLabel)).size !== mappings.length
    || new Set(mappings.map((mapping) => mapping.accountRef)).size !== mappings.length
  ) {
    return mappingErrorState("Map every logical account exactly once to a different authoritative SIM account.");
  }

  try {
    const committed = await getBlueprintAssignmentRepository().commitMapping(user, {
      previewId,
      agentId,
      mappings,
      idempotencyKey: `blueprint:commit:${user.id}:${requestId}`,
    });
    refreshBlueprintPageBestEffort();
    return {
      status: "draft",
      message: "Immutable draft saved. Review it and approve it separately; no schedule or NinjaTrader action was created.",
      revision: toSafeBlueprintRevisionSummary(committed.revision),
      approvalRequestId: randomUUID(),
    };
  } catch (error) {
    return mappingErrorState(safeMappingFailure(error));
  }
}

export async function approveBlueprintRevisionAction(
  _state: BlueprintApprovalActionState,
  formData: FormData,
): Promise<BlueprintApprovalActionState> {
  let user;
  try {
    user = await requireLocalClient();
  } catch {
    return approvalErrorState("Blueprint approval is available only from the local operator dashboard.");
  }
  const fields = exactFields(formData, ["revisionRef", "expectedVersion", "requestId", "confirmation"]);
  if (!fields) return approvalErrorState("The approval form is incomplete or contains unexpected fields.");
  const revisionRef = stringField(fields, "revisionRef");
  const expectedVersionText = stringField(fields, "expectedVersion");
  const requestId = stringField(fields, "requestId");
  const confirmation = stringField(fields, "confirmation");
  if (confirmation !== "APPROVE BLUEPRINT") {
    return approvalErrorState("Type APPROVE BLUEPRINT exactly to approve this immutable draft.");
  }
  if (
    revisionRef === null
    || !/^assignment_rev_[a-z0-9]{16,64}$/.test(revisionRef)
    || expectedVersionText === null
    || !/^[1-9]\d{0,9}$/.test(expectedVersionText)
    || !requestIdSchema.safeParse(requestId).success
  ) {
    return approvalErrorState("The approval reference, version, or request is invalid.");
  }

  try {
    const approved = await getBlueprintAssignmentRepository().approveRevision(user, {
      revisionRef,
      expectedVersion: Number(expectedVersionText),
      idempotencyKey: `blueprint:approve:${user.id}:${requestId}`,
    });
    refreshBlueprintPageBestEffort();
    return {
      status: "approved",
      message: "Blueprint revision approved. Approval grants no schedule or NinjaTrader control authority.",
      revision: toSafeBlueprintRevisionSummary(approved.revision),
      nextRequestId: randomUUID(),
    };
  } catch (error) {
    return approvalErrorState(safeApprovalFailure(error));
  }
}
