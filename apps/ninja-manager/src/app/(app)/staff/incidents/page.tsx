import { randomUUID } from "node:crypto";

import { requireUser } from "@/lib/auth/session";
import { formatDate } from "@/lib/format";
import { getNinjaRepository } from "@/lib/repositories/ninja-repository";
import { IncidentActionForm } from "@/components/forms/incident-action-form";
import { SimulationForm } from "@/components/forms/simulation-form";
import { StatusBadge } from "@/components/status-badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default async function StaffIncidentsPage() {
  const user = await requireUser(["staff"]);
  const repository = getNinjaRepository();
  const [incidents, clients] = await Promise.all([repository.listIncidents(user), repository.listClients(user)]);
  const configuredClient = (await Promise.all(clients.map(async (client) => ({
    client,
    hasEnvironment: (await repository.getEnvironments(client.id, user.organizationId)).length > 0,
  })))).find(({ hasEnvironment }) => hasEnvironment)?.client;
  return <div className="space-y-8"><div><p className="text-sm text-primary">Incident response</p><h2 className="text-3xl font-semibold">Guided operations board</h2><p className="mt-2 text-muted-foreground">Evidence, severity, and the next safe action stay together.</p></div>
    <Card><CardHeader><CardTitle>Test the response path</CardTitle><CardDescription>Create a safe simulated VPS failure for a configured client. No external connector is called.</CardDescription></CardHeader><CardContent>{configuredClient ? <SimulationForm clientId={configuredClient.id} requestId={randomUUID()} /> : <p className="text-sm text-muted-foreground">Register a client environment first.</p>}</CardContent></Card>
    {incidents.length === 0 ? <Card><CardContent className="py-12 text-center text-muted-foreground">No incidents recorded.</CardContent></Card> : incidents.map((incident) => <Card key={incident.id}><CardHeader><div className="flex flex-wrap items-start justify-between gap-3"><div><CardTitle>{incident.title}</CardTitle><CardDescription>{incident.client_name} · {formatDate(incident.created_at)}</CardDescription></div><div className="flex gap-2"><StatusBadge status={incident.severity} /><StatusBadge status={incident.status} /></div></div></CardHeader><CardContent className="space-y-5"><p className="text-sm text-muted-foreground">{incident.description}</p><ol className="space-y-2">{incident.resolution_steps.map((step, index) => <li key={step} className={`rounded-md border p-3 text-sm ${index < incident.current_step ? "text-muted-foreground line-through" : index === incident.current_step ? "border-primary/50 bg-primary/5" : "text-muted-foreground"}`}>{index + 1}. {step}</li>)}</ol>{incident.status !== "resolved" && <IncidentActionForm incidentId={incident.id} canAdvance={incident.current_step < incident.resolution_steps.length} requestId={randomUUID()} />}</CardContent></Card>)}
  </div>;
}
