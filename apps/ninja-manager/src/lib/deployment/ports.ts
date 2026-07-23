import type { DeploymentMode } from "@/lib/deployment/contracts";

export type AuthenticationAssurance = "password" | "mfa" | "recent_reauthentication";

export interface IdentityPrincipal {
  readonly subjectId: string;
  readonly tenantId: string;
  readonly roleIds: readonly string[];
  readonly assurance: AuthenticationAssurance;
}

export interface IdentityProvider {
  readonly adapterId: string;
  authenticate(input: { login: string; proof: string }): Promise<IdentityPrincipal | null>;
  requireRecentAuthentication(principal: IdentityPrincipal, purpose: string): Promise<boolean>;
}

export interface TenantDirectoryProvider {
  readonly adapterId: string;
  readTenant(tenantId: string): Promise<{ id: string; version: number } | null>;
}

export interface SecretReference {
  readonly id: string;
  readonly provider: string;
  readonly purpose: string;
  readonly redactedHint: string;
  readonly version: number;
}

export interface SecretsProvider {
  readonly adapterId: string;
  storeReference(input: Omit<SecretReference, "id" | "version">): Promise<SecretReference>;
  requestControlledAccess(input: {
    referenceId: string;
    principal: IdentityPrincipal;
    reasonCode: string;
  }): Promise<{ grantId: string; expiresAt: string }>;
}

export interface NotificationDeliveryProvider {
  readonly adapterId: string;
  enqueue(templateId: string, recipientRef: string, evidenceId: string): Promise<{ deliveryId: string }>;
}

export interface PortableChangeReference {
  readonly messageId: string;
  readonly originInstallationId: string;
  readonly originMode: DeploymentMode;
  readonly recordType: "assignment" | "audit_evidence" | "client" | "operational_case" | "runtime_observation";
  readonly recordId: string;
  readonly recordVersion: number;
  readonly schemaVersion: "1.0";
  readonly operation: "upsert" | "tombstone";
  readonly payloadHash: string;
  readonly occurredAt: string;
}

export interface CentralSyncProvider {
  readonly adapterId: string;
  enqueue(change: PortableChangeReference): Promise<void>;
  applyInbox(limit: number): Promise<{ applied: number; conflicts: number; rejected: number }>;
}

export interface RuntimeTransportProvider {
  readonly adapterId: string;
  readonly kind: "outbound_central_queue" | "local_loopback";
  publishEvidence(evidenceId: string): Promise<void>;
  pollCommands(limit: number): Promise<readonly string[]>;
}

export interface PlatformAdapters {
  readonly identity: IdentityProvider;
  readonly tenantDirectory: TenantDirectoryProvider | null;
  readonly secrets: SecretsProvider;
  readonly notifications: NotificationDeliveryProvider | null;
  readonly centralSync: CentralSyncProvider | null;
  readonly runtimeTransport: RuntimeTransportProvider;
}
