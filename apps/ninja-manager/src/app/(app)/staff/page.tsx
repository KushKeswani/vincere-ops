import { randomUUID } from "node:crypto";

import Link from "next/link";
import { AlertTriangle, ArrowRight, ShieldAlert, ShieldCheck, Users } from "lucide-react";

import { requireUser } from "@/lib/auth/session";
import { getNinjaRepository } from "@/lib/repositories/ninja-repository";
import { KillSwitchForm } from "@/components/forms/kill-switch-form";
import { StatusBadge } from "@/components/status-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default async function StaffDashboardPage() {
  const user = await requireUser(["staff"]);
  const repository = getNinjaRepository();
  const [clients, approvals, incidents, killSwitch] = await Promise.all([
    repository.listClients(user), repository.listApprovals(user), repository.listIncidents(user), repository.getKillSwitch(user.organizationId),
  ]);
  const pendingApprovals = approvals.filter((approval) => approval.status === "pending");
  const openIncidents = incidents.filter((incident) => incident.status !== "resolved");
  const onboarded = clients.filter((client) => client.onboarding_status === "complete").length;
  return <div className="space-y-8"><div><p className="text-sm text-primary">Staff operations</p><h2 className="text-3xl font-semibold">The work that matters today</h2><p className="mt-2 text-muted-foreground">Prioritized approvals, client readiness, and incidents without searching across tools.</p></div>
    {killSwitch && <Alert variant="destructive"><ShieldAlert className="size-4" /><AlertTitle>Global operational kill switch is active</AlertTitle><AlertDescription>Deployment recording remains visible, but staff should not proceed with operational changes.</AlertDescription></Alert>}
    <div className="grid gap-4 md:grid-cols-3">
      <Card><CardHeader className="flex-row items-center justify-between"><div><CardDescription>Active clients</CardDescription><CardTitle className="font-mono text-3xl">{clients.length}</CardTitle></div><Users className="size-6 text-primary" /></CardHeader><CardContent><p className="text-sm text-muted-foreground">{onboarded} fully onboarded</p></CardContent></Card>
      <Card><CardHeader className="flex-row items-center justify-between"><div><CardDescription>Pending approvals</CardDescription><CardTitle className="font-mono text-3xl">{pendingApprovals.length}</CardTitle></div><ShieldCheck className="size-6 text-primary" /></CardHeader><CardContent><Button asChild variant="link" className="h-auto p-0"><Link href="/staff/approvals">Review queue <ArrowRight className="size-4" /></Link></Button></CardContent></Card>
      <Card><CardHeader className="flex-row items-center justify-between"><div><CardDescription>Open incidents</CardDescription><CardTitle className="font-mono text-3xl">{openIncidents.length}</CardTitle></div><AlertTriangle className="size-6 text-amber-400" /></CardHeader><CardContent><Button asChild variant="link" className="h-auto p-0"><Link href="/staff/incidents">Open response board <ArrowRight className="size-4" /></Link></Button></CardContent></Card>
    </div>
    <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
      <Card><CardHeader><CardTitle>Clients needing attention</CardTitle><CardDescription>Incomplete onboarding and open incidents rise to the top.</CardDescription></CardHeader><CardContent className="space-y-3">{clients.slice(0, 6).map((client) => { const incident = openIncidents.find((item) => item.client_id === client.id); return <div key={client.id} className="flex items-center justify-between rounded-md border p-4"><div><p className="font-medium">{client.display_name}</p><p className="text-sm text-muted-foreground">{incident?.title ?? client.email}</p></div><StatusBadge status={incident ? incident.status : client.onboarding_status} /></div>; })}</CardContent></Card>
      <Card><CardHeader><CardTitle>Operational safety</CardTitle><CardDescription>One audited control to pause all operational changes.</CardDescription></CardHeader><CardContent className="space-y-4"><div className="flex items-center justify-between rounded-md border p-3"><span className="text-sm">Current state</span><StatusBadge status={killSwitch ? "paused" : "healthy"} /></div><KillSwitchForm enabled={killSwitch} requestId={randomUUID()} /><p className="text-xs text-muted-foreground">This foundation does not directly stop external systems until live connectors are approved and implemented.</p></CardContent></Card>
    </div>
  </div>;
}
