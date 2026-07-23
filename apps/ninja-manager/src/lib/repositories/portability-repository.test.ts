import { beforeEach, describe, expect, it } from "vitest";

import { createDatabaseClient, type DatabaseClient, type DatabaseTransaction } from "@/lib/db/client";
import { migrateDatabase } from "@/lib/db/migrate";
import { auditEvidenceHash, userAuditSubject } from "@/lib/domain/audit-evidence";
import type { AuthenticatedUser } from "@/lib/domain/types";
import { parseSyncMessageEnvelope } from "@/lib/domain/sync-contracts";
import { PortabilityRepository } from "./portability-repository";

const ids = {
  organization: "10000000-0000-4000-8000-000000000001",
  otherOrganization: "10000000-0000-4000-8000-000000000002",
  staff: "20000000-0000-4000-8000-000000000001",
  clientUser: "30000000-0000-4000-8000-000000000001",
  client: "40000000-0000-4000-8000-000000000001",
  centralInstallation: "50000000-0000-4000-8000-000000000001",
  localInstallation: "50000000-0000-4000-8000-000000000002",
  record: "60000000-0000-4000-8000-000000000001",
};

const staff: AuthenticatedUser = {
  id: ids.staff,
  organizationId: ids.organization,
  email: "staff@test.local",
  name: "Staff",
  role: "staff",
};
const client: AuthenticatedUser = {
  id: ids.clientUser,
  organizationId: ids.organization,
  email: "client@test.local",
  name: "Client",
  role: "client",
};

let database: DatabaseClient;
let repository: PortabilityRepository;

function withFailingAuditWrites(client: DatabaseClient): DatabaseClient {
  return {
    query<T extends object>(sql: string, params?: unknown[]): Promise<T[]> {
      return client.query<T>(sql, params);
    },
    exec(sql: string): Promise<void> {
      return client.exec(sql);
    },
    transaction<T>(operation: (transaction: DatabaseTransaction) => Promise<T>): Promise<T> {
      return client.transaction((transaction) => operation({
        query<TRecord extends object>(sql: string, params?: unknown[]): Promise<TRecord[]> {
          if (/INSERT\s+INTO\s+audit_events/i.test(sql)) throw new Error("injected audit write failure");
          return transaction.query<TRecord>(sql, params);
        },
        exec(sql: string): Promise<void> {
          return transaction.exec(sql);
        },
      }));
    },
    close(): Promise<void> {
      return client.close();
    },
  };
}

beforeEach(async () => {
  database = createDatabaseClient(":memory:");
  await migrateDatabase(database);
  await database.query(
    "INSERT INTO organizations (id, name, slug) VALUES ($1, 'One', 'one'), ($2, 'Two', 'two')",
    [ids.organization, ids.otherOrganization],
  );
  await database.query(
    [
      "INSERT INTO users (id, organization_id, email, name, password_hash, role) VALUES",
      "($1, $3, 'staff@test.local', 'Staff', 'hash', 'staff'),",
      "($2, $3, 'client@test.local', 'Client', 'hash', 'client')",
    ].join(" "),
    [ids.staff, ids.clientUser, ids.organization],
  );
  await database.query(
    "INSERT INTO clients (id, organization_id, user_id, display_name, created_by) VALUES ($1, $2, $3, 'Client', $4)",
    [ids.client, ids.organization, ids.clientUser, ids.staff],
  );
  await database.query(
    [
      "INSERT INTO product_installations",
      "(id, organization_id, local_client_id, installation_kind, deployment_mode, enrollment_state, created_by)",
      "VALUES",
      "($1, $3, NULL, 'central_hub', 'CENTRAL_CONNECTED', 'active', $4),",
      "($2, $3, $5, 'local_node', 'LOCAL_ONLY', 'standalone', $6)",
    ].join(" "),
    [
      ids.centralInstallation,
      ids.localInstallation,
      ids.organization,
      ids.staff,
      ids.client,
      ids.clientUser,
    ],
  );
  repository = new PortabilityRepository(
    database,
    () => new Date("2026-07-13T20:00:00.000Z"),
  );
});

