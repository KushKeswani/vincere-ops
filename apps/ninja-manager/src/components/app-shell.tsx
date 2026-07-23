import Link from "next/link";
import { Activity, Bot, CircleGauge, HeartPulse, LogOut, Radio, Settings2, ShieldCheck, Users } from "lucide-react";

import type { AuthenticatedUser } from "@/lib/domain/types";
import type { DeploymentProfile } from "@/lib/deployment/contracts";
import { navigationItemsFor, type NavigationIcon } from "@/lib/deployment/navigation";
import { signOutAction } from "@/app/actions/auth";
import { Button } from "@/components/ui/button";
import { MobileNavigation } from "@/components/mobile-navigation";
import { Separator } from "@/components/ui/separator";

interface AppShellProps {
  user: AuthenticatedUser;
  profile: DeploymentProfile;
  children: React.ReactNode;
}

const iconByName = {
  activity: Activity,
  bot: Bot,
  gauge: CircleGauge,
  health: HeartPulse,
  radio: Radio,
  settings: Settings2,
  shield: ShieldCheck,
  users: Users,
} satisfies Record<NavigationIcon, typeof Activity>;

export function AppShell({ user, profile, children }: AppShellProps) {
  const links = navigationItemsFor(profile, user.role);
  const localOnly = profile.mode === "LOCAL_ONLY";
  return (
    <div className="min-h-screen bg-background">
      <aside className="fixed inset-y-0 left-0 hidden w-64 border-r bg-card lg:flex lg:flex-col">
        <div className="p-6">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">{localOnly ? "Local operator" : "Vincere"}</p>
          <h1 className="mt-1 text-xl font-semibold">Ninja Manager</h1>
          <p className="mt-1 text-xs text-muted-foreground">{localOnly ? "Loopback dashboard · no cloud login" : "Operations with clarity"}</p>
        </div>
        <Separator />
        <nav className="flex-1 space-y-1 p-3" aria-label="Primary navigation">
          {links.map(({ href, label, icon }) => {
            const Icon = iconByName[icon];
            return (
              <Link key={href} href={href} className="flex items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
                <Icon className="size-4" aria-hidden="true" />{label}
              </Link>
            );
          })}
        </nav>
        <div className="border-t p-4">
          <p className="text-sm font-medium">{user.name}</p>
          <p className="text-xs capitalize text-muted-foreground">{user.role} · {profile.label}</p>
          {!localOnly && (
            <form action={signOutAction} className="mt-3">
              <Button variant="ghost" size="sm" className="w-full justify-start"><LogOut className="size-4" aria-hidden="true" />Sign out</Button>
            </form>
          )}
        </div>
      </aside>
      <header className="sticky top-0 z-20 flex items-center justify-between border-b bg-background/95 px-4 py-3 backdrop-blur lg:hidden">
        <Link href={user.role === "staff" ? "/staff" : "/client"} className="font-semibold">Ninja Manager</Link>
        <MobileNavigation role={user.role} userName={user.name} modeLabel={profile.label} links={links} />
      </header>
      <main className="min-h-screen lg:pl-64">
        <div className="mx-auto max-w-7xl p-4 sm:p-6 lg:p-8">{children}</div>
      </main>
    </div>
  );
}
