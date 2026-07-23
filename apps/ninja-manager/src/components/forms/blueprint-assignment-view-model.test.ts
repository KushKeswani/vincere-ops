import { describe, expect, it } from "vitest";

import type { BlueprintAssignmentRevision } from "@/lib/domain/blueprint-assignment-contracts";

import { toSafeBlueprintRevisionSummary } from "./blueprint-assignment-view-model";

describe("Blueprint assignment safe view model", () => {
  it("removes account, strategy, runtime-event, and hash evidence from the browser projection", () => {
    const revision: BlueprintAssignmentRevision = {
      version: "blueprint-assignment/1.0",
      revisionRef: "assignment_rev_1234567890abcdef",
      agentId: "30000000-0000-4000-8000-000000000001",
      status: "draft",
      stateVersion: 1,
      recordedAt: "2026-07-21T16:00:00.000Z",
      source: {
        eventId: "40000000-0000-4000-8000-000000000001",
        sequence: 7,
        asOf: "2026-07-21T16:00:00.000Z",
        occurredAt: "2026-07-21T16:00:00.000Z",
        receivedAt: "2026-07-21T16:00:00.000Z",
      },
      accounts: [{
        accountLabel: "Lucid #1",
        accountRef: "acct_1234567890abcdef",
        maskedIdentifier: "****m101",
        displayLabel: "Simulation account 1",
      }],
      assignments: [{
        period: "PERIOD_1",
        accountLabel: "Lucid #1",
        propFirm: "Lucid",
        stackLevel: 1,
        strategy: "RBO",
        instrument: "MNQ",
        sourceRow: 2,
        sourceSlot: 1,
        accountRef: "acct_1234567890abcdef",
        strategyRef: "strat_1234567890abcdef",
      }],
    };

    const safe = toSafeBlueprintRevisionSummary(revision);
    expect(safe).toMatchObject({ status: "draft", stateVersion: 1, accounts: [{ maskedIdentifier: "****m101" }] });
    const serialized = JSON.stringify(safe);
    expect(serialized).not.toContain("acct_");
    expect(serialized).not.toContain("strat_");
    expect(serialized).not.toContain("eventId");
    expect(serialized).not.toContain("agentId");
    expect(serialized).not.toContain("sha256:");
  });
});
