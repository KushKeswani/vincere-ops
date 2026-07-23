import { requireUser } from "@/lib/auth/session";
import { getDeploymentProfile } from "@/lib/deployment/server";
import { AppShell } from "@/components/app-shell";

export default async function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  return <AppShell user={user} profile={getDeploymentProfile()}>{children}</AppShell>;
}
