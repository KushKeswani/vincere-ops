import "server-only";

import { createHash } from "node:crypto";

import * as XLSX from "xlsx";

import {
  BLUEPRINT_MAX_ALGO_COLUMNS,
  BLUEPRINT_MAX_ASSIGNMENTS,
  BLUEPRINT_MAX_BYTES,
  BLUEPRINT_MAX_CELLS,
  BLUEPRINT_MAX_DATA_ROWS,
  BLUEPRINT_PREVIEW_VERSION,
  BLUEPRINT_REQUIRED_SHEET,
  blueprintAssignmentPreviewSchema,
  blueprintCanonicalPreviewHash,
  blueprintPreviewResultSchema,
  type BlueprintAssignmentPreview,
  type BlueprintCyclePeriod,
  type BlueprintIssue,
  type BlueprintIssueCode,
  type BlueprintPreviewResult,
} from "../domain/blueprint-import-contracts";

const REQUIRED_HEADERS = ["Cycle Period", "Account", "Prop Firm", "Stack Level"] as const;
const SAFE_ACCOUNT = /^[\p{L}\p{N}][\p{L}\p{N} #&'._\/-]*$/u;
const SAFE_FIRM = /^[\p{L}\p{N}][\p{L}\p{N} &'.\/-]*$/u;
const ASSIGNMENT = /^([A-Za-z][A-Za-z0-9._-]{0,63}) \(([A-Z0-9][A-Z0-9._\/-]{0,23})\)$/;
const XLSX_SIGNATURE = [0x50, 0x4b, 0x03, 0x04] as const;
const MAX_ISSUES_PER_KIND = 100;
const MAX_ARCHIVE_ENTRIES = 256;
const MAX_ARCHIVE_UNCOMPRESSED_BYTES = 32 * 1024 * 1024;

type ParseInput = Readonly<{
  filename: string;
  bytes: Uint8Array;
}>;

function displayFilename(filename: string): string {
  if (/^[^\\/\u0000-\u001f\u007f]{1,128}$/.test(filename)) return filename;
  return "invalid-upload.xlsx";
}

function issue(
  code: BlueprintIssueCode,
  message: string,
  row: number | null = null,
  column: string | null = null,
): BlueprintIssue {
  return { code, message, row, column };
}

function addIssue(target: BlueprintIssue[], value: BlueprintIssue): void {
  if (target.length < MAX_ISSUES_PER_KIND) target.push(value);
}

function columnName(columnIndex: number): string | null {
  return columnIndex >= 0 && columnIndex < BLUEPRINT_MAX_ALGO_COLUMNS + REQUIRED_HEADERS.length
    ? XLSX.utils.encode_col(columnIndex)
    : null;
}

function workbookHash(bytes: Uint8Array): string {
  return "sha256:" + createHash("sha256").update(bytes).digest("hex");
}

function finish(input: {
  filename: string;
  hash: string | null;
  dataRowCount?: number;
  assignments?: BlueprintAssignmentPreview[];
  warnings: BlueprintIssue[];
  errors: BlueprintIssue[];
}): BlueprintPreviewResult {
  const valid = input.errors.length === 0;
  const assignments = valid ? (input.assignments ?? []) : [];
  return blueprintPreviewResultSchema.parse({
    version: BLUEPRINT_PREVIEW_VERSION,
    valid,
    source: {
      filename: displayFilename(input.filename),
      sheetName: BLUEPRINT_REQUIRED_SHEET,
      workbookSha256: input.hash,
    },
    canonicalPreviewHash: valid ? blueprintCanonicalPreviewHash(assignments) : null,
    dataRowCount: input.dataRowCount ?? 0,
    assignmentCount: valid ? assignments.length : 0,
    assignments,
    warnings: input.warnings,
    errors: input.errors,
  });
}

function cellHasValue(cell: XLSX.CellObject | undefined): boolean {
  return cell !== undefined && cell.v !== undefined && cell.v !== null && cell.v !== "";
}

function isFormulaCell(cell: XLSX.CellObject | undefined): boolean {
  return cell !== undefined && (typeof cell.f === "string" || typeof cell.F === "string");
}

function stringCell(cell: XLSX.CellObject | undefined): string | null {
  return cellHasValue(cell) && cell?.t === "s" && typeof cell.v === "string" ? cell.v : null;
}

function cellAt(sheet: XLSX.WorkSheet, rowIndex: number, columnIndex: number): XLSX.CellObject | undefined {
  return sheet[XLSX.utils.encode_cell({ r: rowIndex, c: columnIndex })] as XLSX.CellObject | undefined;
}

function intersects(left: XLSX.Range, right: XLSX.Range): boolean {
  return left.s.r <= right.e.r && left.e.r >= right.s.r && left.s.c <= right.e.c && left.e.c >= right.s.c;
}

function normalizePeriod(value: string): BlueprintCyclePeriod | null {
  if (value === "Period 1") return "PERIOD_1";
  if (value === "Period 2") return "PERIOD_2";
  return null;
}

function parseStackLevel(value: string): number | null {
  const match = /^([1-9]|1\d|20)-Stack$/.exec(value);
  return match ? Number(match[1]) : null;
}

function headerKey(value: string): string {
  return value.trim().toLocaleLowerCase("en-US").replace(/\s+/g, " ");
}

function validateArchive(bytes: Buffer): BlueprintIssue | null {
  try {
    let endOfCentralDirectory = -1;
    const earliest = Math.max(0, bytes.length - 65_557);
    for (let offset = bytes.length - 22; offset >= earliest; offset -= 1) {
      if (bytes.readUInt32LE(offset) !== 0x06054b50) continue;
      const commentLength = bytes.readUInt16LE(offset + 20);
      if (offset + 22 + commentLength === bytes.length) {
        endOfCentralDirectory = offset;
        break;
      }
    }
    if (endOfCentralDirectory < 0) {
      return issue("WORKBOOK_INVALID", "XLSX ZIP central-directory metadata is missing or malformed.");
    }

    const diskNumber = bytes.readUInt16LE(endOfCentralDirectory + 4);
    const centralDirectoryDisk = bytes.readUInt16LE(endOfCentralDirectory + 6);
    const entriesOnDisk = bytes.readUInt16LE(endOfCentralDirectory + 8);
    const entryCount = bytes.readUInt16LE(endOfCentralDirectory + 10);
    const centralDirectorySize = bytes.readUInt32LE(endOfCentralDirectory + 12);
    const centralDirectoryOffset = bytes.readUInt32LE(endOfCentralDirectory + 16);
    if (
      diskNumber !== 0
      || centralDirectoryDisk !== 0
      || entriesOnDisk !== entryCount
      || entryCount === 0xffff
      || centralDirectorySize === 0xffffffff
      || centralDirectoryOffset === 0xffffffff
    ) {
      return issue("WORKBOOK_INVALID", "Multi-disk and ZIP64 XLSX archives are not accepted.");
    }
    if (entryCount === 0 || entryCount > MAX_ARCHIVE_ENTRIES) {
      return issue("ARCHIVE_LIMIT_EXCEEDED", "XLSX archive entry count exceeds the bounded parser limit.");
    }
    const centralDirectoryEnd = centralDirectoryOffset + centralDirectorySize;
    if (centralDirectoryEnd > endOfCentralDirectory || centralDirectoryOffset < 4) {
      return issue("WORKBOOK_INVALID", "XLSX ZIP central-directory offsets are invalid.");
    }

    let pointer = centralDirectoryOffset;
    let totalUncompressedBytes = 0;
    for (let entry = 0; entry < entryCount; entry += 1) {
      if (pointer + 46 > centralDirectoryEnd || bytes.readUInt32LE(pointer) !== 0x02014b50) {
        return issue("WORKBOOK_INVALID", "XLSX ZIP entry metadata is invalid.");
      }
      const flags = bytes.readUInt16LE(pointer + 8);
      const compressionMethod = bytes.readUInt16LE(pointer + 10);
      const compressedSize = bytes.readUInt32LE(pointer + 20);
      const uncompressedSize = bytes.readUInt32LE(pointer + 24);
      const filenameLength = bytes.readUInt16LE(pointer + 28);
      const extraLength = bytes.readUInt16LE(pointer + 30);
      const commentLength = bytes.readUInt16LE(pointer + 32);
      const entryDisk = bytes.readUInt16LE(pointer + 34);
      if ((flags & 0x0001) !== 0 || entryDisk !== 0 || (compressionMethod !== 0 && compressionMethod !== 8)) {
        return issue("WORKBOOK_INVALID", "Encrypted, multi-disk, or unsupported-compression XLSX entries are not accepted.");
      }
      if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff || filenameLength > 512) {
        return issue("WORKBOOK_INVALID", "ZIP64 or oversized XLSX entry metadata is not accepted.");
      }
      totalUncompressedBytes += uncompressedSize;
      if (uncompressedSize > MAX_ARCHIVE_UNCOMPRESSED_BYTES || totalUncompressedBytes > MAX_ARCHIVE_UNCOMPRESSED_BYTES) {
        return issue("ARCHIVE_LIMIT_EXCEEDED", "XLSX expanded content exceeds the 32 MiB parser limit.");
      }
      pointer += 46 + filenameLength + extraLength + commentLength;
    }
    if (pointer !== centralDirectoryEnd) {
      return issue("WORKBOOK_INVALID", "XLSX ZIP central-directory length is inconsistent.");
    }
    return null;
  } catch {
    return issue("WORKBOOK_INVALID", "XLSX ZIP metadata could not be decoded safely.");
  }
}

export function parseXlsxBlueprint(input: ParseInput): BlueprintPreviewResult {
  const warnings: BlueprintIssue[] = [];
  const errors: BlueprintIssue[] = [];
  const filenameIsSafe = /^[^\\/\u0000-\u001f\u007f]{1,128}\.xlsx$/i.test(input.filename);
  if (!filenameIsSafe) {
    addIssue(errors, issue("FILE_NAME_INVALID", "Upload must be a basename ending in .xlsx."));
  }

  if (input.bytes.byteLength === 0) {
    addIssue(errors, issue("FILE_EMPTY", "Workbook bytes are empty."));
    return finish({ filename: input.filename, hash: null, warnings, errors });
  }
  if (input.bytes.byteLength > BLUEPRINT_MAX_BYTES) {
    addIssue(errors, issue("FILE_TOO_LARGE", "Workbook exceeds the 5 MiB input limit."));
    return finish({ filename: input.filename, hash: null, warnings, errors });
  }

  const hash = workbookHash(input.bytes);
  if (!XLSX_SIGNATURE.every((value, index) => input.bytes[index] === value)) {
    addIssue(errors, issue("FILE_SIGNATURE_INVALID", "Workbook does not have the required XLSX ZIP signature."));
    return finish({ filename: input.filename, hash, warnings, errors });
  }
  if (errors.length > 0) return finish({ filename: input.filename, hash, warnings, errors });

  const workbookBytes = Buffer.from(input.bytes.buffer, input.bytes.byteOffset, input.bytes.byteLength);
  const archiveIssue = validateArchive(workbookBytes);
  if (archiveIssue) {
    addIssue(errors, archiveIssue);
    return finish({ filename: input.filename, hash, warnings, errors });
  }

  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(workbookBytes, {
      type: "buffer",
      sheets: [BLUEPRINT_REQUIRED_SHEET],
      sheetRows: BLUEPRINT_MAX_DATA_ROWS + 2,
      cellFormula: true,
      cellStyles: true,
      cellDates: false,
      bookVBA: false,
      bookDeps: false,
      bookFiles: false,
      WTF: false,
    });
  } catch {
    addIssue(errors, issue("WORKBOOK_INVALID", "Workbook could not be decoded as a bounded XLSX document."));
    return finish({ filename: input.filename, hash, warnings, errors });
  }

  if (!workbook.SheetNames.includes(BLUEPRINT_REQUIRED_SHEET)) {
    addIssue(errors, issue("REQUIRED_SHEET_MISSING", "The exact Cycling Blueprint sheet is required."));
    return finish({ filename: input.filename, hash, warnings, errors });
  }
  if (workbook.Workbook?.Sheets?.some((sheet) => (sheet.Hidden ?? 0) !== 0)) {
    addIssue(errors, issue("HIDDEN_SHEET", "Hidden or very-hidden workbook sheets are not accepted."));
  }

  const sheet = workbook.Sheets[BLUEPRINT_REQUIRED_SHEET];
  if (!sheet) {
    addIssue(errors, issue("REQUIRED_SHEET_MISSING", "The exact Cycling Blueprint sheet is required."));
    return finish({ filename: input.filename, hash, warnings, errors });
  }
  if (!sheet["!ref"]) {
    addIssue(errors, issue("WORKSHEET_EMPTY", "Cycling Blueprint contains no used cells."));
    return finish({ filename: input.filename, hash, warnings, errors });
  }

  let usedRange: XLSX.Range;
  let fullRange: XLSX.Range;
  try {
    usedRange = XLSX.utils.decode_range(sheet["!ref"]);
    fullRange = XLSX.utils.decode_range(sheet["!fullref"] ?? sheet["!ref"]);
  } catch {
    addIssue(errors, issue("USED_RANGE_INVALID", "Worksheet used-range metadata is invalid."));
    return finish({ filename: input.filename, hash, warnings, errors });
  }

  if (fullRange.e.r > BLUEPRINT_MAX_DATA_ROWS) {
    addIssue(errors, issue("ROW_LIMIT_EXCEEDED", "Worksheet extends beyond 500 data rows."));
  }
  if (fullRange.e.c >= REQUIRED_HEADERS.length + BLUEPRINT_MAX_ALGO_COLUMNS) {
    addIssue(errors, issue("ALGO_HEADER_LIMIT_EXCEEDED", "Worksheet extends beyond Algo 20."));
  }

  const cellKeys = Object.keys(sheet).filter((key) => /^[A-Z]{1,3}[1-9]\d*$/.test(key));
  if (cellKeys.length > BLUEPRINT_MAX_CELLS) {
    addIssue(errors, issue("CELL_LIMIT_EXCEEDED", "Worksheet contains more than 10,000 stored cells."));
  }

  for (const merge of sheet["!merges"] ?? []) {
    if (intersects(merge, fullRange)) {
      addIssue(errors, issue("MERGED_USED_CELL", "Merged cells are not accepted in the used blueprint range."));
      break;
    }
  }

  const boundedEndRow = Math.min(usedRange.e.r, BLUEPRINT_MAX_DATA_ROWS);
  for (let rowIndex = Math.max(0, usedRange.s.r); rowIndex <= boundedEndRow; rowIndex += 1) {
    if (sheet["!rows"]?.[rowIndex]?.hidden === true) {
      addIssue(errors, issue("HIDDEN_DATA_ROW", "Hidden rows are not accepted.", rowIndex + 1));
    }
  }

  for (const key of cellKeys) {
    const coordinate = XLSX.utils.decode_cell(key);
    const cell = sheet[key] as XLSX.CellObject;
    if (isFormulaCell(cell)) {
      addIssue(errors, issue(
        "FORMULA_CELL_FORBIDDEN",
        "Formula or array-formula cells are not accepted in the blueprint sheet.",
        coordinate.r <= BLUEPRINT_MAX_DATA_ROWS ? coordinate.r + 1 : null,
        columnName(coordinate.c),
      ));
    }
  }

  if (errors.length > 0) return finish({ filename: input.filename, hash, warnings, errors });

  const headerCells: Array<{ column: number; value: string }> = [];
  const headerEnd = Math.min(usedRange.e.c, REQUIRED_HEADERS.length + BLUEPRINT_MAX_ALGO_COLUMNS - 1);
  for (let columnIndex = 0; columnIndex <= headerEnd; columnIndex += 1) {
    const value = stringCell(cellAt(sheet, 0, columnIndex));
    if (value !== null) headerCells.push({ column: columnIndex, value });
  }
  const lastHeaderColumn = headerCells.length === 0
    ? -1
    : Math.max(...headerCells.map((header) => header.column));

  for (let columnIndex = 0; columnIndex < REQUIRED_HEADERS.length; columnIndex += 1) {
    const expected = REQUIRED_HEADERS[columnIndex];
    const actual = stringCell(cellAt(sheet, 0, columnIndex));
    if (actual === expected) continue;
    if (actual !== null && headerKey(actual) === headerKey(expected)) {
      addIssue(errors, issue("HEADER_AMBIGUOUS", "Header spelling, spacing, and case must be exact.", 1, columnName(columnIndex)));
    } else {
      addIssue(errors, issue("HEADER_MISSING", `Required header ${expected} is missing from its exact column.`, 1, columnName(columnIndex)));
    }
  }

  const duplicateHeaders = new Map<string, number>();
  for (const header of headerCells) {
    const count = (duplicateHeaders.get(header.value) ?? 0) + 1;
    duplicateHeaders.set(header.value, count);
    if (count > 1) {
      addIssue(errors, issue("HEADER_DUPLICATE", "Duplicate blueprint headers are not accepted.", 1, columnName(header.column)));
    }
  }

  if (lastHeaderColumn < REQUIRED_HEADERS.length) {
    addIssue(errors, issue("HEADER_MISSING", "At least the exact Algo 1 header is required.", 1, "E"));
  }
  const algorithmColumnCount = Math.max(0, lastHeaderColumn - REQUIRED_HEADERS.length + 1);
  if (algorithmColumnCount > BLUEPRINT_MAX_ALGO_COLUMNS) {
    addIssue(errors, issue("ALGO_HEADER_LIMIT_EXCEEDED", "No more than 20 algorithm columns are accepted.", 1));
  }
  for (let slot = 1; slot <= Math.min(algorithmColumnCount, BLUEPRINT_MAX_ALGO_COLUMNS); slot += 1) {
    const columnIndex = REQUIRED_HEADERS.length + slot - 1;
    const expected = `Algo ${slot}`;
    const actual = stringCell(cellAt(sheet, 0, columnIndex));
    if (actual === expected) continue;
    if (actual !== null && headerKey(actual) === headerKey(expected)) {
      addIssue(errors, issue("HEADER_AMBIGUOUS", "Algorithm header spelling, spacing, and case must be exact.", 1, columnName(columnIndex)));
    } else {
      addIssue(errors, issue("ALGO_HEADER_SEQUENCE_INVALID", "Algorithm headers must be contiguous Algo 1 through Algo N.", 1, columnName(columnIndex)));
    }
  }

  for (const header of headerCells) {
    const isRequired = REQUIRED_HEADERS.includes(header.value as (typeof REQUIRED_HEADERS)[number]);
    const isAlgorithm = /^Algo ([1-9]|1\d|20)$/.test(header.value);
    if (!isRequired && !isAlgorithm && header.column <= lastHeaderColumn) {
      addIssue(errors, issue("HEADER_UNSUPPORTED", "Unsupported blueprint header is present.", 1, columnName(header.column)));
    }
  }

  for (const key of cellKeys) {
    const coordinate = XLSX.utils.decode_cell(key);
    if (coordinate.r > 0 && coordinate.c > lastHeaderColumn && cellHasValue(sheet[key] as XLSX.CellObject)) {
      addIssue(errors, issue(
        "HEADER_UNSUPPORTED",
        "Data is present in a column without an accepted header.",
        coordinate.r <= BLUEPRINT_MAX_DATA_ROWS ? coordinate.r + 1 : null,
        columnName(coordinate.c),
      ));
    }
  }

  if (errors.length > 0) return finish({ filename: input.filename, hash, warnings, errors });

  const assignments: BlueprintAssignmentPreview[] = [];
  let dataRowCount = 0;
  for (let rowIndex = 1; rowIndex <= boundedEndRow; rowIndex += 1) {
    let hasData = false;
    for (let columnIndex = 0; columnIndex <= lastHeaderColumn; columnIndex += 1) {
      if (cellHasValue(cellAt(sheet, rowIndex, columnIndex))) {
        hasData = true;
        break;
      }
    }
    if (!hasData) continue;
    dataRowCount += 1;
    const excelRow = rowIndex + 1;

    const periodText = stringCell(cellAt(sheet, rowIndex, 0));
    const accountLabel = stringCell(cellAt(sheet, rowIndex, 1));
    const propFirm = stringCell(cellAt(sheet, rowIndex, 2));
    const stackText = stringCell(cellAt(sheet, rowIndex, 3));
    let rowInvalid = false;

    if (periodText === null) {
      addIssue(errors, issue("ROW_FIELD_MISSING", "Cycle Period must be a text value.", excelRow, "A"));
      rowInvalid = true;
    }
    const period = periodText === null ? null : normalizePeriod(periodText);
    if (periodText !== null && period === null) {
      addIssue(errors, issue("PERIOD_UNSUPPORTED", "Cycle Period must be exactly Period 1 or Period 2.", excelRow, "A"));
      rowInvalid = true;
    }

    if (accountLabel === null) {
      addIssue(errors, issue("ROW_FIELD_MISSING", "Account must be a text value.", excelRow, "B"));
      rowInvalid = true;
    } else if (accountLabel.length > 128) {
      addIssue(errors, issue("TEXT_TOO_LONG", "Account label exceeds 128 characters.", excelRow, "B"));
      rowInvalid = true;
    } else if (!SAFE_ACCOUNT.test(accountLabel)) {
      addIssue(errors, issue("TEXT_SYNTAX_UNSAFE", "Account label contains unsupported syntax.", excelRow, "B"));
      rowInvalid = true;
    }

    if (propFirm === null) {
      addIssue(errors, issue("ROW_FIELD_MISSING", "Prop Firm must be a text value.", excelRow, "C"));
      rowInvalid = true;
    } else if (propFirm.length > 80) {
      addIssue(errors, issue("TEXT_TOO_LONG", "Prop Firm exceeds 80 characters.", excelRow, "C"));
      rowInvalid = true;
    } else if (!SAFE_FIRM.test(propFirm)) {
      addIssue(errors, issue("TEXT_SYNTAX_UNSAFE", "Prop Firm contains unsupported syntax.", excelRow, "C"));
      rowInvalid = true;
    }

    const stackLevel = stackText === null ? null : parseStackLevel(stackText);
    if (stackLevel === null) {
      addIssue(errors, issue("STACK_LEVEL_INVALID", "Stack Level must be exactly N-Stack for N from 1 through 20.", excelRow, "D"));
      rowInvalid = true;
    }

    const rowAssignments: BlueprintAssignmentPreview[] = [];
    const seenAssignments = new Set<string>();
    let populatedCellCount = 0;
    let missingDeclaredSlot = false;
    let populatedTrailingSlot = false;

    for (let slot = 1; slot <= algorithmColumnCount; slot += 1) {
      const columnIndex = REQUIRED_HEADERS.length + slot - 1;
      const cell = cellAt(sheet, rowIndex, columnIndex);
      const rawValue = stringCell(cell);
      const isEmptySlot = !cellHasValue(cell) || rawValue === "-";
      if (isEmptySlot) {
        if (stackLevel !== null && slot <= stackLevel) missingDeclaredSlot = true;
        continue;
      }
      populatedCellCount += 1;
      if (stackLevel !== null && slot > stackLevel) populatedTrailingSlot = true;
      if (rawValue === null) {
        addIssue(errors, issue("ALGO_ASSIGNMENT_INVALID", "Algorithm slot must be a text NAME (INSTRUMENT) value.", excelRow, columnName(columnIndex)));
        rowInvalid = true;
        continue;
      }
      const parsed = ASSIGNMENT.exec(rawValue);
      if (!parsed) {
        addIssue(errors, issue("ALGO_ASSIGNMENT_INVALID", "Algorithm slot must use safe exact NAME (INSTRUMENT) syntax.", excelRow, columnName(columnIndex)));
        rowInvalid = true;
        continue;
      }
      const originalStrategy = parsed[1];
      const strategy = originalStrategy === "B2X" ? "RBO" : originalStrategy;
      const instrument = parsed[2];
      if (originalStrategy === "B2X") {
        addIssue(warnings, issue("STRATEGY_ALIAS_NORMALIZED", "Documented strategy alias B2X was normalized to RBO.", excelRow, columnName(columnIndex)));
      }
      const identity = `${strategy}\u0000${instrument}`;
      if (seenAssignments.has(identity)) {
        addIssue(errors, issue("ALGO_DUPLICATE", "Duplicate normalized strategy and instrument slots are not accepted.", excelRow, columnName(columnIndex)));
        rowInvalid = true;
        continue;
      }
      seenAssignments.add(identity);
      if (!rowInvalid && period !== null && accountLabel !== null && propFirm !== null && stackLevel !== null) {
        rowAssignments.push(blueprintAssignmentPreviewSchema.parse({
          period,
          accountLabel,
          propFirm,
          stackLevel,
          strategy,
          instrument,
          sourceRow: excelRow,
          sourceSlot: slot,
        }));
      }
    }

    if (missingDeclaredSlot) {
      addIssue(errors, issue("ALGO_SLOT_GAP", "Every declared stack slot must be populated contiguously from Algo 1.", excelRow));
      rowInvalid = true;
    }
    if (stackLevel !== null && (populatedCellCount !== stackLevel || populatedTrailingSlot)) {
      addIssue(errors, issue("STACK_COUNT_MISMATCH", "Declared N-Stack must equal the number of populated algorithm slots.", excelRow, "D"));
      rowInvalid = true;
    }
    if (!rowInvalid) assignments.push(...rowAssignments);
    if (assignments.length > BLUEPRINT_MAX_ASSIGNMENTS) {
      addIssue(errors, issue("ASSIGNMENT_LIMIT_EXCEEDED", "Blueprint exceeds 2,000 assignments."));
    }
  }

  if (dataRowCount === 0) {
    addIssue(errors, issue("WORKSHEET_EMPTY", "Cycling Blueprint contains no data rows.", 2));
  }
  if (dataRowCount > BLUEPRINT_MAX_DATA_ROWS) {
    addIssue(errors, issue("ROW_LIMIT_EXCEEDED", "Worksheet contains more than 500 data rows."));
  }

  return finish({
    filename: input.filename,
    hash,
    dataRowCount,
    assignments,
    warnings,
    errors,
  });
}
