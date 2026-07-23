import type { BlueprintAssignmentRevision } from "@/lib/domain/blueprint-assignment-contracts";

export interface SafeBlueprintRevisionSummary {
  revisionRef: string;
  status: "draft" | "approved";
  stateVersion: number;
  recordedAt: string;
  accounts: Array<{
    accountLabel: string;
    displayLabel: string;
    maskedIdentifier: string;
  }>;
  assignments: Array<{
    period: "PERIOD_1" | "PERIOD_2";
    accountLabel: string;
    propFirm: string;
    stackLevel: number;
    strategy: string;
    instrument: string;
  }>;
}

export function toSafeBlueprintRevisionSummary(
  revision: BlueprintAssignmentRevision,
): SafeBlueprintRevisionSummary {
  return {
    revisionRef: revision.revisionRef,
    status: revision.status,
    stateVersion: revision.stateVersion,
    recordedAt: revision.recordedAt,
    accounts: revision.accounts.map(({ accountLabel, displayLabel, maskedIdentifier }) => ({
      accountLabel,
      displayLabel,
      maskedIdentifier,
    })),
    assignments: revision.assignments.map(({
      period,
      accountLabel,
      propFirm,
      stackLevel,
      strategy,
      instrument,
    }) => ({ period, accountLabel, propFirm, stackLevel, strategy, instrument })),
  };
}
