import { z } from "zod";

import { hashCanonicalPayload } from "./canonical-json";

export const BLUEPRINT_PREVIEW_VERSION = "blueprint-preview/1.0" as const;
export const BLUEPRINT_REQUIRED_SHEET = "Cycling Blueprint" as const;
export const BLUEPRINT_MAX_BYTES = 5 * 1024 * 1024;
export const BLUEPRINT_MAX_DATA_ROWS = 500;
export const BLUEPRINT_MAX_CELLS = 10_000;
export const BLUEPRINT_MAX_ALGO_COLUMNS = 20;
export const BLUEPRINT_MAX_ASSIGNMENTS = 2_000;

const sha256 = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const safeLogicalLabel = z.string().min(1).max(128).regex(/^[\p{L}\p{N}][\p{L}\p{N} #&'._\/-]*$/u);
const safeFirmLabel = z.string().min(1).max(80).regex(/^[\p{L}\p{N}][\p{L}\p{N} &'.\/-]*$/u);
const strategyName = z.string().min(1).max(64).regex(/^[A-Za-z][A-Za-z0-9._-]*$/);
const instrumentName = z.string().min(1).max(24).regex(/^[A-Z0-9][A-Z0-9._\/-]*$/);

export const blueprintCyclePeriodSchema = z.enum(["PERIOD_1", "PERIOD_2"]);

export const blueprintAssignmentPreviewSchema = z.object({
  period: blueprintCyclePeriodSchema,
  accountLabel: safeLogicalLabel,
  propFirm: safeFirmLabel,
  stackLevel: z.number().int().min(1).max(BLUEPRINT_MAX_ALGO_COLUMNS),
  strategy: strategyName,
  instrument: instrumentName,
  sourceRow: z.number().int().min(2).max(BLUEPRINT_MAX_DATA_ROWS + 1),
  sourceSlot: z.number().int().min(1).max(BLUEPRINT_MAX_ALGO_COLUMNS),
}).strict();

export const blueprintIssueCodeSchema = z.enum([
  "FILE_NAME_INVALID",
  "FILE_EMPTY",
  "FILE_TOO_LARGE",
  "FILE_SIGNATURE_INVALID",
  "ARCHIVE_LIMIT_EXCEEDED",
  "WORKBOOK_INVALID",
  "REQUIRED_SHEET_MISSING",
  "HIDDEN_SHEET",
  "WORKSHEET_EMPTY",
  "USED_RANGE_INVALID",
  "ROW_LIMIT_EXCEEDED",
  "CELL_LIMIT_EXCEEDED",
  "MERGED_USED_CELL",
  "HIDDEN_DATA_ROW",
  "HEADER_MISSING",
  "HEADER_DUPLICATE",
  "HEADER_AMBIGUOUS",
  "HEADER_UNSUPPORTED",
  "ALGO_HEADER_SEQUENCE_INVALID",
  "ALGO_HEADER_LIMIT_EXCEEDED",
  "FORMULA_CELL_FORBIDDEN",
  "ROW_FIELD_MISSING",
  "TEXT_TOO_LONG",
  "TEXT_SYNTAX_UNSAFE",
  "PERIOD_UNSUPPORTED",
  "STACK_LEVEL_INVALID",
  "ALGO_SLOT_GAP",
  "ALGO_ASSIGNMENT_INVALID",
  "ALGO_DUPLICATE",
  "STACK_COUNT_MISMATCH",
  "ASSIGNMENT_LIMIT_EXCEEDED",
  "STRATEGY_ALIAS_NORMALIZED",
]);

export const blueprintIssueSchema = z.object({
  code: blueprintIssueCodeSchema,
  message: z.string().min(1).max(200),
  row: z.number().int().min(1).max(BLUEPRINT_MAX_DATA_ROWS + 1).nullable(),
  column: z.string().regex(/^[A-X]$/).nullable(),
}).strict();

export const blueprintPreviewResultSchema = z.object({
  version: z.literal(BLUEPRINT_PREVIEW_VERSION),
  valid: z.boolean(),
  source: z.object({
    filename: z.string().min(1).max(128).regex(/^[^\\/\u0000-\u001f\u007f]+$/),
    sheetName: z.literal(BLUEPRINT_REQUIRED_SHEET),
    workbookSha256: sha256.nullable(),
  }).strict(),
  canonicalPreviewHash: sha256.nullable(),
  dataRowCount: z.number().int().min(0).max(BLUEPRINT_MAX_DATA_ROWS),
  assignmentCount: z.number().int().min(0).max(BLUEPRINT_MAX_ASSIGNMENTS),
  assignments: z.array(blueprintAssignmentPreviewSchema).max(BLUEPRINT_MAX_ASSIGNMENTS),
  warnings: z.array(blueprintIssueSchema).max(100),
  errors: z.array(blueprintIssueSchema).max(100),
}).strict().superRefine((result, context) => {
  if (result.valid !== (result.errors.length === 0)) {
    context.addIssue({ code: "custom", message: "Validity must reflect the error list", path: ["valid"] });
  }
  if (result.warnings.some((warning) => warning.code !== "STRATEGY_ALIAS_NORMALIZED")) {
    context.addIssue({ code: "custom", message: "Warning list contains a non-warning issue code", path: ["warnings"] });
  }
  if (result.errors.some((error) => error.code === "STRATEGY_ALIAS_NORMALIZED")) {
    context.addIssue({ code: "custom", message: "Error list contains a warning-only issue code", path: ["errors"] });
  }
  if (result.valid) {
    if (result.source.workbookSha256 === null || result.canonicalPreviewHash === null) {
      context.addIssue({ code: "custom", message: "Valid previews require both hashes", path: ["canonicalPreviewHash"] });
    }
    if (result.assignmentCount !== result.assignments.length) {
      context.addIssue({ code: "custom", message: "Assignment count must match assignments", path: ["assignmentCount"] });
    }
  } else if (result.canonicalPreviewHash !== null || result.assignments.length !== 0 || result.assignmentCount !== 0) {
    context.addIssue({
      code: "custom",
      message: "Invalid previews cannot carry executable assignment candidates",
      path: ["assignments"],
    });
  }
});

export type BlueprintCyclePeriod = z.infer<typeof blueprintCyclePeriodSchema>;
export type BlueprintAssignmentPreview = z.infer<typeof blueprintAssignmentPreviewSchema>;
export type BlueprintIssue = z.infer<typeof blueprintIssueSchema>;
export type BlueprintIssueCode = z.infer<typeof blueprintIssueCodeSchema>;
export type BlueprintPreviewResult = z.infer<typeof blueprintPreviewResultSchema>;

export function blueprintCanonicalPreviewHash(assignments: readonly BlueprintAssignmentPreview[]): string {
  return hashCanonicalPayload({
    assignments,
    sheetName: BLUEPRINT_REQUIRED_SHEET,
    version: BLUEPRINT_PREVIEW_VERSION,
  });
}
