import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  BLUEPRINT_MAX_BYTES,
  BLUEPRINT_PREVIEW_VERSION,
  BLUEPRINT_REQUIRED_SHEET,
  type BlueprintPreviewResult,
} from "@/lib/domain/blueprint-import-contracts";
import type { BlueprintAssignmentRevision } from "@/lib/domain/blueprint-assignment-contracts";
import { RuntimeServiceError } from "@/lib/domain/runtime-errors";

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  requireDeploymentCapability: vi.fn(),
  parseXlsxBlueprint: vi.fn(),
  stagePreview: vi.fn(),
  commitMapping: vi.fn(),
  approveRevision: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({ requireUser: mocks.requireUser }));
vi.mock("@/lib/deployment/server", () => ({
  requireDeploymentCapability: mocks.requireDeploymentCapability,
}));
vi.mock("@/lib/blueprints/xlsx-blueprint-parser", () => ({
  parseXlsxBlueprint: mocks.parseXlsxBlueprint,
}));
vi.mock("@/lib/repositories/blueprint-assignment-repository", () => ({
  getBlueprintAssignmentRepository: () => ({
    stagePreview: mocks.stagePreview,
    commitMapping: mocks.commitMapping,
    approveRevision: mocks.approveRevision,
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));

import {
  approveBlueprintRevisionAction,
  commitBlueprintMappingAction,
  previewBlueprintAction,
  type BlueprintApprovalActionState,
  type BlueprintMappingActionState,
  type BlueprintPreviewActionState,
} from "./blueprint";

const MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const user = {
  id: "20000000-0000-4000-8000-000000000001",
  organizationId: "10000000-0000-4000-8000-000000000001",
  role: "client",
};
const agentId = "30000000-0000-4000-8000-000000000001";
const previewId = "50000000-0000-4000-8000-000000000001";
const requestId = "60000000-0000-4000-8000-000000000001";
const revisionRef = "assignment_rev_1234567890abcdef";
const idlePreview: BlueprintPreviewActionState = {
  status: "idle", message: "", preview: null, nextRequestId: requestId,
};
const idleMapping: BlueprintMappingActionState = {
  status: "idle", message: "", revision: null, approvalRequestId: requestId,
};
const idleApproval: BlueprintApprovalActionState = {
  status: "idle", message: "", revision: null, nextRequestId: requestId,
};

function file(bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04]), name = "preview.xlsx", type = MIME): File {
  return new File([bytes], name, { type });
}

function upload(workbook: File = file(), id = requestId): FormData {
  const data = new FormData();
  data.append("blueprint", workbook);
  data.append("requestId", id);
  return data;
}

function validParserResult(): BlueprintPreviewResult {
  return {
    version: BLUEPRINT_PREVIEW_VERSION,
    valid: true,
    source: {
      filename: "preview.xlsx",
      sheetName: BLUEPRINT_REQUIRED_SHEET,
      workbookSha256: `sha256:${"a".repeat(64)}`,
    },
    canonicalPreviewHash: `sha256:${"b".repeat(64)}`,
    dataRowCount: 1,
    assignmentCount: 1,
    assignments: [{
      period: "PERIOD_1",
      accountLabel: "Logical #1",
      propFirm: "Example Firm",
      stackLevel: 1,
      strategy: "RBO",
      instrument: "NQ",
      sourceRow: 2,
      sourceSlot: 1,
    }],
    warnings: [],
    errors: [],
  };
}

function revision(status: "draft" | "approved" = "draft"): BlueprintAssignmentRevision {
  return {
    version: "blueprint-assignment/1.0",
    revisionRef,
    agentId,
    status,
    stateVersion: status === "draft" ? 1 : 2,
    recordedAt: "2026-07-21T16:00:00.000Z",
    source: {
      eventId: "40000000-0000-4000-8000-000000000001",
      sequence: 1,
      asOf: "2026-07-21T16:00:00.000Z",
      occurredAt: "2026-07-21T16:00:00.000Z",
      receivedAt: "2026-07-21T16:00:00.000Z",
    },
    accounts: [{
      accountLabel: "Logical #1",
      accountRef: "acct_1234567890abcdef",
      maskedIdentifier: "****m101",
      displayLabel: "Simulation account 1",
    }],
    assignments: [{
      ...validParserResult().assignments[0],
      accountRef: "acct_1234567890abcdef",
      strategyRef: "strat_1234567890abcdef",
    }],
  };
}

function mappingForm(overrides: Record<string, string> = {}): FormData {
  const data = new FormData();
  const values = {
    previewId,
    agentId,
    requestId,
    mappings: JSON.stringify([{ accountLabel: "Logical #1", accountRef: "acct_1234567890abcdef" }]),
    ...overrides,
  };
  Object.entries(values).forEach(([key, value]) => data.append(key, value));
  return data;
}

function approvalForm(overrides: Record<string, string> = {}): FormData {
  const data = new FormData();
  const values = {
    revisionRef,
    expectedVersion: "1",
    requestId,
    confirmation: "APPROVE BLUEPRINT",
    ...overrides,
  };
  Object.entries(values).forEach(([key, value]) => data.append(key, value));
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireUser.mockResolvedValue(user);
  mocks.requireDeploymentCapability.mockImplementation(() => undefined);
  mocks.parseXlsxBlueprint.mockReturnValue(validParserResult());
  mocks.stagePreview.mockResolvedValue({
    duplicate: false,
    stagedPreview: {
      previewId,
      expiresAt: "2026-07-21T16:30:00.000Z",
    },
  });
  mocks.commitMapping.mockResolvedValue({ duplicate: false, revision: revision("draft") });
  mocks.approveRevision.mockResolvedValue({ duplicate: false, revision: revision("approved") });
});

