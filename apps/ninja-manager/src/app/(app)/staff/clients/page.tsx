import { randomUUID } from "node:crypto";

import { requireUser } from "@/lib/auth/session";
import { formatDate } from "@/lib/format";
import { getNinjaRepository } from "@/lib/repositories/ninja-repository";
import { CreateClientForm } from "@/components/forms/create-client-form";
import { ClientAccessForm } from "@/components/forms/client-access-form";
import { StatusBadge } from "@/components/status-badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export default async function StaffClientsPage() {
  const user = await requireUser(["staff"]);
  const clients = await getNinjaRepository().listClients(user);
  return <div className="space-y-8"><div><p className="text-sm text-primary">Client management</p><h2 className="text-3xl font-semibold">Create and guide client workspaces</h2><p className="mt-2 text-muted-foreground">Each client is isolated to the Vincere organization and receives a dedicated role-limited login.</p></div>
    <Card><CardHeader><CardTitle>Create client</CardTitle><CardDescription>The temporary password is hashed immediately and never displayed again.</CardDescription></CardHeader><CardContent><CreateClientForm requestId={randomUUID()} /></CardContent></Card>
    <Card><CardHeader><CardTitle>Client directory</CardTitle><CardDescription>{clients.length} total workspaces</CardDescription></CardHeader><CardContent><Table><TableHeader><TableRow><TableHead>Client</TableHead><TableHead>Onboarding</TableHead><TableHead>Access</TableHead><TableHead>Timezone</TableHead><TableHead>Created</TableHead></TableRow></TableHeader><TableBody>{clients.map((client) => <TableRow key={client.id}><TableCell><div className="font-medium">{client.display_name}</div><div className="text-xs text-muted-foreground">{client.email}</div></TableCell><TableCell><StatusBadge status={client.onboarding_status} /></TableCell><TableCell><div className="space-y-2"><StatusBadge status={client.user_status} /><ClientAccessForm clientId={client.id} enabled={client.user_status === "active"} requestId={randomUUID()} /></div></TableCell><TableCell>{client.timezone}</TableCell><TableCell className="text-muted-foreground">{formatDate(client.created_at)}</TableCell></TableRow>)}</TableBody></Table></CardContent></Card>
  </div>;
}
