import {
  Activity,
  AlertTriangle,
  Bot,
  Cable,
  Database,
  DollarSign,
  HardDrive,
  ListChecks,
} from "lucide-react";

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

import {
  buildRuntimeObservationV2DisplayModel,
  type MoneyDisplay,
  type RuntimeObservationV2DisplayInput,
  type RuntimeScopeDisplay,
} from "./runtime-observation-view-model";

interface RuntimeObservationV2DashboardProps {
  latest: RuntimeObservationV2DisplayInput;
}

function emptyScopeMessage(scope: RuntimeScopeDisplay, noun: string): string {
  if (scope.status === "complete") return `The complete ${scope.label.toLowerCase()} collection reported no ${noun}.`;
  if (scope.status === "unavailable") return `${scope.label} were unavailable in this observation.`;
  return `The partial ${scope.label.toLowerCase()} collection provided no ${noun}; absence is not proof that none exist.`;
}

function OmittedRows({ omitted }: { omitted: number }) {
  if (omitted === 0) return null;
  return <p className="mt-3 text-xs text-muted-foreground">Showing the first 100 rows; {omitted} additional row{omitted === 1 ? " is" : "s are"} omitted.</p>;
}

function MoneyCell({ value }: { value: MoneyDisplay }) {
  return (
    <div>
      <p className={value.available ? "font-mono font-medium" : "font-medium text-amber-700 dark:text-amber-400"}>
        {value.primary}
      </p>
      <p className="text-xs text-muted-foreground">{value.detail}</p>
    </div>
  );
}

