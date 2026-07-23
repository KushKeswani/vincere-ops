import { randomUUID } from "node:crypto";

import { notFound } from "next/navigation";
import { LockKeyhole, ShieldCheck, TriangleAlert } from "lucide-react";

import { EodSnapshotDashboard } from "@/components/eod/eod-snapshot-dashboard";
import { isRuntimeObservationCaptureReady } from "@/components/eod/eod-snapshot-view-model";
import { EodCaptureForm, type EodCaptureAgentOption } from "@/components/forms/eod-capture-form";
import { SimulationForm } from "@/components/forms/simulation-form";
import { FeedAlgoHealthDashboard } from "@/components/health/feed-algo-health-dashboard";
import { selectLatestFeedAlgoHealthSource } from "@/components/health/feed-algo-health-view-model";
import { StatusBadge } from "@/components/status-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireUser } from "@/lib/auth/session";
import { getDeploymentProfile } from "@/lib/deployment/server";
import type { EodSnapshot, EodSnapshotSummary } from "@/lib/domain/eod-snapshot-contracts";
import type { FeedAlgoHealthObservationInput } from "@/lib/domain/feed-algo-health";
import { formatDate } from "@/lib/format";
import { getEodSnapshotRepository } from "@/lib/repositories/eod-snapshot-repository";
import { getNinjaRepository } from "@/lib/repositories/ninja-repository";
import { getRuntimeRepository } from "@/lib/repositories/runtime-repository";

