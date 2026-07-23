import { describe, expect, it } from "vitest";

import {
  BLUEPRINT_ASSIGNMENT_VERSION,
  blueprintApproveInputSchema,
  blueprintAssignmentRevisionSchema,
  blueprintCommitInputSchema,
  blueprintCommitRequestHash,
  blueprintStageContentHash,
  blueprintStagedPreviewSchema,
} from "./blueprint-assignment-contracts";

const assignment = {
  period: "PERIOD_1" as const,
  accountLabel: "Lucid #1",
  propFirm: "Lucid",
  stackLevel: 1,
  strategy: "RBO",
  instrument: "MNQ",
  sourceRow: 2,
  sourceSlot: 1,
};

describe("Blueprint assignment contracts", () => {
  it("requires a one-to-one mapping and exact revision reference shape", () => {
    expect(() => blueprintCommitInputSchema.parse({
      previewId: "10000000-0000-4000-8000-000000000001",
      agentId: "20000000-0000-4000-8000-000000000001",
      idempotencyKey: "blueprint:commit:0001",
      mappings: [
        { accountLabel: "Lucid #1", accountRef: "acct_1234567890abcdef" },
        { accountLabel: "Lucid #1", accountRef: "acct_2234567890abcdef" },
      ],
    })).toThrow();
    expect(() => blueprintCommitInputSchema.parse({
      previewId: "10000000-0000-4000-8000-000000000001",
      agentId: "20000000-0000-4000-8000-000000000001",
      idempotencyKey: "blueprint:commit:0002",
      mappings: [
        { accountLabel: "Lucid #1", accountRef: "acct_1234567890abcdef" },
        { accountLabel: "Lucid #2", accountRef: "acct_1234567890abcdef" },
      ],
    })).toThrow();
    expect(() => blueprintApproveInputSchema.parse({
      revisionRef: "not-an-assignment",
      expectedVersion: 1,
      idempotencyKey: "blueprint:approve:0001",
    })).toThrow();
  });

  it("keeps hashes out of staged-preview and revision public shapes", () => {
    const staged = blueprintStagedPreviewSchema.parse({
      version: BLUEPRINT_ASSIGNMENT_VERSION,
      previewId: "10000000-0000-4000-8000-000000000001",
      stagedAt: "2026-07-21T12:00:00.000Z",
      expiresAt: "2026-07-21T12:30:00.000Z",
      expired: false,
      dataRowCount: 1,
      assignmentCount: 1,
      uniqueAccountCount: 1,
      assignments: [assignment],
    });
    const revision = blueprintAssignmentRevisionSchema.parse({
      version: BLUEPRINT_ASSIGNMENT_VERSION,
      revisionRef: "assignment_rev_1234567890abcdef",
      agentId: "20000000-0000-4000-8000-000000000001",
      status: "draft",
      stateVersion: 1,
      recordedAt: "2026-07-21T12:00:00.000Z",
      source: {
        eventId: "30000000-0000-4000-8000-000000000001",
        sequence: 1,
        asOf: "2026-07-21T12:00:00.000Z",
        occurredAt: "2026-07-21T12:00:00.000Z",
        receivedAt: "2026-07-21T12:00:00.000Z",
      },
      accounts: [{
        accountLabel: "Lucid #1",
        accountRef: "acct_1234567890abcdef",
        maskedIdentifier: "****m101",
        displayLabel: "Simulation account 1",
      }],
      assignments: [{
        ...assignment,
        accountRef: "acct_1234567890abcdef",
        strategyRef: "strat_1234567890abcdef",
      }],
    });
    expect(JSON.stringify({ staged, revision })).not.toMatch(/(?:workbook|content|stateDigest|fingerprint).*sha256/i);
  });

  it("hashes semantic mapping and all immutable stage evidence deterministically", () => {
    const first = blueprintCommitRequestHash({
      previewId: "10000000-0000-4000-8000-000000000001",
      agentId: "20000000-0000-4000-8000-000000000001",
      idempotencyKey: "blueprint:commit:0001",
      mappings: [
        { accountLabel: "Lucid #2", accountRef: "acct_2234567890abcdef" },
        { accountLabel: "Lucid #1", accountRef: "acct_1234567890abcdef" },
      ],
    });
    const reordered = blueprintCommitRequestHash({
      previewId: "10000000-0000-4000-8000-000000000001",
      agentId: "20000000-0000-4000-8000-000000000001",
      idempotencyKey: "different:key:000001",
      mappings: [
        { accountLabel: "Lucid #1", accountRef: "acct_1234567890abcdef" },
        { accountLabel: "Lucid #2", accountRef: "acct_2234567890abcdef" },
      ],
    });
    expect(first).toBe(reordered);

    const base = {
      previewId: "10000000-0000-4000-8000-000000000001",
      sourceWorkbookHash: `sha256:${"a".repeat(64)}`,
      canonicalPreviewHash: `sha256:${"b".repeat(64)}`,
      dataRowCount: 1,
      assignments: [assignment],
      stagedAt: "2026-07-21T12:00:00.000Z",
      expiresAt: "2026-07-21T12:30:00.000Z",
      createdBy: "20000000-0000-4000-8000-000000000001",
      idempotencyKey: "blueprint:stage:0001",
      requestHash: `sha256:${"c".repeat(64)}`,
    };
    expect(blueprintStageContentHash(base)).not.toBe(blueprintStageContentHash({ ...base, expiresAt: "2026-07-21T12:31:00.000Z" }));
  });
});
