import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { createDatabaseClient } from "./client";

async function migration(filename: string): Promise<string> {
  return readFile(new URL("../../../migrations/" + filename, import.meta.url), "utf8");
}

describe("deployment portability migration upgrade", () => {
  it("upgrades populated 0003 data without inventing historical evidence hashes", async () => {
    const database = createDatabaseClient(":memory:");
    try {
      await database.exec(await migration("0001_initial.sql"));
      await database.exec(await migration("0002_runtime_orchestration.sql"));
      await database.exec(await migration("0003_runtime_security_and_delivery.sql"));
      await database.query(
        "INSERT INTO organizations (id, name, slug) VALUES ($1, 'Vincere', 'vincere')",
        ["10000000-0000-4000-8000-000000000001"],
      );
      await database.query(
        "INSERT INTO users (id, organization_id, email, name, password_hash, role) VALUES ($1, $2, 'staff@test.local', 'Staff', 'hash', 'staff')",
        [
          "20000000-0000-4000-8000-000000000001",
          "10000000-0000-4000-8000-000000000001",
        ],
      );
      await database.query(
        "INSERT INTO audit_events (id, organization_id, actor_user_id, action, entity_type, entity_id) VALUES ($1, $2, $3, 'legacy.action', 'organization', $2)",
        [
          "30000000-0000-4000-8000-000000000001",
          "10000000-0000-4000-8000-000000000001",
          "20000000-0000-4000-8000-000000000001",
        ],
      );

      await expect(database.transaction(async (transaction) => {
        await transaction.exec(await migration("0004_deployment_portability.sql"));
        await transaction.exec(await migration("0005_foundation_integrity.sql"));
      })).resolves.toBeUndefined();

      const [audit] = await database.query<{
        origin_installation_id: string | null;
        event_version: number;
        evidence_hash: string | null;
        legacy_unverified: boolean;
        actor_subject_id: string;
      }>("SELECT origin_installation_id, event_version, evidence_hash, legacy_unverified, actor_subject_id FROM audit_events");
      expect(audit.origin_installation_id).toBeNull();
      expect(Number(audit.event_version)).toBe(1);
      expect(audit.evidence_hash).toBeNull();
      expect(audit.legacy_unverified).toBe(true);
      expect(audit.actor_subject_id).toBe("legacy:20000000-0000-4000-8000-000000000001");

      await expect(database.query(
        "INSERT INTO audit_events (id, organization_id, actor_subject_id, action, entity_type, entity_id) VALUES ($1, $2, 'system:test', 'new.action', 'organization', $2)",
        [
          "30000000-0000-4000-8000-000000000002",
          "10000000-0000-4000-8000-000000000001",
        ],
      )).rejects.toThrow();

      await expect(database.query(
        [
          "INSERT INTO product_installations",
          "(id, organization_id, installation_kind, deployment_mode, enrollment_state, created_by)",
          "VALUES ($1, $2, 'local_node', 'LOCAL_ONLY', 'standalone', $3)",
        ].join(" "),
        [
          "40000000-0000-4000-8000-000000000001",
          "10000000-0000-4000-8000-000000000001",
          "20000000-0000-4000-8000-000000000001",
        ],
      )).rejects.toThrow();
    } finally {
      await database.close();
    }
  });
});
