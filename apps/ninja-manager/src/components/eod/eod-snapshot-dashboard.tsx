import { AlertTriangle, Bot, CalendarClock, DollarSign } from "lucide-react";

import { StatusBadge } from "@/components/status-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { EodSnapshot, EodSnapshotSummary } from "@/lib/domain/eod-snapshot-contracts";

import {
  buildEodSnapshotDisplayModel,
  buildEodSnapshotHistoryDisplay,
  type EodMoneyDisplay,
} from "./eod-snapshot-view-model";

interface EodSnapshotDashboardProps {
  latest: EodSnapshot | null;
  history: EodSnapshotSummary[];
}

function MoneyValue({ value }: { value: EodMoneyDisplay }) {
  return (
    <div>
      <p className={value.available ? "font-mono font-medium" : "font-medium text-amber-700 dark:text-amber-400"}>
        {value.value}
      </p>
      <p className="text-xs text-muted-foreground">{value.detail}</p>
    </div>
  );
}

export function EodSnapshotDashboard({ latest, history }: EodSnapshotDashboardProps) {
  const summaries = buildEodSnapshotHistoryDisplay(history);
  if (!latest) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>End-of-day snapshots</CardTitle>
          <CardDescription>Immutable, source-backed account P&amp;L and strategy stacks.</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">No EOD snapshot has been captured for this private workspace yet.</p>
        </CardContent>
      </Card>
    );
  }

  const model = buildEodSnapshotDisplayModel(latest);
  const accountScope = model.scopes.find((scope) => scope.key === "accounts");
  return (
    <div className="space-y-6">
      {model.overall !== "complete" && (
        <Alert variant="destructive">
          <AlertTriangle className="size-4" aria-hidden="true" />
          <AlertTitle>Snapshot evidence is {model.overall}</AlertTitle>
          <AlertDescription>
            Missing rows and unavailable values remain unknown. They are not converted to zero and must not be treated as proof of absence.
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card><CardHeader><CardDescription>Intended EOD date</CardDescription><CardTitle>{model.intendedDate}</CardTitle></CardHeader><CardContent><p className="text-xs text-muted-foreground">{model.timeZone}</p></CardContent></Card>
        <Card><CardHeader><CardDescription>Captured</CardDescription><CardTitle className="text-base">{model.capturedAt}</CardTitle></CardHeader><CardContent><CalendarClock className="size-5 text-primary" aria-hidden="true" /></CardContent></Card>
        <Card><CardHeader><CardDescription>Completeness</CardDescription><CardTitle className="capitalize">{model.overall}</CardTitle></CardHeader><CardContent><StatusBadge status={model.overall} /></CardContent></Card>
        <Card><CardHeader><CardDescription>Retained evidence</CardDescription><CardTitle>{model.accounts.length} accounts</CardTitle></CardHeader><CardContent><p className="text-xs text-muted-foreground">{model.strategyCount} exact strategy row{model.strategyCount === 1 ? "" : "s"}</p></CardContent></Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Collection coverage</CardTitle>
          <CardDescription>Every Runtime v2 scope keeps its original completeness, item count, and safe issue classification.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {model.scopes.map((scope) => (
            <div key={scope.key} className="rounded-md border p-3 text-sm">
              <div className="flex items-center justify-between gap-2"><p className="font-medium">{scope.label}</p><StatusBadge status={scope.status} /></div>
              <p className="mt-2 text-muted-foreground">{scope.itemCount} retained item{scope.itemCount === 1 ? "" : "s"}</p>
              {scope.issues.map((issue) => <p key={issue} className="mt-1 text-xs text-destructive">{issue}</p>)}
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><DollarSign className="size-5" aria-hidden="true" />Account P&amp;L</CardTitle>
          <CardDescription>Daily, native lifetime, and manager-observed values are separate evidence. Only masked identifiers are displayed.</CardDescription>
        </CardHeader>
        <CardContent>
          {model.accounts.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {accountScope?.status === "complete"
                ? "The complete account collection retained no accounts."
                : "No account rows were retained; incomplete account evidence does not prove that no accounts exist."}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader><TableRow><TableHead>Account</TableHead><TableHead>Classification</TableHead><TableHead>Daily realized</TableHead><TableHead>Daily unrealized</TableHead><TableHead>Daily total</TableHead><TableHead>Native lifetime</TableHead><TableHead>Manager observed</TableHead></TableRow></TableHeader>
                <TableBody>
                  {model.accounts.map((account) => (
                    <TableRow key={account.key}>
                      <TableCell className="font-medium">{account.label}<p className="font-mono text-xs text-muted-foreground">{account.maskedIdentifier}</p><p className="text-xs text-muted-foreground">Session {account.sessionDate}</p></TableCell>
                      <TableCell>{account.classification}<p className="text-xs text-muted-foreground">{account.classificationDetail}</p></TableCell>
                      <TableCell><MoneyValue value={account.dailyRealized} /></TableCell>
                      <TableCell><MoneyValue value={account.dailyUnrealized} /></TableCell>
                      <TableCell><MoneyValue value={account.dailyTotal} /></TableCell>
                      <TableCell><MoneyValue value={account.nativeLifetime} /></TableCell>
                      <TableCell><MoneyValue value={account.managerObserved} /><p className="mt-1 text-xs text-muted-foreground">Observed since {account.managerObservedSince}</p></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Bot className="size-5" aria-hidden="true" />Exact current strategy stack</CardTitle>
          <CardDescription>Snapshot-time strategy membership and state. This is evidence only; no enable or disable control is present.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {model.accounts.length === 0 ? <p className="text-sm text-muted-foreground">No account stack can be shown without retained account evidence.</p> : model.accounts.map((account) => (
            <div key={account.key} className="rounded-md border p-4">
              <div className="mb-3"><p className="font-medium">{account.label}</p><p className="font-mono text-xs text-muted-foreground">{account.maskedIdentifier}</p></div>
              {account.strategies.length === 0 ? <p className="text-sm text-muted-foreground">No strategy rows were retained for this account.</p> : (
                <div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Strategy</TableHead><TableHead>Instrument</TableHead><TableHead>Enabled</TableHead><TableHead>Runtime</TableHead><TableHead>Synchronization</TableHead></TableRow></TableHeader><TableBody>
                  {account.strategies.map((strategy) => <TableRow key={strategy.key}><TableCell className="font-medium">{strategy.label}<p className="text-xs text-muted-foreground">{strategy.strategyType}</p></TableCell><TableCell>{strategy.instrument}</TableCell><TableCell>{strategy.enabled}</TableCell><TableCell><StatusBadge status={strategy.runtimeState} /></TableCell><TableCell><StatusBadge status={strategy.synchronizationState} /></TableCell></TableRow>)}
                </TableBody></Table></div>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Recent EOD history</CardTitle><CardDescription>Newest immutable snapshots first.</CardDescription></CardHeader>
        <CardContent>
          <div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Intended date</TableHead><TableHead>Captured</TableHead><TableHead>Completeness</TableHead><TableHead>Accounts</TableHead><TableHead>Strategies</TableHead></TableRow></TableHeader><TableBody>
            {summaries.map((summary) => <TableRow key={summary.key}><TableCell>{summary.intendedDate}</TableCell><TableCell>{summary.capturedAt}</TableCell><TableCell><StatusBadge status={summary.completeness} /></TableCell><TableCell>{summary.accountCount}</TableCell><TableCell>{summary.strategyCount}</TableCell></TableRow>)}
          </TableBody></Table></div>
        </CardContent>
      </Card>
    </div>
  );
}