describe("Blueprint preview and staging action", () => {
  it("authenticates before local capability, parsing, or persistence", async () => {
    mocks.requireUser.mockRejectedValue(new Error("unauthenticated"));
    const result = await previewBlueprintAction(idlePreview, upload());
    expect(result.status).toBe("error");
    expect(mocks.requireDeploymentCapability).not.toHaveBeenCalled();
    expect(mocks.parseXlsxBlueprint).not.toHaveBeenCalled();
    expect(mocks.stagePreview).not.toHaveBeenCalled();
  });

  it("fails closed in central mode before parsing", async () => {
    mocks.requireDeploymentCapability.mockImplementation(() => { throw new Error("central"); });
    const result = await previewBlueprintAction(idlePreview, upload());
    expect(result.status).toBe("error");
    expect(mocks.parseXlsxBlueprint).not.toHaveBeenCalled();
    expect(mocks.stagePreview).not.toHaveBeenCalled();
  });

  it("requires exact upload fields while ignoring only Next action metadata", async () => {
    const missing = new FormData();
    missing.append("blueprint", file());
    const duplicate = upload();
    duplicate.append("requestId", requestId);
    const extra = upload();
    extra.append("extra", "value");
    const wrongRequest = upload(file(), "not-a-uuid");
    const metadata = upload();
    metadata.append("$ACTION_ID_test", "framework");

    for (const form of [missing, duplicate, extra, wrongRequest]) {
      expect((await previewBlueprintAction(idlePreview, form)).status).toBe("error");
    }
    expect((await previewBlueprintAction(idlePreview, metadata)).status).toBe("preview");
  });

  it("rejects unsafe types and sizes before parsing", async () => {
    const results = await Promise.all([
      previewBlueprintAction(idlePreview, upload(file(undefined, "../preview.xlsx"))),
      previewBlueprintAction(idlePreview, upload(file(undefined, "preview.xlsm"))),
      previewBlueprintAction(idlePreview, upload(file(undefined, "preview.xlsx", "application/octet-stream"))),
      previewBlueprintAction(idlePreview, upload(file(new Uint8Array()))),
      previewBlueprintAction(idlePreview, upload(file(new Uint8Array(BLUEPRINT_MAX_BYTES + 1)))),
    ]);
    expect(results.every((result) => result.status === "error")).toBe(true);
    expect(mocks.parseXlsxBlueprint).not.toHaveBeenCalled();
  });

  it("never stages an invalid parser result", async () => {
    mocks.parseXlsxBlueprint.mockReturnValue({
      ...validParserResult(),
      valid: false,
      canonicalPreviewHash: null,
      assignmentCount: 0,
      assignments: [],
      errors: [{ code: "STACK_COUNT_MISMATCH", message: "Correct the row.", row: 2, column: "D" }],
    });
    const result = await previewBlueprintAction(idlePreview, upload());
    expect(result).toMatchObject({ status: "preview", preview: { valid: false, previewId: null } });
    expect(mocks.stagePreview).not.toHaveBeenCalled();
  });

  it("stages a valid normalized preview with a server-derived actor-bound idempotency key", async () => {
    const result = await previewBlueprintAction(idlePreview, upload());
    expect(mocks.stagePreview).toHaveBeenCalledWith(user, validParserResult(), {
      idempotencyKey: `blueprint:stage:${user.id}:${requestId}`,
    });
    expect(result).toMatchObject({
      status: "preview",
      preview: { valid: true, previewId, expiresAt: "2026-07-21T16:30:00.000Z" },
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("sha256:");
    expect(serialized).not.toContain("workbookSha256");
    expect(serialized).not.toContain("canonicalPreviewHash");
  });
});

describe("Blueprint mapping action", () => {
  it("denies direct mapping and approval action calls in central mode", async () => {
    mocks.requireDeploymentCapability.mockImplementation(() => { throw new Error("central"); });
    expect((await commitBlueprintMappingAction(idleMapping, mappingForm())).status).toBe("error");
    expect((await approveBlueprintRevisionAction(idleApproval, approvalForm())).status).toBe("error");
    expect(mocks.commitMapping).not.toHaveBeenCalled();
    expect(mocks.approveRevision).not.toHaveBeenCalled();
  });

  it("rejects missing, duplicate, extra, malformed, and duplicate mapping payload fields", async () => {
    const missing = mappingForm();
    missing.delete("agentId");
    const duplicate = mappingForm();
    duplicate.append("previewId", previewId);
    const extra = mappingForm();
    extra.append("unexpected", "value");
    const malformed = mappingForm({ mappings: "not json" });
    const duplicateLabels = mappingForm({
      mappings: JSON.stringify([
        { accountLabel: "Logical #1", accountRef: "acct_1234567890abcdef" },
        { accountLabel: "Logical #1", accountRef: "acct_2234567890abcdef" },
      ]),
    });
    for (const form of [missing, duplicate, extra, malformed, duplicateLabels]) {
      expect((await commitBlueprintMappingAction(idleMapping, form)).status).toBe("error");
    }
    expect(mocks.commitMapping).not.toHaveBeenCalled();
  });

  it("passes only exact browser references and a server-derived idempotency key to authoritative repository revalidation", async () => {
    const result = await commitBlueprintMappingAction(idleMapping, mappingForm());
    expect(mocks.commitMapping).toHaveBeenCalledWith(user, {
      previewId,
      agentId,
      mappings: [{ accountLabel: "Logical #1", accountRef: "acct_1234567890abcdef" }],
      idempotencyKey: `blueprint:commit:${user.id}:${requestId}`,
    });
    expect(result.status).toBe("draft");
  });

  it("keeps cross-agent, stale, or changed evidence unapproved with a safe concrete error", async () => {
    mocks.commitMapping.mockRejectedValue(new RuntimeServiceError("FORBIDDEN", "different tenant/agent"));
    const result = await commitBlueprintMappingAction(idleMapping, mappingForm());
    expect(result.status).toBe("error");
    expect(result.message).toContain("not available");
    expect(result.revision).toBeNull();
  });

  it("returns a safe draft summary without account/strategy refs or evidence hashes", async () => {
    const result = await commitBlueprintMappingAction(idleMapping, mappingForm());
    const serialized = JSON.stringify(result);
    expect(result).toMatchObject({ status: "draft", revision: { status: "draft", stateVersion: 1 } });
    expect(serialized).not.toContain("acct_");
    expect(serialized).not.toContain("strat_");
    expect(serialized).not.toContain("eventId");
    expect(serialized).not.toContain("sha256:");
  });

  it("returns the committed draft even when page revalidation fails", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    mocks.revalidatePath.mockImplementation(() => { throw new Error("refresh failed"); });
    const result = await commitBlueprintMappingAction(idleMapping, mappingForm());
    expect(result.status).toBe("draft");
    expect(result.revision?.status).toBe("draft");
    expect(warning).toHaveBeenCalledWith("Blueprint mutation committed; page revalidation was unavailable.");
    warning.mockRestore();
  });
});

describe("Blueprint approval action", () => {
  it("requires the exact phrase, version, request UUID, and exact fields", async () => {
    const wrongPhrase = approvalForm({ confirmation: "approve blueprint" });
    const wrongVersion = approvalForm({ expectedVersion: "0" });
    const wrongRequest = approvalForm({ requestId: "bad" });
    const extra = approvalForm();
    extra.append("extra", "value");
    for (const form of [wrongPhrase, wrongVersion, wrongRequest, extra]) {
      expect((await approveBlueprintRevisionAction(idleApproval, form)).status).toBe("error");
    }
    expect(mocks.approveRevision).not.toHaveBeenCalled();
  });

  it("approves only through a separate actor-bound repository call and remains control-free", async () => {
    const result = await approveBlueprintRevisionAction(idleApproval, approvalForm());
    expect(mocks.approveRevision).toHaveBeenCalledWith(user, {
      revisionRef,
      expectedVersion: 1,
      idempotencyKey: `blueprint:approve:${user.id}:${requestId}`,
    });
    expect(result).toMatchObject({ status: "approved", revision: { status: "approved", stateVersion: 2 } });
    expect(result.message).toContain("no schedule or NinjaTrader control authority");
  });

  it("fails safely when runtime evidence or the expected version changed", async () => {
    mocks.approveRevision.mockRejectedValue(new RuntimeServiceError("CONFLICT", "changed"));
    const result = await approveBlueprintRevisionAction(idleApproval, approvalForm());
    expect(result.status).toBe("error");
    expect(result.message).toContain("changed");
    expect(result.revision).toBeNull();
  });

  it("returns the committed approval even when page revalidation fails", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    mocks.revalidatePath.mockImplementation(() => { throw new Error("refresh failed"); });
    const result = await approveBlueprintRevisionAction(idleApproval, approvalForm());
    expect(result.status).toBe("approved");
    expect(result.revision?.status).toBe("approved");
    expect(warning).toHaveBeenCalledWith("Blueprint mutation committed; page revalidation was unavailable.");
    warning.mockRestore();
  });

  it("supports the full preview to draft to explicit approval state progression", async () => {
    const staged = await previewBlueprintAction(idlePreview, upload());
    const draft = await commitBlueprintMappingAction(idleMapping, mappingForm({
      previewId: staged.preview?.previewId ?? "",
    }));
    const approved = await approveBlueprintRevisionAction(idleApproval, approvalForm({
      revisionRef: draft.revision?.revisionRef ?? "",
      expectedVersion: String(draft.revision?.stateVersion ?? 0),
    }));
    expect([staged.status, draft.status, approved.status]).toEqual(["preview", "draft", "approved"]);
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/client/strategy");
  });
});
