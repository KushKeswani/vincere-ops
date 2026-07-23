import { randomUUID } from "node:crypto";

import { notFound } from "next/navigation";

import { requireUser } from "@/lib/auth/session";
import { getDeploymentProfile } from "@/lib/deployment/server";
import { getNinjaRepository } from "@/lib/repositories/ninja-repository";
import { AccountForm } from "@/components/forms/account-form";
import { OnboardingForm } from "@/components/forms/onboarding-form";
import { StatusBadge } from "@/components/status-badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default async function ClientSetupPage() {
  const user = await requireUser(["client"]);
  const localOnly = getDeploymentProfile().mode === "LOCAL_ONLY";
  const repository = getNinjaRepository();
  const client = await repository.getClientForUser(user);
  if (!client) notFound();
  const [accounts, environments] = await Promise.all([repository.getAccounts(client.id, user.organizationId), repository.getEnvironments(client.id, user.organizationId)]);
  return <div className="space-y-8"><div><p className="text-sm text-primary">Guided setup</p><h2 className="text-3xl font-semibold">Connect the pieces once</h2><p className="mt-2 text-muted-foreground">We keep the language simple and store only the account information needed for operations.</p></div>
    <Card><CardHeader><div className="flex items-center justify-between"><CardTitle>1. Client profile</CardTitle><StatusBadge status={client.onboarding_status} /></div><CardDescription>{localOnly ? "Confirm the contact and reporting settings stored on this installation." : "Confirm how Vincere should contact you and when reports should roll over."}</CardDescription></CardHeader><CardContent><OnboardingForm phone={client.phone ?? ""} timezone={client.timezone} requestId={randomUUID()} /></CardContent></Card>
    <Card><CardHeader><CardTitle>2. Trading account and environment</CardTitle><CardDescription>Add a prop-firm account, VPS location, and NinjaTrader version. Credentials are never requested here.</CardDescription></CardHeader><CardContent><AccountForm requestId={randomUUID()} /></CardContent></Card>
    {accounts.length > 0 && <Card><CardHeader><CardTitle>Registered environments</CardTitle></CardHeader><CardContent className="space-y-3">{accounts.map((account, index) => <div key={account.id} className="flex flex-col justify-between gap-2 rounded-md border p-4 sm:flex-row sm:items-center"><div><p className="font-medium">{account.label} · {account.account_identifier_masked}</p><p className="text-sm text-muted-foreground">{account.provider} · ${Number(account.account_size).toLocaleString()} · {environments[index]?.vps_provider ?? "VPS pending"}</p></div><StatusBadge status={environments[index]?.connection_status ?? account.status} /></div>)}</CardContent></Card>}
  </div>;
}
