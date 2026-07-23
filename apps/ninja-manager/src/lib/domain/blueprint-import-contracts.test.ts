import { describe, expect, it } from "vitest";

import {
  BLUEPRINT_PREVIEW_VERSION,
  BLUEPRINT_REQUIRED_SHEET,
  blueprintAssignmentPreviewSchema,
  blueprintCanonicalPreviewHash,
  blueprintPreviewResultSchema,
} from "./blueprint-import-contracts";

const assignment = {
  period: "PERIOD_1" as const,
  accountLabel: "Client #001",
  propFirm: "Example Firm",
  stackLevel: 1,
  strategy: "RBO",
  instrument: "NQ",
  sourceRow: 2,
  sourceSlot: 1,
};

describe("blueprint preview contracts", () => {
  it("accepts bounded logical assignments and rejects unsafe identifiers", () => {
    expect(blueprintAssignmentPreviewSchema.parse(assignment)).toEqual(assignment);
    expect(() => blueprintAssignmentPreviewSchema.parse({ ...assignment, accountLabel: "=HYPERLINK(1)" })).toThrow();
    expect(() => blueprintAssignmentPreviewSchema.parse({ ...assignment, instrument: "NQ (unsafe)" })).toThrow();
    expect(() => blueprintAssignmentPreviewSchema.parse({ ...assignment, sourceSlot: 21 })).toThrow();
    expect(() => blueprintAssignmentPreviewSchema.parse({ ...assignment, unexpected: true })).toThrow();
  });

  it("hashes normalized semantic assignments instead of workbook bytes", () => {
    const first = blueprintCanonicalPreviewHash([assignment]);
    expect(first).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(blueprintCanonicalPreviewHash([{ ...assignment }])).toBe(first);
    expect(blueprintCanonicalPreviewHash([{ ...assignment, instrument: "MNQ" }])).not.toBe(first);
  });

  it("requires invalid previews to discard assignment candidates and their hash", () => {
    const valid = {
      version: BLUEPRINT_PREVIEW_VERSION,
      valid: true,
      source: {
        filename: "blueprint.xlsx",
        sheetName: BLUEPRINT_REQUIRED_SHEET,
        workbookSha256: "sha256:" + "a".repeat(64),
      },
      canonicalPreviewHash: "sha256:" + "b".repeat(64),
      dataRowCount: 1,
      assignmentCount: 1,
      assignments: [assignment],
      warnings: [],
      errors: [],
    };
    expect(blueprintPreviewResultSchema.parse(valid)).toEqual(valid);
    expect(() => blueprintPreviewResultSchema.parse({
      ...valid,
      valid: false,
      errors: [{ code: "STACK_COUNT_MISMATCH", message: "Mismatch.", row: 2, column: "D" }],
    })).toThrow();
  });
});
