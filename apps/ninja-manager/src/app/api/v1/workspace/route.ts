import { getCurrentUser } from "@/lib/auth/session";
import { getNinjaRepository } from "@/lib/repositories/ninja-repository";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const repository = getNinjaRepository();
  if (user.role === "staff") {
    const [clients, approvals, incidents] = await Promise.all([repository.listClients(user), repository.listApprovals(user), repository.listIncidents(user)]);
    return Response.json({ data: { role: user.role, clients: clients.length, pendingApprovals: approvals.filter((item) => item.status === "pending").length, openIncidents: incidents.filter((item) => item.status !== "resolved").length } });
  }
  const client = await repository.getClientForUser(user);
  if (!client) return Response.json({ error: "Client profile not found" }, { status: 404 });
  const [accounts, configurations, incidents] = await Promise.all([repository.getAccounts(client.id, user.organizationId), repository.getConfigurations(client.id, user.organizationId), repository.listIncidents(user, client.id)]);
  return Response.json({ data: { role: user.role, client: { id: client.id, name: client.display_name, onboardingStatus: client.onboarding_status }, accountCount: accounts.length, latestConfigurationStatus: configurations[0]?.status ?? null, openIncidents: incidents.filter((item) => item.status !== "resolved").length } });
}
