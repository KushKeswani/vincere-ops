import { hashCanonicalPayload } from "./runtime-contracts";

export const AUDIT_EVENT_VERSION = 1;

export interface CanonicalAuditEvidence {
  eventId: string;
  eventVersion: number;
  organizationId: string;
  actorSubjectId: string;
  action: string;
  entityType: string;
  entityId: string;
  metadata: unknown;
  originInstallationId: string | null;
  occurredAt: string;
}

export function userAuditSubject(userId: string): string {
  return `user:${userId}`;
}

export function agentAuditSubject(agentId: string): string {
  return `agent:${agentId}`;
}

export function auditEvidenceHash(evidence: CanonicalAuditEvidence): string {
  return hashCanonicalPayload({
    action: evidence.action,
    actorSubjectId: evidence.actorSubjectId,
    entityId: evidence.entityId,
    entityType: evidence.entityType,
    eventId: evidence.eventId,
    eventVersion: evidence.eventVersion,
    metadata: evidence.metadata,
    occurredAt: evidence.occurredAt,
    organizationId: evidence.organizationId,
    originInstallationId: evidence.originInstallationId,
  });
}