describe("PortabilityRepository", () => {
  it("stages record state, sequence, outbox evidence, and audit atomically", async () => {
    const first = await repository.stageChange(staff, {
      installationId: ids.centralInstallation,
      recordType: "client",
      recordId: ids.record,
      baseVersion: null,
      operation: "upsert",
      contentHash: "sha256:" + "a".repeat(64),
    });
    expect(parseSyncMessageEnvelope(first)).toEqual(first);
    expect(first.sequence).toBe(1);
    expect(first.change).toMatchObject({
      recordVersion: 1,
      baseVersion: null,
      authority: "central_portal",
    });

    const second = await repository.stageChange(staff, {
      installationId: ids.centralInstallation,
      recordType: "client",
      recordId: ids.record,
      baseVersion: 1,
      operation: "upsert",
      contentHash: "sha256:" + "b".repeat(64),
    });
    expect(second.sequence).toBe(2);
    expect(second.change.recordVersion).toBe(2);

    const [counts] = await database.query<{
      states: number;
      messages: number;
      audits: number;
    }>(
      [
        "SELECT",
        "(SELECT COUNT(*) FROM portable_record_state) AS states,",
        "(SELECT COUNT(*) FROM sync_outbox) AS messages,",
        "(SELECT COUNT(*) FROM audit_events WHERE action = 'portable.change_staged') AS audits",
      ].join(" "),
    );
    expect(Number(counts.states)).toBe(1);
    expect(Number(counts.messages)).toBe(2);
    expect(Number(counts.audits)).toBe(2);

    const evidenceRows = await database.query<{
      id: string;
      organization_id: string;
      actor_subject_id: string;
      action: string;
      entity_type: string;
      entity_id: string;
      metadata: Record<string, unknown>;
      origin_installation_id: string;
      event_version: number;
      evidence_hash: string;
      legacy_unverified: boolean;
      created_at: Date;
    }>("SELECT id, organization_id, actor_subject_id, action, entity_type, entity_id, metadata, origin_installation_id, event_version, evidence_hash, legacy_unverified, created_at FROM audit_events WHERE action = 'portable.change_staged' ORDER BY created_at");
    for (const event of evidenceRows) {
      expect(event.actor_subject_id).toBe(userAuditSubject(ids.staff));
      expect(event.origin_installation_id).toBe(ids.centralInstallation);
      expect(event.event_version).toBe(1);
      expect(event.legacy_unverified).toBe(false);
      expect(event.metadata).toMatchObject({ envelopeHash: expect.stringMatching(/^sha256:/), recordVersion: expect.any(Number) });
      expect(event.evidence_hash).toBe(auditEvidenceHash({
        eventId: event.id,
        eventVersion: event.event_version,
        organizationId: event.organization_id,
        actorSubjectId: event.actor_subject_id,
        action: event.action,
        entityType: event.entity_type,
        entityId: event.entity_id,
        metadata: event.metadata,
        originInstallationId: event.origin_installation_id,
        occurredAt: new Date(event.created_at).toISOString(),
      }));
    }
  });

  it("rolls back the claimed sequence when a base version is stale", async () => {
    await repository.stageChange(staff, {
      installationId: ids.centralInstallation,
      recordType: "client",
      recordId: ids.record,
      baseVersion: null,
      operation: "upsert",
      contentHash: "sha256:" + "a".repeat(64),
    });
    await expect(repository.stageChange(staff, {
      installationId: ids.centralInstallation,
      recordType: "client",
      recordId: ids.record,
      baseVersion: 0,
      operation: "upsert",
      contentHash: "sha256:" + "b".repeat(64),
    })).rejects.toThrow("base version");
    const [installation] = await database.query<{ next_outbox_sequence: number }>(
      "SELECT next_outbox_sequence FROM product_installations WHERE id = $1",
      [ids.centralInstallation],
    );
    expect(Number(installation.next_outbox_sequence)).toBe(2);
  });

  it("rolls back state, outbox, and sequence when canonical audit evidence fails", async () => {
    const failingRepository = new PortabilityRepository(
      withFailingAuditWrites(database),
      () => new Date("2026-07-13T20:00:00.000Z"),
    );
    await expect(failingRepository.stageChange(staff, {
      installationId: ids.centralInstallation,
      recordType: "client",
      recordId: ids.record,
      baseVersion: null,
      operation: "upsert",
      contentHash: "sha256:" + "a".repeat(64),
    })).rejects.toThrow("injected audit write failure");
    expect(await database.query("SELECT id FROM portable_record_state")).toHaveLength(0);
    expect(await database.query("SELECT id FROM sync_outbox")).toHaveLength(0);
    const [installation] = await database.query<{ next_outbox_sequence: number }>(
      "SELECT next_outbox_sequence FROM product_installations WHERE id = $1",
      [ids.centralInstallation],
    );
    expect(Number(installation.next_outbox_sequence)).toBe(1);
  });

  it("enforces the installation actor and tenant boundaries", async () => {
    await expect(repository.stageChange(client, {
      installationId: ids.centralInstallation,
      recordType: "client",
      recordId: ids.record,
      baseVersion: null,
      operation: "upsert",
      contentHash: "sha256:" + "a".repeat(64),
    })).rejects.toThrow("not permitted");
    await expect(repository.stageChange(staff, {
      installationId: ids.localInstallation,
      recordType: "client",
      recordId: ids.record,
      baseVersion: null,
      operation: "upsert",
      contentHash: "sha256:" + "a".repeat(64),
    })).rejects.toThrow("not permitted");
    await expect(repository.stageChange({ ...staff, organizationId: ids.otherOrganization }, {
      installationId: ids.centralInstallation,
      recordType: "client",
      recordId: ids.record,
      baseVersion: null,
      operation: "upsert",
      contentHash: "sha256:" + "a".repeat(64),
    })).rejects.toThrow("not found");
  });

  it("derives local authority and omits domain payloads from outbox envelopes", async () => {
    const envelope = await repository.stageChange(client, {
      installationId: ids.localInstallation,
      recordType: "client",
      recordId: ids.record,
      baseVersion: null,
      operation: "upsert",
      contentHash: "sha256:" + "a".repeat(64),
    });
    expect(envelope.change.authority).toBe("local_installation");
    const [row] = await database.query<{ envelope_text: string }>(
      "SELECT envelope::text AS envelope_text FROM sync_outbox WHERE message_id = $1",
      [envelope.messageId],
    );
    expect(JSON.parse(row.envelope_text)).not.toHaveProperty("payload");
  });
});
