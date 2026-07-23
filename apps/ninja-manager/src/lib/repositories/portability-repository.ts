import { randomUUID } from "node:crypto";

import type { DatabaseClient, DatabaseTransaction } from "@/lib/db/client";
import { getDatabase } from "@/lib/db/client";
import {
  deploymentProfileForMode,
  type AuthoritySubject,
  type DeploymentMode,
} from "@/lib/deployment/contracts";
import type { AuthenticatedUser } from "@/lib/domain/types";
import {
  createSyncMessageEnvelope,
  portableChangeSchema,
  type PortableRecordType,
  type SyncMessageEnvelope,
} from "@/lib/domain/sync-contracts";
import { userAuditSubject } from "@/lib/domain/audit-evidence";
import { writeAuditEvent } from "@/lib/repositories/audit-writer";

interface InstallationRow {
  deployment_mode: DeploymentMode;
  next_sequence: number | string;
}

interface PortableStateRow {
  id: string;
  origin_installation_id: string;
  record_version: number | string;
}

export interface StagePortableChangeInput {
  installationId: string;
  recordType: PortableRecordType;
  recordId: string;
  baseVersion: number | null;
  operation: "upsert" | "tombstone";
  contentHash: string;
}

const authoritySubjectByRecordType: Record<PortableRecordType, AuthoritySubject> = {
  assignment: "assignments",
  audit_evidence: "audit_evidence",
  client: "client_directory",
  operational_case: "operational_cases",
  runtime_observation: "runtime_state",
};

export class PortabilityRepository {
  constructor(
    private readonly database: DatabaseClient = getDatabase(),
    private readonly now: () => Date = () => new Date(),
  ) {}

  async stageChange(
    user: AuthenticatedUser,
    input: StagePortableChangeInput,
  ): Promise<SyncMessageEnvelope> {
    return this.database.transaction(async (transaction) => {
      const [installation] = await transaction.query<InstallationRow>(
        [
          "UPDATE product_installations",
          "SET next_outbox_sequence = next_outbox_sequence + 1, updated_at = $1",
          "WHERE id = $2 AND organization_id = $3",
          "RETURNING deployment_mode, next_outbox_sequence - 1 AS next_sequence",
        ].join(" "),
        [this.now(), input.installationId, user.organizationId],
      );
      if (!installation) throw new Error("Authorized product installation not found");
      this.assertActorAllowed(user, installation.deployment_mode);

      const [existing] = await transaction.query<PortableStateRow>(
        [
          "SELECT id, origin_installation_id, record_version",
          "FROM portable_record_state",
          "WHERE organization_id = $1 AND installation_id = $2 AND record_type = $3 AND record_id = $4",
          "FOR UPDATE",
        ].join(" "),
        [user.organizationId, input.installationId, input.recordType, input.recordId],
      );

      const currentVersion = existing ? Number(existing.record_version) : null;
      if (input.baseVersion !== currentVersion) {
        throw new Error("Portable record base version is stale");
      }
      const recordVersion = (currentVersion ?? 0) + 1;
      const profile = deploymentProfileForMode(installation.deployment_mode);
      const authority = profile.authorities[authoritySubjectByRecordType[input.recordType]].writer;
      const occurredAt = this.now().toISOString();
      const change = portableChangeSchema.parse({
        recordType: input.recordType,
        recordId: input.recordId,
        originInstallationId: existing?.origin_installation_id ?? input.installationId,
        originMode: installation.deployment_mode,
        recordVersion,
        baseVersion: input.baseVersion,
        authority,
        operation: input.operation,
        contentHash: input.contentHash,
        occurredAt,
      });
      const sequence = Number(installation.next_sequence);
      const envelope = createSyncMessageEnvelope({
        protocolVersion: "1.0",
        canonicalization: "RFC8785",
        messageId: randomUUID(),
        sourceInstallationId: input.installationId,
        destinationInstallationId: null,
        sequence,
        change,
        issuedAt: occurredAt,
      });
      const stateId = existing?.id ?? randomUUID();
      const syncStatus = installation.deployment_mode === "LOCAL_ONLY" ? "local_only" : "pending";

      if (existing) {
        await transaction.query(
          [
            "UPDATE portable_record_state",
            "SET record_version = $1, base_version = $2, authority = $3, content_hash = $4,",
            "sync_status = $5, conflict_code = NULL, modified_at = $6",
            "WHERE id = $7 AND organization_id = $8 AND installation_id = $9",
          ].join(" "),
          [
            recordVersion,
            input.baseVersion,
            authority,
            input.contentHash,
            syncStatus,
            this.now(),
            stateId,
            user.organizationId,
            input.installationId,
          ],
        );
      } else {
        await transaction.query(
          [
            "INSERT INTO portable_record_state",
            "(id, organization_id, installation_id, record_type, record_id, origin_installation_id,",
            "record_version, base_version, authority, content_hash, sync_status, modified_at)",
            "VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)",
          ].join(" "),
          [
            stateId,
            user.organizationId,
            input.installationId,
            input.recordType,
            input.recordId,
            input.installationId,
            recordVersion,
            input.baseVersion,
            authority,
            input.contentHash,
            syncStatus,
            this.now(),
          ],
        );
      }

      await transaction.query(
        [
          "INSERT INTO sync_outbox",
          "(id, organization_id, installation_id, record_state_id, message_id, sequence, schema_version,",
          "operation, envelope, envelope_hash)",
          "VALUES ($1, $2, $3, $4, $5, $6, '1.0', $7, $8::jsonb, $9)",
        ].join(" "),
        [
          randomUUID(),
          user.organizationId,
          input.installationId,
          stateId,
          envelope.messageId,
          sequence,
          input.operation,
          JSON.stringify(envelope),
          envelope.envelopeHash,
        ],
      );
      await this.auditStagedChange(transaction, user, input.installationId, stateId, envelope);
      return envelope;
    });
  }

  private assertActorAllowed(user: AuthenticatedUser, mode: DeploymentMode): void {
    const allowed = mode === "CENTRAL_CONNECTED" ? user.role === "staff" : user.role === "client";
    if (!allowed) throw new Error("Actor is not permitted for this product installation");
  }

  private async auditStagedChange(
    transaction: DatabaseTransaction,
    user: AuthenticatedUser,
    installationId: string,
    stateId: string,
    envelope: SyncMessageEnvelope,
  ): Promise<void> {
    await writeAuditEvent(transaction, {
      organizationId: user.organizationId,
      actorUserId: user.id,
      actorSubjectId: userAuditSubject(user.id),
      action: "portable.change_staged",
      entityType: "portable_record_state",
      entityId: stateId,
      metadata: {
        messageId: envelope.messageId,
        operation: envelope.change.operation,
        recordType: envelope.change.recordType,
        recordVersion: envelope.change.recordVersion,
        sequence: envelope.sequence,
        envelopeHash: envelope.envelopeHash,
      },
      originInstallationId: installationId,
      occurredAt: this.now(),
    });
  }
}

export function getPortabilityRepository(): PortabilityRepository {
  return new PortabilityRepository();
}
