import "server-only";

import {
  hasDeploymentCapability,
  type DeploymentCapability,
  deploymentProfileForMode,
  type DeploymentMode,
  type DeploymentProfile,
} from "@/lib/deployment/contracts";
import { resolveRuntimeConfiguration } from "@/lib/deployment/configuration.mjs";

export interface DeploymentConfiguration {
  readonly profile: DeploymentProfile;
  readonly mode: DeploymentMode;
  readonly bindHost: string;
  readonly appUrl: string;
  readonly secureCookies: boolean;
}

export function resolveDeploymentConfiguration(
  environment: NodeJS.ProcessEnv = process.env,
): DeploymentConfiguration {
  const runtime = resolveRuntimeConfiguration(environment);
  const mode = runtime.mode as DeploymentMode;
  const profile = deploymentProfileForMode(mode);
  return { ...runtime, mode, profile };
}

export function getDeploymentConfiguration(): DeploymentConfiguration {
  return resolveDeploymentConfiguration();
}

export function getDeploymentProfile(): DeploymentProfile {
  return getDeploymentConfiguration().profile;
}

export function requireDeploymentCapability(capability: DeploymentCapability): DeploymentProfile {
  const profile = getDeploymentProfile();
  if (!hasDeploymentCapability(profile, capability)) {
    throw new Error("This operation is unavailable in the configured deployment mode");
  }
  return profile;
}
