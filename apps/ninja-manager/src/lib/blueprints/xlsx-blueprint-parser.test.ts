import { existsSync, readFileSync } from "node:fs";

import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";

import {
  BLUEPRINT_MAX_BYTES,
  BLUEPRINT_REQUIRED_SHEET,
  type BlueprintIssueCode,
} from "../domain/blueprint-import-contracts";
import { parseXlsxBlueprint } from "./xlsx-blueprint-parser";

const HEADERS = ["Cycle Period", "Account", "Prop Firm", "Stack Level", "Algo 1", "Algo 2"];
const VALID_ROW = ["Period 1", "Client #001", "Example Firm", "2-Stack", "B2X (NQ)", "ARPD (ES)"];
const REAL_BLUEPRINT_PATH = process.env.VINCERE_BLUEPRINT_PATH
  ?? "C:\\Users\\Administrator\\Documents\\Projects\\Vincere\\Automation\\Vincere_Blueprint_2026-04-13.xlsx";

function fixture(
  rows: unknown[][] = [HEADERS, VALID_ROW],
  options: {
    sheetName?: string;
    hiddenTarget?: boolean;
    hiddenRow?: number;
    merge?: string;
    settingsFormula?: boolean;
    mutate?: (sheet: XLSX.WorkSheet) => void;
  } = {},
): Uint8Array {
  const workbook = XLSX.utils.book_new();
  const sheetName = options.sheetName ?? BLUEPRINT_REQUIRED_SHEET;
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  if (options.hiddenRow !== undefined) {
    sheet["!rows"] = [];
    sheet["!rows"][options.hiddenRow] = { hidden: true };
  }
  if (options.merge) sheet["!merges"] = [XLSX.utils.decode_range(options.merge)];
  options.mutate?.(sheet);
  XLSX.utils.book_append_sheet(workbook, sheet, sheetName);
  if (options.settingsFormula) {
    const settings = XLSX.utils.aoa_to_sheet([["ignored"]]);
    settings.A2 = { t: "n", f: "'[external.xlsx]Sheet1'!A1", v: 1 };
    settings["!ref"] = "A1:A2";
    XLSX.utils.book_append_sheet(workbook, settings, "Settings");
  }
  if (options.hiddenTarget) workbook.Workbook = { Sheets: [{ Hidden: 1 }] };
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx", compression: true });
}

function codes(result: ReturnType<typeof parseXlsxBlueprint>): BlueprintIssueCode[] {
  return result.errors.map((error) => error.code);
}

function declareOversizedArchiveEntry(bytes: Uint8Array): Uint8Array {
  const changed = Buffer.from(bytes);
  let endOfCentralDirectory = -1;
  for (let offset = changed.length - 22; offset >= 0; offset -= 1) {
    if (changed.readUInt32LE(offset) === 0x06054b50) {
      endOfCentralDirectory = offset;
      break;
    }
  }
  const centralDirectoryOffset = changed.readUInt32LE(endOfCentralDirectory + 16);
  changed.writeUInt32LE(33 * 1024 * 1024, centralDirectoryOffset + 24);
  return changed;
}

