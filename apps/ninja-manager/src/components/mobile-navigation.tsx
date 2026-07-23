"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, Bot, CircleGauge, HeartPulse, LogOut, Menu, Radio, Settings2, ShieldCheck, Users } from "lucide-react";

import { signOutAction } from "@/app/actions/auth";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import type { UserRole } from "@/lib/domain/types";
import type { NavigationIcon, NavigationItem } from "@/lib/deployment/navigation";
import { cn } from "@/lib/utils";

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

interface MobileNavigationProps {
  role: UserRole;
  userName: string;
  modeLabel: string;
  links: readonly NavigationItem[];
}

export function MobileNavigation({ role, userName, modeLabel, links }: MobileNavigationProps) {
  const pathname = usePathname();

  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Open navigation menu">
          <Menu className="size-5" aria-hidden="true" />
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-[min(22rem,88vw)]">
        <SheetHeader className="border-b">
          <SheetTitle>Ninja Manager</SheetTitle>
          <SheetDescription>{userName} · {role} · {modeLabel}</SheetDescription>
        </SheetHeader>
        <nav className="space-y-1 px-3" aria-label="Mobile navigation">
          {links.map(({ href, label, icon }) => {
            const current = pathname === href;
            const Icon = iconByName[icon];
            return (
              <SheetClose asChild key={href}>
                <Link
                  href={href}
                  aria-current={current ? "page" : undefined}
                  className={cn(
                    "flex min-h-11 items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                    current
                      ? "bg-accent font-medium text-foreground"
                      : "text-muted-foreground hover:bg-accent hover:text-foreground",
                  )}
                >
                  <Icon className="size-4" aria-hidden="true" />
                  {label}
                </Link>
              </SheetClose>
            );
          })}
        </nav>
        {modeLabel !== "Local only" && (
          <SheetFooter className="border-t">
            <form action={signOutAction}>
              <Button type="submit" variant="ghost" className="w-full justify-start">
                <LogOut className="size-4" aria-hidden="true" />
                Sign out
              </Button>
            </form>
          </SheetFooter>
        )}
      </SheetContent>
    </Sheet>
  );
}
