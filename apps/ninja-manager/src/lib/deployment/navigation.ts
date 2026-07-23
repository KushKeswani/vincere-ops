import type { UserRole } from "@/lib/domain/types";
import {
  hasDeploymentCapability,
  isRoleAllowed,
  type DeploymentCapability,
  type DeploymentProfile,
} from "@/lib/deployment/contracts";

export type NavigationIcon =
  | "activity"
  | "bot"
  | "gauge"
  | "health"
  | "radio"
  | "settings"
  | "shield"
  | "users";

export interface NavigationItem {
  readonly id: string;
  readonly href: string;
  readonly label: string;
  readonly icon: NavigationIcon;
  readonly requiredCapability: DeploymentCapability;
}

const clientItems: readonly NavigationItem[] = [
  { id: "client-control", href: "/client", label: "Control center", icon: "gauge", requiredCapability: "client.workspace" },
  { id: "client-setup", href: "/client/setup", label: "Setup", icon: "settings", requiredCapability: "client.workspace" },
  { id: "client-strategy", href: "/client/strategy", label: "Strategy", icon: "bot", requiredCapability: "client.workspace" },
  { id: "client-activity", href: "/client/activity", label: "Activity", icon: "activity", requiredCapability: "operations.inbox" },
];

const staffItems: readonly NavigationItem[] = [
  { id: "staff-operations", href: "/staff", label: "Operations", icon: "gauge", requiredCapability: "staff.portal" },
  { id: "staff-runtime", href: "/staff/runtime", label: "Runtime", icon: "radio", requiredCapability: "fleet.runtime" },
  { id: "staff-clients", href: "/staff/clients", label: "Clients", icon: "users", requiredCapability: "tenant.directory" },
  { id: "staff-approvals", href: "/staff/approvals", label: "Approvals", icon: "shield", requiredCapability: "client.strategy_requests" },
  { id: "staff-incidents", href: "/staff/incidents", label: "Incidents", icon: "health", requiredCapability: "operations.inbox" },
];

export function navigationItemsFor(profile: DeploymentProfile, role: UserRole): readonly NavigationItem[] {
  if (!isRoleAllowed(profile, role)) return [];
  if (profile.mode === "LOCAL_ONLY" && role === "client") {
    return [
      { id: "local-operator", href: "/client", label: "Operator", icon: "gauge", requiredCapability: "client.workspace" },
      { id: "local-blueprint", href: "/client/strategy", label: "Blueprint", icon: "bot", requiredCapability: "client.workspace" },
      { id: "local-day-ops", href: "/client/activity", label: "Day ops", icon: "activity", requiredCapability: "operations.inbox" },
    ];
  }
  const candidates = role === "staff" ? staffItems : clientItems;
  return candidates.filter((item) => hasDeploymentCapability(profile, item.requiredCapability));
}