export default async function ClientActivityPage() {
  const user = await requireUser(["client"]);
  const profile = getDeploymentProfile();
  const repository = getNinjaRepository();
  const client = await repository.getClientForUser(user);
  if (!client) notFound();
  const [incidents, audit, environments] = await Promise.all([
    repository.listIncidents(user, client.id),
    repository.listAudit(user, client.id),
    repository.getEnvironments(client.id, user.organizationId),
  ]);

  const localOnly = profile.mode === "LOCAL_ONLY";
  let captureAgents: EodCaptureAgentOption[] = [];
  let latestSnapshot: EodSnapshot | null = null;
  let snapshotHistory: EodSnapshotSummary[] = [];
  let healthObservation: FeedAlgoHealthObservationInput | null = null;
  let healthInstallationLabel = "Local NinjaTrader installation";
  const healthAnalysisAt = new Date();
  let eodReadError = false;
  if (localOnly) {
    try {
      const healthRuntimeRepository = getRuntimeRepository();
      const healthAgents = await healthRuntimeRepository.listAgents(user);
      const healthLatestByAgent = await Promise.all(
        healthAgents.map((agent) => healthRuntimeRepository.getLatestRuntimeObservationV2(user, agent.id)),
      );
      const selectedHealthSource = selectLatestFeedAlgoHealthSource(
        healthLatestByAgent.flatMap((latest, index) => latest ? [{
          installationLabel: healthAgents[index].displayName,
          current: { observation: latest.observation, occurredAt: latest.occurredAt, receivedAt: latest.receivedAt },
        }] : []),
      );
      if (selectedHealthSource) {
        healthObservation = selectedHealthSource.current;
        healthInstallationLabel = selectedHealthSource.installationLabel;
      }
    } catch {
      healthObservation = null;
    }

    try {
      const runtimeRepository = getRuntimeRepository();
      const eodRepository = getEodSnapshotRepository();
      const agents = await runtimeRepository.listAgents(user);
      const [latestByAgent, history] = await Promise.all([
        Promise.all(agents.map((agent) => runtimeRepository.getLatestRuntimeObservationV2(user, agent.id))),
        eodRepository.listSnapshots(user, { limit: 20 }),
      ]);
      const now = new Date();
      captureAgents = agents.map((agent, index) => {
        const latest = latestByAgent[index];
        const captureReady = isRuntimeObservationCaptureReady(latest, now);
        return {
          id: agent.id,
          label: agent.displayName + " (" + agent.effectiveStatus + ")",
          captureReady,
          readiness: captureReady
            ? "Fresh authenticated Runtime v2 evidence is available. The repository will verify it again at capture time."
            : latest
              ? "The latest Runtime v2 evidence is not within the strict 45-second capture window. Refresh runtime evidence first."
              : "No authenticated Runtime v2 observation exists for this installation.",
        };
      });
      snapshotHistory = history;
      latestSnapshot = history[0]
        ? await eodRepository.getSnapshot(user, history[0].snapshotId)
        : null;
    } catch {
      eodReadError = true;
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <p className="text-sm text-primary">Day operations</p>
        <h2 className="text-3xl font-semibold">Evidence-backed daily record</h2>
        <p className="mt-2 text-muted-foreground">Capture end-of-day account P&amp;L and exact strategy stacks, then retain the existing incident and audit history below.</p>
      </div>

      {localOnly ? (
        <>
          <Alert>
            <ShieldCheck className="size-4" aria-hidden="true" />
            <AlertTitle>Private local EOD capture</AlertTitle>
            <AlertDescription>Fresh state is read from the authenticated Runtime v2 event on Edith and retained immutably. Capture never places, cancels, enables, disables, launches, quits, or reconnects anything.</AlertDescription>
          </Alert>
          {eodReadError ? (
            <Alert variant="destructive">
              <TriangleAlert className="size-4" aria-hidden="true" />
              <AlertTitle>EOD evidence is unavailable</AlertTitle>
              <AlertDescription>The local EOD store or Runtime v2 evidence could not be verified. No capture was attempted.</AlertDescription>
            </Alert>
          ) : (
            <>
              <Card>
                <CardHeader><CardTitle>Manual EOD capture</CardTitle><CardDescription>Server-derived America/New_York date, fresh source event, P&amp;L, and stack only.</CardDescription></CardHeader>
                <CardContent><EodCaptureForm agents={captureAgents} requestId={randomUUID()} /></CardContent>
              </Card>
              <EodSnapshotDashboard latest={latestSnapshot} history={snapshotHistory} />
            </>
          )}
        </>
      ) : (
        <Alert>
          <LockKeyhole className="size-4" aria-hidden="true" />
          <AlertTitle>Client-private evidence</AlertTitle>
          <AlertDescription>EOD and Runtime v2 evidence stay hidden from the central CSM workspace. Client-issued, session-scoped OTP access is deferred and no central repository read was attempted.</AlertDescription>
        </Alert>
      )}

      {localOnly && (
        <FeedAlgoHealthDashboard
          current={healthObservation}
          now={healthAnalysisAt}
          installationLabel={healthInstallationLabel}
        />
      )}

      <Card>
        <CardHeader><CardTitle>Safety simulation</CardTitle><CardDescription>Prove the incident workflow using the simulated VPS adapter.</CardDescription></CardHeader>
        <CardContent>{environments.length ? <SimulationForm requestId={randomUUID()} /> : <p className="text-sm text-muted-foreground">Register an environment before running the simulation.</p>}</CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Guided incidents</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          {incidents.length === 0 ? <p className="text-sm text-muted-foreground">No incidents recorded.</p> : incidents.map((incident) => (
            <div key={incident.id} className="rounded-md border p-4">
              <div className="flex items-start justify-between gap-3"><div><p className="font-medium">{incident.title}</p><p className="mt-1 text-sm text-muted-foreground">{incident.description}</p></div><StatusBadge status={incident.status} /></div>
              <ol className="mt-4 space-y-2 text-sm">{incident.resolution_steps.map((step, index) => <li key={step} className={index < incident.current_step ? "text-muted-foreground line-through" : ""}>{index + 1}. {step}</li>)}</ol>
            </div>
          ))}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Audit timeline</CardTitle></CardHeader>
        <CardContent className="divide-y">
          {audit.length === 0 ? <p className="text-sm text-muted-foreground">No activity yet.</p> : audit.map((event) => (
            <div key={event.id} className="flex flex-col justify-between gap-1 py-3 sm:flex-row"><div><p className="text-sm font-medium">{event.action.replaceAll(".", " ")}</p><p className="font-mono text-xs text-muted-foreground">{event.entity_type} · {event.entity_id.slice(0, 8)}</p></div><p className="text-xs text-muted-foreground">{formatDate(event.created_at)}</p></div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
