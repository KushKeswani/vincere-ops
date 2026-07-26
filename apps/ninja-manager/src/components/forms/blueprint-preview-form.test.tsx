import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { BlueprintPreviewActionResult } from "@/app/actions/blueprint";
import type { SafeBlueprintRevisionSummary } from "@/components/forms/blueprint-assignment-view-model";
import type { LatestRuntimeObservationV2 } from "@/lib/repositories/runtime-repository";

import { BlueprintMappingDraft, BlueprintRecentRevisions } from "./blueprint-preview-form";
import {
  buildBlueprintMappingEvidence,
  type BlueprintAccountOption,
} from "./blueprint-preview-view-model";

const preview: BlueprintPreviewActionResult = {
  valid: true,
  previewId: "50000000-0000-4000-8000-000000000001",
  expiresAt: "2026-07-21T12:30:00.000Z",
  mappingRequestId: "60000000-0000-4000-8000-000000000001",
  sourceFilename: "preview.xlsx",
  sheetName: "Cycling Blueprint",
  dataRowCount: 1,
  assignmentCount: 1,
  logicalAccountCount: 1,
  periodCount: 1,
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

const option: BlueprintAccountOption = {
  accountRef: "acct_abcdefghijklmnop",
  displayLabel: "Simulation account 1",
  maskedIdentifier: "******M101",
  classificationLabel: "Authoritative simulation",
  connectionSummary: "Connection 1 (connected)",
};

const revision: SafeBlueprintRevisionSummary = {
  revisionRef: "assignment_rev_1234567890abcdef",
  status: "draft",
  stateVersion: 1,
  recordedAt: "2026-07-21T12:00:00.000Z",
  accounts: [{
    accountLabel: "Logical #1",
    displayLabel: "Simulation account 1",
    maskedIdentifier: "******M101",
  }],
  assignments: [{
    period: "PERIOD_1",
    accountLabel: "Logical #1",
    propFirm: "Example Firm",
    stackLevel: 1,
    strategy: "RBO",
    instrument: "NQ",
  }],
};

function latest(overrides?: {
  asOf?: string;
  freshness?: "fresh" | "stale" | "unknown";
  accountScope?: "complete" | "partial" | "unavailable";
  addonAuthenticated?: boolean;
}): LatestRuntimeObservationV2 {
  const asOf = overrides?.asOf ?? "2026-07-21T12:00:00.000Z";
  const accountScope = overrides?.accountScope ?? "complete";
  const incompleteErrors = accountScope === "complete"
    ? []
    : [{ code: "SOURCE_ERROR" as const, retryable: true }];
  return {
    occurredAt: new Date(asOf),
    receivedAt: new Date(asOf),
    observation: {
      asOf,
      freshness: {
        status: overrides?.freshness ?? "fresh",
        ageMs: overrides?.freshness === "unknown" ? null : overrides?.freshness === "stale" ? 61_000 : 0,
        maxAgeMs: 60_000,
      },
      state: {
        addon: {
          status: "connected",
          ipcAuthenticated: overrides?.addonAuthenticated ?? true,
        },
        connections: [{
          connectionRef: "conn_abcdefghijklmnop",
          displayLabel: "Connection 1",
          kind: "simulation",
          providerCode: "SIMULATED_DATA_FEED",
          status: "connected",
          health: "healthy",
          marketDataStatus: "live",
        }],
        accounts: [{
          accountRef: "acct_abcdefghijklmnop",
          maskedIdentifier: "******M101",
          displayLabel: "Simulation account 1",
          classification: { environment: "simulation", authority: "authoritative", source: "ninjatrader_simulation_account" },
          connectionRefs: ["conn_abcdefghijklmnop"],
          status: "connected",
        }, {
          accountRef: "acct_liveaccount0001",
          maskedIdentifier: "******0003",
          displayLabel: "Live account 3",
          classification: { environment: "live", authority: "authoritative", source: "ninjatrader_live_account" },
          connectionRefs: ["conn_abcdefghijklmnop"],
          status: "connected",
        }, {
          accountRef: "acct_qrstuvwxyzabcdef",
          maskedIdentifier: "******0002",
          displayLabel: "Unknown account 2",
          classification: { environment: "unknown", authority: "unavailable" },
          connectionRefs: [],
          status: "unknown",
        }],
        collection: {
          scopes: {
            accounts: { status: accountScope, errors: incompleteErrors },
            connections: { status: "complete", errors: [] },
          },
        },
      },
    },
  } as unknown as LatestRuntimeObservationV2;
}

describe("Blueprint mapping evidence", () => {
  it("exposes only fresh authoritatively classified Runtime-v2 accounts with safe display fields", () => {
    const evidence = buildBlueprintMappingEvidence(
      latest(),
      new Date("2026-07-21T12:00:30.000Z"),
    );
    expect(evidence.mappingLockedReason).toBeNull();
    expect(evidence.accountOptions).toEqual([option]);
    expect(JSON.stringify(evidence)).not.toContain("fingerprint");
  });

  it("locks mapping when evidence is stale, partial, or unauthenticated", () => {
    const now = new Date("2026-07-21T12:02:00.000Z");
    const results = [
      buildBlueprintMappingEvidence(latest(), now),
      buildBlueprintMappingEvidence(latest({ accountScope: "partial" }), new Date("2026-07-21T12:00:30.000Z")),
      buildBlueprintMappingEvidence(latest({ addonAuthenticated: false }), new Date("2026-07-21T12:00:30.000Z")),
    ];
    expect(results.every((result) => result.accountOptions.length === 0 && result.mappingLockedReason !== null)).toBe(true);
  });
});

describe("Blueprint persisted mapping UI", () => {
  it("renders locked mapping with disabled controls when no fresh owned agent exists", () => {
    const markup = renderToStaticMarkup(
      <BlueprintMappingDraft
        preview={preview}
        accountOptions={[]}
        mappingLockedReason="Fresh authoritative account evidence is required."
        selectedAgentId={null}
      />,
    );
    expect(markup).toContain("Account mapping is locked");
    expect(markup).toContain("Fresh authoritative account evidence is required.");
    expect(markup).toContain("<select");
    expect(markup).toContain("disabled");
  });

  it("starts every mapping explicitly unmapped and posts the exact stage, agent, request, and mapping fields", () => {
    const markup = renderToStaticMarkup(
      <BlueprintMappingDraft
        preview={preview}
        accountOptions={[option]}
        mappingLockedReason={null}
        selectedAgentId="30000000-0000-4000-8000-000000000001"
      />,
    );
    expect(markup).toContain("0 of 1 mapped");
    expect(markup).toContain("Select an authoritative SIM account");
    expect(markup).toContain('name="previewId"');
    expect(markup).toContain('name="agentId"');
    expect(markup).toContain('name="requestId"');
    expect(markup).toContain('name="mappings"');
    expect(markup).toContain("Save immutable mapping draft");
  });

  it("renders reload-safe draft history with only masked account and strategy/instrument fields", () => {
    const markup = renderToStaticMarkup(
      <BlueprintRecentRevisions
        items={[{
          revision,
          approvalRequestId: "60000000-0000-4000-8000-000000000002",
        }]}
        unavailableReason={null}
      />,
    );
    expect(markup).toContain("Recent immutable Blueprint revisions");
    expect(markup).toContain("Simulation account 1");
    expect(markup).toContain("******M101");
    expect(markup).toContain("RBO");
    expect(markup).toContain("NQ");
    expect(markup).toContain("APPROVE BLUEPRINT");
    expect(markup).not.toContain("acct_");
    expect(markup).not.toContain("strat_");
    expect(markup).not.toContain("sha256:");
    expect(markup).not.toContain("eventId");
  });

  it("does not render an approval form for an already-approved immutable revision", () => {
    const markup = renderToStaticMarkup(
      <BlueprintRecentRevisions
        items={[{
          revision: { ...revision, status: "approved", stateVersion: 2 },
          approvalRequestId: "60000000-0000-4000-8000-000000000003",
        }]}
        unavailableReason={null}
      />,
    );
    expect(markup).toContain("Approved");
    expect(markup).not.toContain('name="confirmation"');
  });
});
