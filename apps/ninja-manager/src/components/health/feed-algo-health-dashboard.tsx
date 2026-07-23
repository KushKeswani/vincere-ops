import { Activity, AlertTriangle, BookOpenCheck, Cable, ShieldAlert } from "lucide-react";

import { StatusBadge } from "@/components/status-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { FeedAlgoHealthObservationInput } from "@/lib/domain/feed-algo-health";

import { buildFeedAlgoHealthDisplayModel } from "./feed-algo-health-view-model";

interface FeedAlgoHealthDashboardProps {
  current: FeedAlgoHealthObservationInput | null;
  prior?: FeedAlgoHealthObservationInput | null;
  now: Date | string;
  installationLabel?: string;
}

export function FeedAlgoHealthDashboard({ current, prior = null, now, installationLabel = "Local NinjaTrader installation" }: FeedAlgoHealthDashboardProps) {
  const model = buildFeedAlgoHealthDisplayModel({ current, prior, now });
  return (
    <section className="space-y-6" aria-labelledby="feed-algo-health-title">
      <div>
        <p className="text-sm font-medium text-primary">Feed &amp; Algo Health</p>
        <h3 id="feed-algo-health-title" className="text-2xl font-semibold tracking-tight">Read-only diagnosis for {installationLabel}</h3>
        <p className="mt-2 max-w-4xl text-sm text-muted-foreground">
          Deterministic Runtime v2 analysis separates provider order status from price-feed status and never treats a connected state as proof that strategies recovered.
        </p>
      </div>

      <Alert variant={model.severity === "critical" ? "destructive" : "default"}>
        {model.severity === "critical" ? <ShieldAlert className="size-4" aria-hidden="true" /> : <Activity className="size-4" aria-hidden="true" />}
        <AlertTitle>{model.statusLabel}</AlertTitle>
        <AlertDescription>
          {model.blockerCodes.length} fail-closed blocker{model.blockerCodes.length === 1 ? "" : "s"}; diagnosis uses only the latest authorized observation and optional prior observation.
        </AlertDescription>
      </Alert>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <Card><CardHeader><CardDescription>Observation</CardDescription><CardTitle className="capitalize">{model.observationStatus}</CardTitle></CardHeader><CardContent><StatusBadge status={model.observationStatus} /></CardContent></Card>
        <Card><CardHeader><CardDescription>Overall diagnosis</CardDescription><CardTitle>{model.statusLabel}</CardTitle></CardHeader><CardContent><StatusBadge status={model.severity} /></CardContent></Card>
        <Card><CardHeader><CardDescription>Runtime as of</CardDescription><CardTitle className="text-base">{model.observedAt}</CardTitle></CardHeader><CardContent><p className="text-xs text-muted-foreground">{model.sourceLabel}</p></CardContent></Card>
        <Card><CardHeader><CardDescription>Event occurred</CardDescription><CardTitle className="text-base">{model.occurredAt}</CardTitle></CardHeader><CardContent><p className="text-xs text-muted-foreground">Authenticated envelope time</p></CardContent></Card>
        <Card><CardHeader><CardDescription>Manager receipt</CardDescription><CardTitle className="text-base">{model.receivedAt}</CardTitle></CardHeader><CardContent><p className="text-xs text-muted-foreground">Authenticated durable evidence</p></CardContent></Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><AlertTriangle className="size-5" aria-hidden="true" />Diagnostic findings</CardTitle>
          <CardDescription>{model.counts.critical} critical, {model.counts.warning} warning, and {model.counts.info} informational finding{model.findings.length === 1 ? "" : "s"}.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {model.findings.map((row, index) => (
            <article key={`${row.code}-${index}`} className="rounded-md border p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div><p className="font-medium">{row.title}</p><p className="mt-1 text-sm text-muted-foreground">{row.summary}</p></div>
                <StatusBadge status={row.severityLabel} />
              </div>
              {row.evidence.length > 0 && <div className="mt-3"><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Evidence</p><ul className="mt-1 list-disc space-y-1 pl-5 text-sm">{row.evidence.map((item) => <li key={item}>{item}</li>)}</ul></div>}
              {row.blockerCodes.length > 0 && <p className="mt-3 break-words font-mono text-xs text-destructive">Blocker: {row.blockerCodes.join(", ")}</p>}
              {row.guidedSteps.length > 0 && <div className="mt-3"><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Guided checks</p><ol className="mt-1 list-decimal space-y-1 pl-5 text-sm">{row.guidedSteps.map((step) => <li key={step}>{step}</li>)}</ol></div>}
            </article>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><Cable className="size-5" aria-hidden="true" />Interpretation limits</CardTitle><CardDescription>Runtime v2 is display and reconciliation evidence, not an actuation preflight.</CardDescription></CardHeader>
        <CardContent><ul className="list-disc space-y-2 pl-5 text-sm text-muted-foreground">{model.limitations.map((item) => <li key={item}>{item}</li>)}</ul></CardContent>
      </Card>

      <Alert>
        <BookOpenCheck className="size-4" aria-hidden="true" />
        <AlertTitle>Operator-guided only</AlertTitle>
        <AlertDescription>This surface has no process, connection, strategy, order, position, database, credential, or network controls.</AlertDescription>
      </Alert>
    </section>
  );
}
