import { redirect } from "next/navigation";
import { ShieldCheck } from "lucide-react";

import { getCurrentUser } from "@/lib/auth/session";
import { homePathForRole } from "@/lib/deployment/contracts";
import { getDeploymentProfile } from "@/lib/deployment/server";
import { SignInForm } from "@/components/forms/sign-in-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default async function SignInPage() {
  const profile = getDeploymentProfile();
  const user = await getCurrentUser();
  if (user) redirect(homePathForRole(profile, user.role));
  const localOnly = profile.mode === "LOCAL_ONLY";
  if (localOnly) redirect("/client");
  return (
    <main className="grid min-h-screen place-items-center bg-[radial-gradient(circle_at_top_right,oklch(0.3_0.08_150),transparent_38%)] p-4">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center">
          <div className="mx-auto mb-4 grid size-12 place-items-center rounded-xl bg-primary text-primary-foreground"><ShieldCheck className="size-6" /></div>
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-primary">{localOnly ? "Local installation" : "Vincere Trading"}</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">Ninja Manager</h1>
          <p className="mt-2 text-sm text-muted-foreground">{localOnly ? "This dashboard stays on this Windows VPS and does not require central service access." : "Your operations, accounts, and strategy guidance in one secure place."}</p>
        </div>
        <Card>
          <CardHeader><CardTitle>Welcome back</CardTitle><CardDescription>{localOnly ? "Use the individual local client identity configured for this installation." : "Use your individual client or staff account to continue."}</CardDescription></CardHeader>
          <CardContent><SignInForm /></CardContent>
        </Card>
        <p className="text-center text-xs text-muted-foreground">{localOnly ? "Local-only mode is loopback-bound by default. Central sync and remote delivery are disabled." : "Ninja Manager does not guarantee trading results or autonomously place trades."}</p>
      </div>
    </main>
  );
}