export function RuntimeObservationV2Dashboard({ latest }: RuntimeObservationV2DashboardProps) {
  const model = buildRuntimeObservationV2DisplayModel(latest);
  const scopes = new Map(model.scopes.map((scope) => [scope.key, scope]));
  const scope = (key: RuntimeScopeDisplay["key"]) => scopes.get(key)!;

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm font-medium text-primary">Authoritative read-only source</p>
        <h3 className="text-2xl font-semibold tracking-tight">{model.sourceLabel}</h3>
        <p className="mt-2 max-w-4xl text-sm text-muted-foreground">
          This view renders one authenticated v2 observation without filling gaps from blueprints, fixtures, or the legacy runtime snapshot.
        </p>
      </div>

      {(model.overall !== "complete" || model.freshness !== "fresh") && (
        <Alert variant="destructive">
          <AlertTriangle className="size-4" aria-hidden="true" />
          <AlertTitle>Runtime evidence has limitations</AlertTitle>
          <AlertDescription>
            Overall collection is {model.overall} and freshness is {model.freshness}. Review every scope and error below;
            this observation does not establish control readiness or safety.
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardHeader><CardDescription>Overall collection</CardDescription><CardTitle className="mt-1 capitalize">{model.overall}</CardTitle></CardHeader>
          <CardContent><StatusBadge status={model.overall} /></CardContent>
        </Card>
        <Card>
          <CardHeader><CardDescription>Freshness now</CardDescription><CardTitle className="mt-1 capitalize">{model.freshness}</CardTitle></CardHeader>
          <CardContent><StatusBadge status={model.freshness} /><p className="mt-2 text-xs text-muted-foreground">{model.freshnessDetail}</p></CardContent>
        </Card>
        <Card>
          <CardHeader><CardDescription>Runtime as of</CardDescription><CardTitle className="mt-1 text-base">{model.asOf}</CardTitle></CardHeader>
          <CardContent><p className="text-xs text-muted-foreground">Authoritative observation timestamp</p></CardContent>
        </Card>
        <Card>
          <CardHeader><CardDescription>Evidence received</CardDescription><CardTitle className="mt-1 text-base">{model.receivedAt}</CardTitle></CardHeader>
          <CardContent><p className="text-xs text-muted-foreground">Durable manager receipt timestamp</p></CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <div><CardTitle>NinjaTrader process</CardTitle><CardDescription>Privacy-safe process health; no process identifier is displayed.</CardDescription></div>
            <HardDrive className="size-5 text-primary" aria-hidden="true" />
          </CardHeader>
          <CardContent>
            {model.process === null ? (
              <p className="text-sm text-muted-foreground">{emptyScopeMessage(scope("process"), "process observation")}</p>
            ) : (
              <dl className="grid gap-3 text-sm sm:grid-cols-2">
                <div><dt className="text-muted-foreground">Status</dt><dd className="mt-1"><StatusBadge status={model.process.status} /></dd></div>
                <div><dt className="text-muted-foreground">Health</dt><dd className="mt-1"><StatusBadge status={model.process.health} /></dd></div>
                <div><dt className="text-muted-foreground">Version</dt><dd className="mt-1 font-medium">{model.process.version}</dd></div>
                <div><dt className="text-muted-foreground">Started</dt><dd className="mt-1 font-medium">{model.process.startedAt}</dd></div>
              </dl>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <div><CardTitle>NinjaTrader Add-On</CardTitle><CardDescription>Authenticated IPC state and reported capability codes.</CardDescription></div>
            <Cable className="size-5 text-primary" aria-hidden="true" />
          </CardHeader>
          <CardContent>
            {model.addon === null ? (
              <p className="text-sm text-muted-foreground">{emptyScopeMessage(scope("addon"), "Add-On observation")}</p>
            ) : (
              <div className="space-y-3 text-sm">
                <div className="flex flex-wrap gap-2"><StatusBadge status={model.addon.status} /><StatusBadge status={model.addon.health} /></div>
                <dl className="grid gap-3 sm:grid-cols-2">
                  <div><dt className="text-muted-foreground">Version</dt><dd className="mt-1 font-medium">{model.addon.version}</dd></div>
                  <div><dt className="text-muted-foreground">IPC evidence</dt><dd className="mt-1 font-medium">{model.addon.ipc}</dd></div>
                </dl>
                <div><p className="text-muted-foreground">Capabilities</p><p className="mt-1 break-words font-medium">{model.addon.capabilities.join(", ") || "None reported"}</p></div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><ListChecks className="size-5" aria-hidden="true" />Collection coverage</CardTitle>
          <CardDescription>Every scope reports its own completeness, observed row count, and typed collection errors.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {model.scopes.map((row) => (
              <div key={row.key} className="rounded-md border p-3 text-sm">
                <div className="flex items-center justify-between gap-2"><p className="font-medium">{row.label}</p><StatusBadge status={row.status} /></div>
                <p className="mt-2 text-muted-foreground">{row.itemCount} observed item{row.itemCount === 1 ? "" : "s"}</p>
                {row.issues.map((issue) => <p key={issue} className="mt-1 text-xs text-destructive">{issue}</p>)}
              </div>
            ))}
          </div>
          {model.collectionIssues.length > 0 && (
            <div className="mt-4 rounded-md border border-destructive/40 bg-destructive/5 p-3">
              <p className="text-sm font-medium">Collection errors</p>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                {model.collectionIssues.map((issue) => <li key={issue}>{issue}</li>)}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Connections</CardTitle><CardDescription>Connection, provider, market-data, status, and health evidence reported by the Add-On.</CardDescription></CardHeader>
        <CardContent>
          {model.connections.rows.length === 0 ? <p className="text-sm text-muted-foreground">{emptyScopeMessage(scope("connections"), "connections")}</p> : (
            <div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Connection</TableHead><TableHead>Kind / provider</TableHead><TableHead>Status</TableHead><TableHead>Health</TableHead><TableHead>Market data</TableHead><TableHead>Changed</TableHead></TableRow></TableHeader><TableBody>
              {model.connections.rows.map((row) => <TableRow key={row.label}><TableCell className="font-medium">{row.label}</TableCell><TableCell>{row.kind}<p className="text-xs text-muted-foreground">{row.provider}</p></TableCell><TableCell><StatusBadge status={row.status} /></TableCell><TableCell><StatusBadge status={row.health} /></TableCell><TableCell className="capitalize">{row.marketData}</TableCell><TableCell>{row.changedAt}</TableCell></TableRow>)}
            </TableBody></Table></div>
          )}
          <OmittedRows omitted={model.connections.omitted} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><Database className="size-5" aria-hidden="true" />Accounts</CardTitle><CardDescription>Only masked identifiers are displayed. Unknown classification stays unknown with its reason.</CardDescription></CardHeader>
        <CardContent>
          {model.accounts.rows.length === 0 ? <p className="text-sm text-muted-foreground">{emptyScopeMessage(scope("accounts"), "accounts")}</p> : (
            <div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Account</TableHead><TableHead>Masked identifier</TableHead><TableHead>Classification</TableHead><TableHead>Connections</TableHead><TableHead>Status</TableHead></TableRow></TableHeader><TableBody>
              {model.accounts.rows.map((row) => <TableRow key={`${row.label}-${row.maskedIdentifier}`}><TableCell className="font-medium">{row.label}</TableCell><TableCell className="font-mono">{row.maskedIdentifier}</TableCell><TableCell>{row.classification}<p className="text-xs text-muted-foreground">{row.classificationDetail}</p></TableCell><TableCell>{row.connections}</TableCell><TableCell><StatusBadge status={row.status} /></TableCell></TableRow>)}
            </TableBody></Table></div>
          )}
          <OmittedRows omitted={model.accounts.omitted} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><Bot className="size-5" aria-hidden="true" />Strategies</CardTitle><CardDescription>Observed enablement, runtime, synchronization, and safe operational parameters. No controls are exposed here.</CardDescription></CardHeader>
        <CardContent>
          {model.strategies.rows.length === 0 ? <p className="text-sm text-muted-foreground">{emptyScopeMessage(scope("strategies"), "strategies")}</p> : (
            <div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Strategy / type</TableHead><TableHead>Masked account</TableHead><TableHead>Instrument</TableHead><TableHead>Enabled</TableHead><TableHead>Runtime</TableHead><TableHead>Sync</TableHead><TableHead>Parameters</TableHead><TableHead>Changed</TableHead></TableRow></TableHeader><TableBody>
              {model.strategies.rows.map((row) => <TableRow key={`${row.label}-${row.account}-${row.strategyType}`}><TableCell className="font-medium">{row.label}<p className="text-xs text-muted-foreground">{row.strategyType}</p></TableCell><TableCell className="font-mono text-xs">{row.account}</TableCell><TableCell>{row.instrument}</TableCell><TableCell>{row.enabled}</TableCell><TableCell><StatusBadge status={row.runtimeState} /></TableCell><TableCell><StatusBadge status={row.synchronizationState} /></TableCell><TableCell className="max-w-80 whitespace-normal break-words text-xs">{row.parameters}</TableCell><TableCell>{row.changedAt}</TableCell></TableRow>)}
            </TableBody></Table></div>
          )}
          <OmittedRows omitted={model.strategies.omitted} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Positions</CardTitle><CardDescription>Non-flat positions observed by NinjaTrader; absence is conclusive only when this scope is complete.</CardDescription></CardHeader>
        <CardContent>
          {model.positions.rows.length === 0 ? <p className="text-sm text-muted-foreground">{emptyScopeMessage(scope("positions"), "positions")}</p> : (
            <div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Masked account</TableHead><TableHead>Strategy</TableHead><TableHead>Instrument</TableHead><TableHead>Side</TableHead><TableHead>Quantity</TableHead><TableHead>Average</TableHead><TableHead>Mark</TableHead></TableRow></TableHeader><TableBody>
              {model.positions.rows.map((row, index) => <TableRow key={`${row.account}-${row.instrument}-${row.side}-${index}`}><TableCell className="font-mono text-xs">{row.account}</TableCell><TableCell>{row.strategy}</TableCell><TableCell>{row.instrument}</TableCell><TableCell className="capitalize">{row.side}</TableCell><TableCell>{row.quantity}</TableCell><TableCell>{row.averagePrice}</TableCell><TableCell>{row.markPrice}</TableCell></TableRow>)}
            </TableBody></Table></div>
          )}
          <OmittedRows omitted={model.positions.omitted} />
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-2">
        {([
          ["Working orders", model.workingOrders, "orders currently reported in a working lifecycle"],
          ["Completed orders", model.completedOrders, "orders currently reported in a completed lifecycle"],
        ] as const).map(([title, orders, noun]) => (
          <Card key={title}>
            <CardHeader><CardTitle>{title}</CardTitle><CardDescription>Read-only order evidence; no manual order or cancel actions are available.</CardDescription></CardHeader>
            <CardContent>
              {orders.rows.length === 0 ? <p className="text-sm text-muted-foreground">{emptyScopeMessage(scope("orders"), noun)}</p> : (
                <div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Account / strategy</TableHead><TableHead>Order</TableHead><TableHead>Fill</TableHead><TableHead>Prices</TableHead><TableHead>Time</TableHead></TableRow></TableHeader><TableBody>
                  {orders.rows.map((row, index) => <TableRow key={`${title}-${row.account}-${row.instrument}-${row.submittedAt}-${index}`}><TableCell className="font-mono text-xs">{row.account}<p className="font-sans text-xs text-muted-foreground">{row.strategy}</p></TableCell><TableCell>{row.instrument} · {row.side} · {row.orderType}<p className="text-xs text-muted-foreground">{row.state}</p></TableCell><TableCell>{row.quantity}</TableCell><TableCell>{row.prices}</TableCell><TableCell>{row.submittedAt}{row.completedAt !== "Not reported" && <p className="text-xs text-muted-foreground">Completed {row.completedAt}</p>}</TableCell></TableRow>)}
                </TableBody></Table></div>
              )}
              <OmittedRows omitted={orders.omitted} />
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><Activity className="size-5" aria-hidden="true" />Recent executions</CardTitle><CardDescription>Newest observed execution time first; up to 100 rows.</CardDescription></CardHeader>
        <CardContent>
          {model.executions.rows.length === 0 ? <p className="text-sm text-muted-foreground">{emptyScopeMessage(scope("executions"), "executions")}</p> : (
            <div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Executed</TableHead><TableHead>Masked account</TableHead><TableHead>Strategy</TableHead><TableHead>Instrument</TableHead><TableHead>Side / quantity</TableHead><TableHead>Price</TableHead><TableHead>Commission</TableHead></TableRow></TableHeader><TableBody>
              {model.executions.rows.map((row, index) => <TableRow key={`${row.executedAt}-${row.account}-${row.instrument}-${index}`}><TableCell>{row.executedAt}</TableCell><TableCell className="font-mono text-xs">{row.account}</TableCell><TableCell>{row.strategy}</TableCell><TableCell>{row.instrument}</TableCell><TableCell className="capitalize">{row.side} · {row.quantity}</TableCell><TableCell>{row.price}</TableCell><TableCell>{row.commission}</TableCell></TableRow>)}
            </TableBody></Table></div>
          )}
          <OmittedRows omitted={model.executions.omitted} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><DollarSign className="size-5" aria-hidden="true" />Account P&amp;L</CardTitle><CardDescription>USD minor-unit evidence by session. Unavailable values show a reason and are never rendered as zero.</CardDescription></CardHeader>
        <CardContent>
          {model.pnl.rows.length === 0 ? <p className="text-sm text-muted-foreground">{emptyScopeMessage(scope("pnl"), "P&L observations")}</p> : (
            <div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Account / session</TableHead><TableHead>Daily realized</TableHead><TableHead>Daily unrealized</TableHead><TableHead>Daily total</TableHead><TableHead>Native lifetime</TableHead><TableHead>Manager cumulative</TableHead></TableRow></TableHeader><TableBody>
              {model.pnl.rows.map((row) => <TableRow key={`${row.account}-${row.sessionDate}`}><TableCell className="font-mono text-xs">{row.account}<p className="font-sans text-xs text-muted-foreground">{row.sessionDate}</p></TableCell><TableCell><MoneyCell value={row.realized} /></TableCell><TableCell><MoneyCell value={row.unrealized} /></TableCell><TableCell><MoneyCell value={row.total} /></TableCell><TableCell><MoneyCell value={row.nativeLifetime} /></TableCell><TableCell><MoneyCell value={row.managerCumulative} /><p className="mt-1 text-xs text-muted-foreground">Since {row.managerObservedSince}</p></TableCell></TableRow>)}
            </TableBody></Table></div>
          )}
          <OmittedRows omitted={model.pnl.omitted} />
        </CardContent>
      </Card>
    </div>
  );
}
