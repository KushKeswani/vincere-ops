import { z } from "zod";

import type { UserRole } from "@/lib/domain/types";
import { parseRuntimeMode } from "@/lib/deployment/configuration.mjs";

export const deploymentModeSchema = z.enum(["CENTRAL_CONNECTED", "LOCAL_ONLY"]);
export type DeploymentMode = z.infer<typeof deploymentModeSchema>;

export const deploymentCapabilitySchema = z.enum([
  "central.sync",
  "client.strategy_requests",
  "client.workspace",
  "fleet.runtime",
  "identity.local",
  "identity.tenant",
  "notifications.delivery",
  "operations.inbox",
  "remote.delivery",
  "runtime.queue",
  "secrets.references",
  "staff.portal",
  "tenant.directory",
  "transport.local",
]);
export type DeploymentCapability = z.infer<typeof deploymentCapabilitySchema>;

export const authoritySubjectSchema = z.enum([
  "assignments",
  "audit_evidence",
  "client_directory",
  "operational_cases",
  "runtime_state",
]);
export type AuthoritySubject = z.infer<typeof authoritySubjectSchema>;

export const authorityWriterSchema = z.enum([
  "central_portal",
  "local_installation",
  "ninjatrader_addon",
  "originating_system_append_only",
]);
export type AuthorityWriter = z.infer<typeof authorityWriterSchema>;

export interface AuthorityRule {
  readonly writer: AuthorityWriter;
  readonly conflictPolicy:
    | "central_version_wins_with_audit"
    | "local_version_wins_with_audit"
    | "addon_observation_wins"
    | "append_only_no_overwrite";
}

export interface DeploymentProfile {
  readonly mode: DeploymentMode;
  readonly label: string;
  readonly allowedRoles: readonly UserRole[];
  readonly capabilities: Readonly<Record<DeploymentCapability, boolean>>;
  readonly authorities: Readonly<Record<AuthoritySubject, AuthorityRule>>;
  readonly runtimeTransport: "outbound_central_queue" | "local_loopback";
  readonly agentConnectivity: "outbound_only" | "local_only";
}

const centralCapabilities: Record<DeploymentCapability, boolean> = {
  "central.sync": true,
  "client.strategy_requests": true,
  "client.workspace": true,
  "fleet.runtime": true,
  "identity.local": false,
  "identity.tenant": true,
  "notifications.delivery": true,
  "operations.inbox": true,
  "remote.delivery": true,
  "runtime.queue": true,
  "secrets.references": true,
  "staff.portal": true,
  "tenant.directory": true,
  "transport.local": false,
};

const localCapabilities: Record<DeploymentCapability, boolean> = {
  "central.sync": false,
  "client.strategy_requests": false,
  "client.workspace": true,
  "fleet.runtime": false,
  "identity.local": true,
  "identity.tenant": false,
  "notifications.delivery": false,
  "operations.inbox": true,
  "remote.delivery": false,
  "runtime.queue": true,
  "secrets.references": true,
  "staff.portal": false,
  "tenant.directory": false,
  "transport.local": true,
};

const profiles: Record<DeploymentMode, DeploymentProfile> = {
  CENTRAL_CONNECTED: {
    mode: "CENTRAL_CONNECTED",
    label: "Central connected",
    allowedRoles: ["staff", "client"],
    capabilities: centralCapabilities,
    runtimeTransport: "outbound_central_queue",
    agentConnectivity: "outbound_only",
    authorities: {
      client_directory: { writer: "central_portal", conflictPolicy: "central_version_wins_with_audit" },
      assignments: { writer: "central_portal", conflictPolicy: "central_version_wins_with_audit" },
      runtime_state: { writer: "ninjatrader_addon", conflictPolicy: "addon_observation_wins" },
      operational_cases: { writer: "central_portal", conflictPolicy: "central_version_wins_with_audit" },
      audit_evidence: { writer: "originating_system_append_only", conflictPolicy: "append_only_no_overwrite" },
    },
  },
  LOCAL_ONLY: {
    mode: "LOCAL_ONLY",
    label: "Local only",
    allowedRoles: ["client"],
    capabilities: localCapabilities,
    runtimeTransport: "local_loopback",
    agentConnectivity: "local_only",
    authorities: {
      client_directory: { writer: "local_installation", conflictPolicy: "local_version_wins_with_audit" },
      assignments: { writer: "local_installation", conflictPolicy: "local_version_wins_with_audit" },
      runtime_state: { writer: "ninjatrader_addon", conflictPolicy: "addon_observation_wins" },
      operational_cases: { writer: "local_installation", conflictPolicy: "local_version_wins_with_audit" },
      audit_evidence: { writer: "originating_system_append_only", conflictPolicy: "append_only_no_overwrite" },
    },
  },
};

export function parseDeploymentMode(value: string | undefined, environment = "development"): DeploymentMode {
  return deploymentModeSchema.parse(parseRuntimeMode(value, environment));
}

export function deploymentProfileForMode(mode: DeploymentMode): DeploymentProfile {
  return profiles[mode];
}

export function hasDeploymentCapability(
  profile: DeploymentProfile,
  capability: DeploymentCapability,
): boolean {
  return profile.capabilities[capability];
}

export function isRoleAllowed(profile: DeploymentProfile, role: UserRole): boolean {
  return profile.allowedRoles.includes(role);
}

export function homePathForRole(profile: DeploymentProfile, role: UserRole): "/staff" | "/client" | "/sign-in" {
  if (!isRoleAllowed(profile, role)) return "/sign-in";
  return role === "staff" ? "/staff" : "/client";
}
