import { randomUUID } from "node:crypto";

import { notFound } from "next/navigation";
import { CheckCircle2, Clock3, ShieldCheck, TriangleAlert } from "lucide-react";

import { requireUser } from "@/lib/auth/session";
import { getDeploymentProfile } from "@/lib/deployment/server";
import { getBlueprintAssignmentRepository } from "@/lib/repositories/blueprint-assignment-repository";
import { getNinjaRepository } from "@/lib/repositories/ninja-repository";
import { getRuntimeRepository } from "@/lib/repositories/runtime-repository";
import { toSafeBlueprintRevisionSummary } from "@/components/forms/blueprint-assignment-view-model";
import {
  BlueprintPreviewForm,
  BlueprintRecentRevisions,
  type BlueprintRecentRevisionItem,
} from "@/components/forms/blueprint-preview-form";
import { buildBlueprintMappingEvidence } from "@/components/forms/blueprint-preview-view-model";
import { DeploymentForm } from "@/components/forms/deployment-form";
import { StatusBadge } from "@/components/status-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default async function ClientStrategyPage() {
  const user = await requireUser(["client"]);
  const profile = getDeploymentProfile();
  const repository = getNinjaRepository();
  const client = await repository.getClientForUser(user);
  if (!client) notFound();
  const [accounts, configurations] = await Promise.all([
    repository.getAccounts(client.id, user.organizationId),
    repository.getConfigurations(client.id, user.organizationId),
  ]);
  const localOnly = profile.mode === "LOCAL_ONLY";
  let mappingEvidence = buildBlueprintMappingEvidence(null);
  let selectedAgentId: string | null = null;
  let recentRevisions: BlueprintRecentRevisionItem[] = [];
  let revisionHistoryUnavailable: string | null = null;
  if (localOnly) {
    try {
      const revisions = await getBlueprintAssignmentRepository().listRecentRevisions(user, 10);
      recentRevisions = revisions.map((revision) => ({
        revision: toSafeBlueprintRevisionSummary(revision),
        approvalRequestId: randomUUID(),
      }));
    } catch {
      revisionHistoryUnavailable = "The tenant-scoped Blueprint revision store is unavailable. No draft or approval was changed.";
    }
    try {
      const runtimeRepository = getRuntimeRepository();
      const agents = await runtimeRepository.listAgents(user);
      const selectedAgent = agents.find((agent) =>
        agent.effectiveStatus === "online"
        && agent.addonConnected === true
        && agent.capabilities.includes("runtime.discovery"),
      ) ?? agents.find((agent) => agent.effectiveStatus === "online") ?? agents[0] ?? null;
      selectedAgentId = selectedAgent?.id ?? null;
      const latest = selectedAgent
        && selectedAgent.effectiveStatus === "online"
        && selectedAgent.addonConnected === true
        ? await runtimeRepository.getLatestRuntimeObservationV2(user, selectedAgent.id)
        : null;
      mappingEvidence = buildBlueprintMappingEvidence(latest);
    } catch {
      mappingEvidence = {
        accountOptions: [],
        mappingLockedReason: "Authoritative Runtime-v2 account evidence is unavailable from the selected local agent.",
      };
    }
  }

  return <div className="space-y-8"><div><p className="text-sm text-primary">Blueprint workspace</p><h2 className="text-3xl font-semibold">Map algorithms to accounts</h2><p className="mt-2 text-muted-foreground">Import the operating blueprint, review account and algorithm assignments, save an immutable mapping draft, then approve it against fresh authoritative SIM evidence.</p></div>
    {localOnly && <Alert><ShieldCheck className="size-4" aria-hidden="true" /><AlertTitle>Local automation gate</AlertTitle><AlertDescription>This dashboard is local and login-free on 127.0.0.1. Live strategy enabling, connection reconnects, and recovery actions are still disabled until the NinjaTrader Add-On is installed and verified in SIM.</AlertDescription></Alert>}
    {mappingEvidence.accountOptions.length === 0 && <Alert><TriangleAlert className="size-4" /><AlertTitle>Authoritative account mapping is not ready</AlertTitle><AlertDescription>{mappingEvidence.mappingLockedReason}</AlertDescription></Alert>}

    <BlueprintPreviewForm
      accountOptions={mappingEvidence.accountOptions}
      mappingLockedReason={mappingEvidence.mappingLockedReason}
      selectedAgentId={selectedAgentId}
      uploadRequestId={randomUUID()}
      uploadEnabled={localOnly}
    />

    {localOnly && (
      <BlueprintRecentRevisions
        items={recentRevisions}
        unavailableReason={revisionHistoryUnavailable}
      />
    )}

    <Card>
      <CardHeader><CardTitle>Existing staged configurations</CardTitle><CardDescription>These database rows are separate from the unsaved workbook preview above.</CardDescription></CardHeader>
      <CardContent className="space-y-3">
        {configurations.length === 0 ? <p className="text-sm text-muted-foreground">No staged algorithm assignments yet.</p> : configurations.map((configuration) => {
          const config = configuration.configuration as Record<string, unknown>;
          const validation = configuration.validation as { checks?: Array<{ key: string; status: string; message: string }> };
          return <div key={configuration.id} className="rounded-md border p-4"><div className="flex flex-wrap items-center justify-between gap-2"><div><p className="font-medium">{configuration.strategy_name} v{configuration.version}</p><p className="text-sm text-muted-foreground">{configuration.strategy_description}</p></div><StatusBadge status={configuration.status} /></div>
            <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-4"><div><dt className="text-muted-foreground">Contracts</dt><dd className="font-mono">{String(config.contracts ?? "-")}</dd></div><div><dt className="text-muted-foreground">Daily loss</dt><dd className="font-mono">${Number(config.dailyLossLimit ?? 0).toLocaleString()}</dd></div><div><dt className="text-muted-foreground">Enable time</dt><dd className="font-mono">Not scheduled</dd></div><div><dt className="text-muted-foreground">Account</dt><dd className="font-mono">{accounts[0]?.account_identifier_masked ?? "Pending scan"}</dd></div></dl>
            <div className="mt-4 space-y-2">{validation.checks?.map((check) => <div key={check.key} className="flex items-start gap-2 text-sm">{check.status === "pass" ? <CheckCircle2 className="mt-0.5 size-4 text-primary" /> : <TriangleAlert className="mt-0.5 size-4 text-amber-400" />}<span>{check.message}</span></div>)}</div>
            {configuration.status === "approved" && <div className="mt-4 rounded-md border border-primary/30 bg-primary/5 p-4"><div className="mb-3 flex items-center gap-2 text-sm font-medium"><Clock3 className="size-4 text-primary" />Deployment record is still a dry audit marker, not strategy activation</div><DeploymentForm configurationId={configuration.id} requestId={randomUUID()} /></div>}
          </div>;
        })}
      </CardContent>
    </Card>
  </div>;
}
