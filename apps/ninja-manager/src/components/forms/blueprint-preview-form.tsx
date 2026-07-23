"use client";

import { useActionState, useMemo, useState } from "react";
import { CheckCircle2, FileSpreadsheet, LockKeyhole, ShieldCheck, TriangleAlert } from "lucide-react";

import {
  approveBlueprintRevisionAction,
  commitBlueprintMappingAction,
  previewBlueprintAction,
  type BlueprintApprovalActionState,
  type BlueprintMappingActionState,
  type BlueprintPreviewActionResult,
  type BlueprintPreviewActionState,
} from "@/app/actions/blueprint";
import type { SafeBlueprintRevisionSummary } from "@/components/forms/blueprint-assignment-view-model";
import type { BlueprintAccountOption } from "@/components/forms/blueprint-preview-view-model";
import { SubmitButton } from "@/components/submit-button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

interface BlueprintPreviewFormProps {
  accountOptions: BlueprintAccountOption[];
  mappingLockedReason: string | null;
  selectedAgentId: string | null;
  uploadRequestId: string;
  uploadEnabled?: boolean;
}

export interface BlueprintRecentRevisionItem {
  revision: SafeBlueprintRevisionSummary;
  approvalRequestId: string;
}

function issueLocation(issue: { row: number | null; column: string | null }): string {
  if (issue.row === null) return "Workbook";
  return `Row ${issue.row}${issue.column ? `, column ${issue.column}` : ""}`;
}

function periodLabel(period: "PERIOD_1" | "PERIOD_2"): string {
  return period === "PERIOD_1" ? "Period 1" : "Period 2";
}

function uniqueAccountLabels(preview: BlueprintPreviewActionResult): string[] {
  return [...new Set(preview.assignments.map((assignment) => assignment.accountLabel))]
    .sort((left, right) => left.localeCompare(right));
}

function previewMappingKey(preview: BlueprintPreviewActionResult): string {
  return [
    preview.previewId,
    ...preview.assignments.map((assignment) => [
      assignment.accountLabel,
      assignment.period,
      assignment.strategy,
      assignment.instrument,
      assignment.sourceRow,
      assignment.sourceSlot,
    ].join(":")),
  ].join("|");
}

function BlueprintRevisionSummary({
  revision,
  approvalRequestId,
}: {
  revision: SafeBlueprintRevisionSummary;
  approvalRequestId: string;
}) {
  const initialApprovalState: BlueprintApprovalActionState = {
    status: "idle",
    message: "",
    revision: null,
    nextRequestId: approvalRequestId,
  };
  const [state, action] = useActionState(approveBlueprintRevisionAction, initialApprovalState);
  const displayed = state.revision ?? revision;
  const accountByLabel = new Map(displayed.accounts.map((account) => [account.accountLabel, account]));
  const summaryConsistent = displayed.assignments.every((assignment) => accountByLabel.has(assignment.accountLabel));

  return (
    <article className="space-y-4 rounded-lg border bg-background/70 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-medium">Immutable Blueprint revision</p>
          <p className="font-mono text-xs text-muted-foreground">
            {displayed.revisionRef} · version {displayed.stateVersion} · {displayed.recordedAt}
          </p>
        </div>
        <Badge variant={displayed.status === "approved" ? "default" : "outline"}>
          {displayed.status === "approved" ? "Approved" : "Draft"}
        </Badge>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        {displayed.accounts.map((account) => (
          <div key={account.accountLabel} className="rounded-md border p-3 text-sm">
            <p className="font-medium">{account.accountLabel}</p>
            <p className="text-muted-foreground">{account.displayLabel} · <span className="font-mono">{account.maskedIdentifier}</span></p>
            <div className="mt-2 space-y-1">
              {displayed.assignments
                .filter((assignment) => assignment.accountLabel === account.accountLabel)
                .map((assignment, index) => (
                  <p key={`${assignment.period}-${assignment.strategy}-${assignment.instrument}-${index}`}>
                    {periodLabel(assignment.period)} · <span className="font-medium">{assignment.strategy}</span> · <span className="font-mono">{assignment.instrument}</span>
                  </p>
                ))}
            </div>
          </div>
        ))}
      </div>

      {!summaryConsistent && (
        <Alert variant="destructive">
          <TriangleAlert className="size-4" aria-hidden="true" />
          <AlertDescription>The safe revision summary is internally inconsistent. Approval is unavailable.</AlertDescription>
        </Alert>
      )}

      {state.message && (
        <Alert variant={state.status === "error" ? "destructive" : "default"} aria-live="polite">
          {state.status === "error"
            ? <TriangleAlert className="size-4" aria-hidden="true" />
            : <CheckCircle2 className="size-4" aria-hidden="true" />}
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      )}

      {displayed.status === "draft" && summaryConsistent && (
        <form action={action} className="space-y-3 rounded-md border border-primary/25 bg-primary/5 p-3">
          <input type="hidden" name="revisionRef" value={displayed.revisionRef} />
          <input type="hidden" name="expectedVersion" value={String(displayed.stateVersion)} />
          <input type="hidden" name="requestId" value={state.nextRequestId || approvalRequestId} />
          <div className="space-y-2">
            <Label htmlFor={`approve-${displayed.revisionRef}`}>Type APPROVE BLUEPRINT</Label>
            <Input
              id={`approve-${displayed.revisionRef}`}
              name="confirmation"
              autoComplete="off"
              placeholder="APPROVE BLUEPRINT"
              required
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Approval re-checks the latest authoritative Runtime-v2 SIM account and full strategy bindings. It does not schedule or control NinjaTrader.
          </p>
          <SubmitButton>Approve immutable draft</SubmitButton>
        </form>
      )}
    </article>
  );
}

