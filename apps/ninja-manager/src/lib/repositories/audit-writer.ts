import { randomUUID } from "node:crypto";

import type { DatabaseTransaction } from "@/lib/db/client";
import {
  AUDIT_EVENT_VERSION,
  auditEvidenceHash,
  type CanonicalAuditEvidence,
} from "@/lib/domain/audit-evidence";

export interface AuditWriteInput {
  organizationId: string;
  actorUserId: string | null;
  actorSubjectId: string;
  action: string;
  entityType: string;
  entityId: string;
  metadata: unknown;
  originInstallationId?: string | null;
  occurredAt?: Date;
}

export async function writeAuditEvent(
  executor: Pick<DatabaseTransaction, "query">,
  input: AuditWriteInput,
): Promise<string> {
  if (!input.actorSubjectId.trim()) throw new Error("Audit actor subject is required");

  const evidence: CanonicalAuditEvidence = {
    eventId: randomUUID(),
    eventVersion: AUDIT_EVENT_VERSION,
    organizationId: input.organizationId,
    actorSubjectId: input.actorSubjectId,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    metadata: input.metadata,
    originInstallationId: input.originInstallationId ?? null,
    occurredAt: (input.occurredAt ?? new Date()).toISOString(),
  };
  const evidenceHash = auditEvidenceHash(evidence);

  await executor.query(
    [
      "INSERT INTO audit_events",
      "(id, organization_id, actor_user_id, actor_subject_id, action, entity_type, entity_id, metadata,",
      "origin_installation_id, event_version, evidence_hash, legacy_unverified, created_at)",
      "VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11, false, $12)",
    ].join(" "),
    [
      evidence.eventId,
      evidence.organizationId,
      input.actorUserId,
      evidence.actorSubjectId,
      evidence.action,
      evidence.entityType,
      evidence.entityId,
      JSON.stringify(evidence.metadata),
      evidence.originInstallationId,
      evidence.eventVersion,
      evidenceHash,
      evidence.occurredAt,
    ],
  );
  return evidence.eventId;
}