describe("bounded XLSX blueprint parser", () => {
  it("normalizes only the documented strategy alias and preserves instruments", () => {
    const result = parseXlsxBlueprint({
      filename: "blueprint.xlsx",
      bytes: fixture([HEADERS, VALID_ROW], { settingsFormula: true }),
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.dataRowCount).toBe(1);
    expect(result.assignmentCount).toBe(2);
    expect(result.assignments.map(({ strategy, instrument }) => ({ strategy, instrument }))).toEqual([
      { strategy: "RBO", instrument: "NQ" },
      { strategy: "ARPD", instrument: "ES" },
    ]);
    expect(result.warnings).toEqual([{
      code: "STRATEGY_ALIAS_NORMALIZED",
      message: "Documented strategy alias B2X was normalized to RBO.",
      row: 2,
      column: "E",
    }]);
    expect(result.source.workbookSha256).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(result.canonicalPreviewHash).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it("reads only Cycling Blueprint cells and ignores formula cells in Settings", () => {
    const bytes = fixture([HEADERS, VALID_ROW], { settingsFormula: true });
    const result = parseXlsxBlueprint({ filename: "blueprint.xlsx", bytes });
    expect(result.valid).toBe(true);
    expect(codes(result)).toEqual([]);
  });

  it("rejects non-XLSX names, empty input, oversized input, and wrong signatures", () => {
    expect(codes(parseXlsxBlueprint({ filename: "blueprint.csv", bytes: fixture() }))).toContain("FILE_NAME_INVALID");
    expect(codes(parseXlsxBlueprint({ filename: "blueprint.xlsx", bytes: new Uint8Array() }))).toContain("FILE_EMPTY");
    expect(codes(parseXlsxBlueprint({ filename: "blueprint.xlsx", bytes: new Uint8Array(BLUEPRINT_MAX_BYTES + 1) }))).toContain("FILE_TOO_LARGE");
    expect(codes(parseXlsxBlueprint({ filename: "blueprint.xlsx", bytes: new Uint8Array([1, 2, 3, 4]) }))).toContain("FILE_SIGNATURE_INVALID");
    expect(codes(parseXlsxBlueprint({
      filename: "blueprint.xlsx",
      bytes: declareOversizedArchiveEntry(fixture()),
    }))).toContain("ARCHIVE_LIMIT_EXCEEDED");
  });

  it("requires the exact visible sheet and rejects hidden rows and merged used cells", () => {
    expect(codes(parseXlsxBlueprint({ filename: "blueprint.xlsx", bytes: fixture([HEADERS, VALID_ROW], { sheetName: "cycling blueprint" }) }))).toContain("REQUIRED_SHEET_MISSING");
    expect(codes(parseXlsxBlueprint({ filename: "blueprint.xlsx", bytes: fixture([HEADERS, VALID_ROW], { hiddenTarget: true }) }))).toContain("HIDDEN_SHEET");
    expect(codes(parseXlsxBlueprint({ filename: "blueprint.xlsx", bytes: fixture([HEADERS, VALID_ROW], { hiddenRow: 1 }) }))).toContain("HIDDEN_DATA_ROW");
    expect(codes(parseXlsxBlueprint({ filename: "blueprint.xlsx", bytes: fixture([HEADERS, VALID_ROW], { merge: "B2:C2" }) }))).toContain("MERGED_USED_CELL");
  });

  it("rejects formulas in used fields even when a cached value exists", () => {
    const bytes = fixture([HEADERS, VALID_ROW], {
      mutate: (sheet) => {
        sheet.E2 = { t: "s", f: "\"RBO (NQ)\"", v: "RBO (NQ)" };
      },
    });
    expect(codes(parseXlsxBlueprint({ filename: "blueprint.xlsx", bytes }))).toContain("FORMULA_CELL_FORBIDDEN");
  });

  it("rejects ambiguous, duplicate, missing, and non-contiguous headers", () => {
    const ambiguous = [["cycle period", ...HEADERS.slice(1)], VALID_ROW];
    expect(codes(parseXlsxBlueprint({ filename: "blueprint.xlsx", bytes: fixture(ambiguous) }))).toContain("HEADER_AMBIGUOUS");

    const duplicate = [[...HEADERS, "Algo 2"], [...VALID_ROW, "RBO (MNQ)"]];
    expect(codes(parseXlsxBlueprint({ filename: "blueprint.xlsx", bytes: fixture(duplicate) }))).toContain("HEADER_DUPLICATE");

    const missing = [[...HEADERS.slice(0, 4)], VALID_ROW.slice(0, 4)];
    expect(codes(parseXlsxBlueprint({ filename: "blueprint.xlsx", bytes: fixture(missing) }))).toContain("HEADER_MISSING");

    const gap = [[...HEADERS.slice(0, 5), "Algo 3"], VALID_ROW];
    expect(codes(parseXlsxBlueprint({ filename: "blueprint.xlsx", bytes: fixture(gap) }))).toContain("ALGO_HEADER_SEQUENCE_INVALID");
  });

  it("rejects unsupported periods, stack gaps/counts, duplicates, and unsafe strategy syntax", () => {
    const period = [HEADERS, ["Period 3", ...VALID_ROW.slice(1)]];
    expect(codes(parseXlsxBlueprint({ filename: "blueprint.xlsx", bytes: fixture(period) }))).toContain("PERIOD_UNSUPPORTED");

    const gap = [HEADERS, ["Period 1", "Client #001", "Example Firm", "2-Stack", "-", "ARPD (ES)"]];
    expect(codes(parseXlsxBlueprint({ filename: "blueprint.xlsx", bytes: fixture(gap) }))).toContain("ALGO_SLOT_GAP");

    const count = [HEADERS, ["Period 1", "Client #001", "Example Firm", "1-Stack", "RBO (NQ)", "ARPD (ES)"]];
    const countResult = parseXlsxBlueprint({ filename: "blueprint.xlsx", bytes: fixture(count) });
    expect(codes(countResult)).toContain("STACK_COUNT_MISMATCH");
    expect(countResult.assignments).toEqual([]);
    expect(countResult.assignmentCount).toBe(0);
    expect(countResult.canonicalPreviewHash).toBeNull();

    const duplicate = [HEADERS, ["Period 1", "Client #001", "Example Firm", "2-Stack", "B2X (NQ)", "RBO (NQ)"]];
    expect(codes(parseXlsxBlueprint({ filename: "blueprint.xlsx", bytes: fixture(duplicate) }))).toContain("ALGO_DUPLICATE");

    const unsafe = [HEADERS, ["Period 1", "Client #001", "Example Firm", "2-Stack", "RBO (=CMD)", "ARPD (ES)"]];
    expect(codes(parseXlsxBlueprint({ filename: "blueprint.xlsx", bytes: fixture(unsafe) }))).toContain("ALGO_ASSIGNMENT_INVALID");

    const unsafeAccount = [HEADERS, ["Period 1", "=HYPERLINK(1)", "Example Firm", "2-Stack", "RBO (NQ)", "ARPD (ES)"]];
    expect(codes(parseXlsxBlueprint({ filename: "blueprint.xlsx", bytes: fixture(unsafeAccount) }))).toContain("TEXT_SYNTAX_UNSAFE");
  });

  it("rejects sheets extending beyond 500 data rows or 20 algorithm columns", () => {
    const tooManyRows = [HEADERS, ...Array.from({ length: 501 }, (_, index) => [
      "Period 1", `Client #${index + 1}`, "Example Firm", "1-Stack", "RBO (NQ)", "-",
    ])];
    expect(codes(parseXlsxBlueprint({ filename: "blueprint.xlsx", bytes: fixture(tooManyRows) }))).toContain("ROW_LIMIT_EXCEEDED");

    const tooManyHeaders = [...REQUIRED_BASE_HEADERS(), ...Array.from({ length: 21 }, (_, index) => `Algo ${index + 1}`)];
    const row = ["Period 1", "Client #001", "Example Firm", "1-Stack", "RBO (NQ)"];
    expect(codes(parseXlsxBlueprint({ filename: "blueprint.xlsx", bytes: fixture([tooManyHeaders, row]) }))).toContain("ALGO_HEADER_LIMIT_EXCEEDED");
  });

  it("rejects headerless data, more than 10,000 stored cells, and more than 2,000 assignments", () => {
    const headerless = fixture([HEADERS, [...VALID_ROW, "hidden-data"]]);
    expect(codes(parseXlsxBlueprint({ filename: "blueprint.xlsx", bytes: headerless }))).toContain("HEADER_UNSUPPORTED");

    const cellHeavy = Array.from({ length: 418 }, () => Array.from({ length: 24 }, () => "x"));
    expect(codes(parseXlsxBlueprint({ filename: "blueprint.xlsx", bytes: fixture(cellHeavy) }))).toContain("CELL_LIMIT_EXCEEDED");

    const fiveAlgoHeaders = [...REQUIRED_BASE_HEADERS(), ...Array.from({ length: 5 }, (_, index) => `Algo ${index + 1}`)];
    const assignmentHeavy = [
      fiveAlgoHeaders,
      ...Array.from({ length: 401 }, (_, row) => [
        "Period 1",
        `Client #${row + 1}`,
        "Example Firm",
        "5-Stack",
        ...Array.from({ length: 5 }, (_, slot) => `Algo${slot + 1} (NQ${row + 1})`),
      ]),
    ];
    expect(codes(parseXlsxBlueprint({ filename: "blueprint.xlsx", bytes: fixture(assignmentHeavy) }))).toContain("ASSIGNMENT_LIMIT_EXCEEDED");
  });

  it.runIf(existsSync(REAL_BLUEPRINT_PATH))("parses the canonical read-only blueprint without emitting workbook values", () => {
    const result = parseXlsxBlueprint({
      filename: "Vincere_Blueprint_2026-04-13.xlsx",
      bytes: readFileSync(REAL_BLUEPRINT_PATH),
    });
    expect(result.errors.map((error) => error.code)).toEqual([]);
    expect({
      valid: result.valid,
      sheetName: result.source.sheetName,
      dataRows: result.dataRowCount,
      assignments: result.assignmentCount,
      accounts: new Set(result.assignments.map((assignment) => assignment.accountLabel)).size,
      firms: new Set(result.assignments.map((assignment) => assignment.propFirm)).size,
      periods: new Set(result.assignments.map((assignment) => assignment.period)).size,
      strategies: new Set(result.assignments.map((assignment) => assignment.strategy)).size,
      instruments: new Set(result.assignments.map((assignment) => assignment.instrument)).size,
    }).toEqual({
      valid: true,
      sheetName: BLUEPRINT_REQUIRED_SHEET,
      dataRows: 5,
      assignments: 16,
      accounts: 5,
      firms: 1,
      periods: 2,
      strategies: 6,
      instruments: 5,
    });
  });
});

function REQUIRED_BASE_HEADERS(): string[] {
  return ["Cycle Period", "Account", "Prop Firm", "Stack Level"];
}