export function BlueprintRecentRevisions({
  items,
  unavailableReason,
}: {
  items: BlueprintRecentRevisionItem[];
  unavailableReason: string | null;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent immutable Blueprint revisions</CardTitle>
        <CardDescription>
          Tenant-scoped drafts and approvals survive page reloads. Only masked account and strategy/instrument display fields are shown.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {unavailableReason && (
          <Alert>
            <TriangleAlert className="size-4" aria-hidden="true" />
            <AlertTitle>Revision history is unavailable</AlertTitle>
            <AlertDescription>{unavailableReason}</AlertDescription>
          </Alert>
        )}
        {!unavailableReason && items.length === 0 && (
          <p className="text-sm text-muted-foreground">No immutable Blueprint revisions have been saved for this tenant.</p>
        )}
        {items.map((item) => (
          <BlueprintRevisionSummary
            key={item.revision.revisionRef}
            revision={item.revision}
            approvalRequestId={item.approvalRequestId}
          />
        ))}
      </CardContent>
    </Card>
  );
}

export function BlueprintMappingDraft({
  preview,
  accountOptions,
  mappingLockedReason,
  selectedAgentId,
}: {
  preview: BlueprintPreviewActionResult;
  accountOptions: BlueprintAccountOption[];
  mappingLockedReason: string | null;
  selectedAgentId: string | null;
}) {
  const accountLabels = useMemo(() => uniqueAccountLabels(preview), [preview]);
  const [mappings, setMappings] = useState<Record<string, string>>({});
  const initialMappingState: BlueprintMappingActionState = {
    status: "idle",
    message: "",
    revision: null,
    approvalRequestId: preview.mappingRequestId ?? "",
  };
  const [state, action] = useActionState(commitBlueprintMappingAction, initialMappingState);
  const mappingLocked = (
    accountOptions.length === 0
    || mappingLockedReason !== null
    || selectedAgentId === null
    || preview.previewId === null
    || preview.mappingRequestId === null
  );
  const mappedCount = accountLabels.filter((label) => Boolean(mappings[label])).length;
  const selectedRefs = new Set(Object.values(mappings).filter(Boolean));
  const mappingPayload = accountLabels.map((accountLabel) => ({
    accountLabel,
    accountRef: mappings[accountLabel] ?? "",
  }));
  const exactMappingReady = (
    !mappingLocked
    && mappedCount === accountLabels.length
    && selectedRefs.size === accountLabels.length
  );

  return (
    <section className="space-y-4 rounded-lg border border-primary/25 bg-primary/5 p-4" aria-labelledby="mapping-draft-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h4 id="mapping-draft-title" className="font-semibold">Runtime account mapping</h4>
          <p className="mt-1 text-sm text-muted-foreground">
            Match each logical label manually, then save one immutable draft. Saving grants no schedule or control authority.
          </p>
        </div>
        <Badge variant="outline">{mappedCount} of {accountLabels.length} mapped</Badge>
      </div>

      {mappingLocked && (
        <Alert>
          <LockKeyhole className="size-4" aria-hidden="true" />
          <AlertTitle>Account mapping is locked</AlertTitle>
          <AlertDescription>{mappingLockedReason ?? "No fresh authoritative Runtime-v2 agent, account, and strategy evidence is available."}</AlertDescription>
        </Alert>
      )}

      <form action={action} className="space-y-4">
        <input type="hidden" name="previewId" value={preview.previewId ?? ""} />
        <input type="hidden" name="agentId" value={selectedAgentId ?? ""} />
        <input type="hidden" name="requestId" value={preview.mappingRequestId ?? ""} />
        <input type="hidden" name="mappings" value={JSON.stringify(mappingPayload)} />
        <div className="grid gap-4 lg:grid-cols-2">
          {accountLabels.map((accountLabel, index) => (
            <div key={accountLabel} className="space-y-2 rounded-md border bg-background/70 p-3">
              <Label htmlFor={`blueprint-map-${index}`}>{accountLabel}</Label>
              <select
                id={`blueprint-map-${index}`}
                className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm disabled:cursor-not-allowed disabled:opacity-50"
                value={mappings[accountLabel] ?? ""}
                disabled={mappingLocked || state.status === "draft"}
                onChange={(event) => setMappings((current) => ({ ...current, [accountLabel]: event.target.value }))}
                aria-label={`Runtime account for ${accountLabel}`}
              >
                <option value="">Select an authoritative SIM account</option>
                {accountOptions.map((option) => (
                  <option
                    key={option.accountRef}
                    value={option.accountRef}
                    disabled={selectedRefs.has(option.accountRef) && mappings[accountLabel] !== option.accountRef}
                  >
                    {option.displayLabel} · {option.maskedIdentifier} · {option.classificationLabel} · {option.connectionSummary}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
        {state.message && (
          <Alert variant={state.status === "error" ? "destructive" : "default"} aria-live="polite">
            {state.status === "error"
              ? <TriangleAlert className="size-4" aria-hidden="true" />
              : <ShieldCheck className="size-4" aria-hidden="true" />}
            <AlertDescription>{state.message}</AlertDescription>
          </Alert>
        )}
        {state.status !== "draft" && (
          <SubmitButton disabled={!exactMappingReady}>Save immutable mapping draft</SubmitButton>
        )}
      </form>

      {state.revision && (
        <BlueprintRevisionSummary
          revision={state.revision}
          approvalRequestId={state.approvalRequestId}
        />
      )}
    </section>
  );
}

export function BlueprintPreviewForm({
  accountOptions,
  mappingLockedReason,
  selectedAgentId,
  uploadRequestId,
  uploadEnabled = true,
}: BlueprintPreviewFormProps) {
  const initialPreviewState: BlueprintPreviewActionState = {
    status: "idle",
    message: "",
    preview: null,
    nextRequestId: uploadRequestId,
  };
  const [state, action] = useActionState(previewBlueprintAction, initialPreviewState);
  const preview = state.preview;
  const groups = preview?.valid
    ? Map.groupBy(preview.assignments, (assignment) => `${assignment.accountLabel}\u0000${assignment.period}`)
    : new Map<string, BlueprintPreviewActionResult["assignments"]>();

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <FileSpreadsheet className="size-5 text-primary" aria-hidden="true" />
          <CardTitle>Preview and stage XLSX blueprint</CardTitle>
        </div>
        <CardDescription>
          Upload one `.xlsx` workbook. A valid normalized preview is retained for 30 minutes so its mapping can be saved as an immutable draft.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <form action={action} className="space-y-4">
          <input type="hidden" name="requestId" value={state.nextRequestId || uploadRequestId} />
          <div className="space-y-2">
            <Label htmlFor="blueprint-file">XLSX workbook</Label>
            <Input
              id="blueprint-file"
              name="blueprint"
              type="file"
              accept={`.xlsx,${XLSX_MIME}`}
              required
              disabled={!uploadEnabled}
              aria-describedby="blueprint-upload-help"
            />
            <p id="blueprint-upload-help" className="text-xs text-muted-foreground">
              Maximum 5 MiB. XLS, XLSM, and CSV are not accepted. Workbook bytes, formulas, and Settings cells are never persisted.
            </p>
          </div>
          {state.message && (
            <Alert
              variant={state.status === "error" || preview?.valid === false ? "destructive" : "default"}
              aria-live="polite"
            >
              {state.status === "error" || preview?.valid === false
                ? <TriangleAlert className="size-4" aria-hidden="true" />
                : <ShieldCheck className="size-4" aria-hidden="true" />}
              <AlertDescription>{state.message}</AlertDescription>
            </Alert>
          )}
          <SubmitButton disabled={!uploadEnabled}>Preview and stage workbook</SubmitButton>
          {!uploadEnabled && (
            <p className="text-xs text-muted-foreground">Blueprint staging is restricted to the loopback local operator deployment.</p>
          )}
        </form>

        {preview && (
          <div className="space-y-6 border-t pt-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-medium">{preview.sourceFilename}</p>
                <p className="text-sm text-muted-foreground">
                  Sheet: {preview.sheetName}
                  {preview.expiresAt ? ` · mapping expires ${preview.expiresAt}` : ""}
                </p>
              </div>
              <Badge variant={preview.valid ? "default" : "destructive"}>{preview.valid ? "Valid and staged" : "Rejected"}</Badge>
            </div>
            <dl className="grid gap-3 sm:grid-cols-4">
              <div className="rounded-md border p-3"><dt className="text-xs text-muted-foreground">Data rows</dt><dd className="mt-1 font-mono text-lg">{preview.dataRowCount}</dd></div>
              <div className="rounded-md border p-3"><dt className="text-xs text-muted-foreground">Assignments</dt><dd className="mt-1 font-mono text-lg">{preview.assignmentCount}</dd></div>
              <div className="rounded-md border p-3"><dt className="text-xs text-muted-foreground">Logical accounts</dt><dd className="mt-1 font-mono text-lg">{preview.logicalAccountCount}</dd></div>
              <div className="rounded-md border p-3"><dt className="text-xs text-muted-foreground">Periods</dt><dd className="mt-1 font-mono text-lg">{preview.periodCount}</dd></div>
            </dl>

            {(preview.errors.length > 0 || preview.warnings.length > 0) && (
              <div className="grid gap-4 lg:grid-cols-2">
                {preview.errors.length > 0 && (
                  <section className="space-y-2">
                    <h4 className="font-medium text-destructive">Errors to correct</h4>
                    <ul className="space-y-2 text-sm">
                      {preview.errors.map((error, index) => (
                        <li key={`${error.code}-${error.row}-${error.column}-${index}`} className="rounded-md border border-destructive/30 p-3">
                          <span className="font-medium">{issueLocation(error)}:</span> {error.message}
                        </li>
                      ))}
                    </ul>
                  </section>
                )}
                {preview.warnings.length > 0 && (
                  <section className="space-y-2">
                    <h4 className="font-medium text-amber-300">Review warnings</h4>
                    <ul className="space-y-2 text-sm">
                      {preview.warnings.map((warning, index) => (
                        <li key={`${warning.code}-${warning.row}-${warning.column}-${index}`} className="rounded-md border border-amber-300/30 p-3">
                          <span className="font-medium">{issueLocation(warning)}:</span> {warning.message}
                        </li>
                      ))}
                    </ul>
                  </section>
                )}
              </div>
            )}

            {preview.valid && preview.previewId && (
              <>
                <section className="space-y-3" aria-labelledby="assignment-preview-title">
                  <div>
                    <h4 id="assignment-preview-title" className="font-semibold">Normalized assignments</h4>
                    <p className="text-sm text-muted-foreground">
                      Grouped by logical account and cycle period. Source row and slot remain visible for review.
                    </p>
                  </div>
                  {[...groups.values()].map((assignments) => {
                    const first = assignments[0];
                    return (
                      <div key={`${first.accountLabel}-${first.period}`} className="rounded-lg border p-4">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div>
                            <p className="font-medium">{first.accountLabel} · {periodLabel(first.period)}</p>
                            <p className="text-sm text-muted-foreground">{first.propFirm} · {first.stackLevel}-Stack</p>
                          </div>
                          <Badge variant="outline">{assignments.length} algorithm{assignments.length === 1 ? "" : "s"}</Badge>
                        </div>
                        <div className="mt-3 grid gap-2">
                          {assignments.map((assignment) => (
                            <div
                              key={`${assignment.sourceRow}-${assignment.sourceSlot}`}
                              className="grid gap-1 rounded-md bg-muted/40 px-3 py-2 text-sm sm:grid-cols-[8rem_1fr_1fr]"
                            >
                              <span className="font-mono text-xs text-muted-foreground">Row {assignment.sourceRow} · Algo {assignment.sourceSlot}</span>
                              <span className="font-medium">{assignment.strategy}</span>
                              <span className="font-mono">{assignment.instrument}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </section>
                <BlueprintMappingDraft
                  key={previewMappingKey(preview)}
                  preview={preview}
                  accountOptions={accountOptions}
                  mappingLockedReason={mappingLockedReason}
                  selectedAgentId={selectedAgentId}
                />
              </>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
