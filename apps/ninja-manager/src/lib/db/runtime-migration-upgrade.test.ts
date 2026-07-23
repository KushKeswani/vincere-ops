import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { createDatabaseClient } from "./client";

const organizationId = "10000000-0000-4000-8000-000000000001";
const staffId = "20000000-0000-4000-8000-000000000001";
const agentId = "30000000-0000-4000-8000-000000000001";
const eventRecordId = "40000000-0000-4000-8000-000000000001";
const eventId = "41000000-0000-4000-8000-000000000001";
const commandRecordId = "50000000-0000-4000-8000-000000000001";
const commandId = "51000000-0000-4000-8000-000000000001";
const acknowledgementRecordId = "60000000-0000-4000-8000-000000000001";
const acknowledgementId = "61000000-0000-4000-8000-000000000001";
const legacySecret = "LEGACY_SECRET_LFE0506703503010";

async function migration(filename: string): Promise<string> {
  return readFile(new URL("../../../migrations/" + filename, import.meta.url), "utf8");
}

describe("runtime security migration upgrade", () => {
  it("quarantines populated 0002 runtime evidence before enforcing 0003 invariants", async () => {
    const database = createDatabaseClient(":memory:");
    try {
      await database.exec(await migration("0001_initial.sql"));
      await database.exec(await migration("0002_runtime_orchestration.sql"));

      await database.query(
        "INSERT INTO organizations (id, name, slug) VALUES ($1, $2, $3)",
        [organizationId, "Vincere", "vincere"],
      );
      await database.query(
        "INSERT INTO users (id, organization_id, email, name, password_hash, role) VALUES ($1, $2, $3, $4, $5, $6)",
        [staffId, organizationId, "staff@test.local", "Staff", "hash", "staff"],
      );
      await database.query(
        [
          "INSERT INTO agent_installations",
          "(id, organization_id, display_name, status, agent_version, protocol_version, capabilities, created_by)",
          "VALUES ($1, $2, $3, 'online', $4, $5, $6::jsonb, $7)",
        ].join(" "),
        [agentId, organizationId, "Legacy VPS", "0.9.0", "1.0", "[]", staffId],
      );
      await database.query(
        [
          "INSERT INTO agent_events",
          "(id, organization_id, agent_id, event_id, sequence, event_type, protocol_version, payload_hash, payload, occurred_at)",
          "VALUES ($1, $2, $3, $4, 7, 'runtime.snapshot', '1.0', $5, $6::jsonb, $7)",
        ].join(" "),
        [
          eventRecordId,
          organizationId,
          agentId,
          eventId,
          "sha256:" + "a".repeat(64),
          JSON.stringify({ rawAccountIdentifier: legacySecret, complete: true }),
          "2026-07-13T18:59:00.000Z",
        ],
      );
      await database.query(
        [
          "INSERT INTO runtime_account_observations",
          "(id, organization_id, agent_id, agent_event_id, account_ref, masked_identifier, identifier_fingerprint, display_name, connection_name, connection_status, observed_at)",
          "VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'connected', $10)",
        ].join(" "),
        [
          "42000000-0000-4000-8000-000000000001",
          organizationId,
          agentId,
          eventRecordId,
          "acct_1234567890abcdef",
          "****3010",
          "hmac-sha256:" + "b".repeat(64),
          legacySecret,
          legacySecret,
          "2026-07-13T18:59:00.000Z",
        ],
      );
      await database.query(
        [
          "INSERT INTO runtime_strategy_observations",
          "(id, organization_id, agent_id, agent_event_id, strategy_ref, account_ref, strategy_name, instrument, timeframe, enabled, sync, runtime_state, state_detail, observed_at)",
          "VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, true, true, 'running', $10, $11)",
        ].join(" "),
        [
          "43000000-0000-4000-8000-000000000001",
          organizationId,
          agentId,
          eventRecordId,
          "strat_1234567890abcdef",
          "acct_1234567890abcdef",
          legacySecret,
          legacySecret,
          legacySecret,
          legacySecret,
          "2026-07-13T18:59:00.000Z",
        ],
      );
      await database.query(
        [
          "INSERT INTO agent_commands",
          "(id, organization_id, agent_id, command_id, idempotency_key, command_type, protocol_version, status, payload_hash, payload, dry_run, issued_at, expires_at, created_by)",
          "VALUES ($1, $2, $3, $4, $5, 'DISCOVER_RUNTIME_STATE', '1.0', 'progress', $6, $7::jsonb, true, $8, $9, $10)",
        ].join(" "),
        [
          commandRecordId,
          organizationId,
          agentId,
          commandId,
          "legacy-discovery-command",
          "sha256:" + "c".repeat(64),
          JSON.stringify({ include: ["accounts", "strategies"], forceFullSnapshot: true, reason: "Legacy inventory" }),
          "2026-07-13T19:00:00.000Z",
          "2026-07-13T19:45:00.000Z",
          staffId,
        ],
      );
      await database.query(
        [
          "INSERT INTO command_acknowledgements",
          "(id, organization_id, agent_id, command_record_id, command_id, acknowledgement_id, status, message, evidence, occurred_at)",
          "VALUES ($1, $2, $3, $4, $5, $6, 'progress', $7, $8::jsonb, $9)",
        ].join(" "),
        [
          acknowledgementRecordId,
          organizationId,
          agentId,
          commandRecordId,
          commandId,
          acknowledgementId,
          "Legacy free-text evidence " + legacySecret,
          JSON.stringify({ rawAccountIdentifier: legacySecret, retrySafe: true }),
          "2026-07-13T19:02:00.000Z",
        ],
      );

      await expect(database.transaction(async (transaction) => {
        await transaction.exec(await migration("0003_runtime_security_and_delivery.sql"));
      })).resolves.toBeUndefined();

      const [agent] = await database.query<{
        status: string;
        last_event_sequence: number;
      }>("SELECT status, last_event_sequence FROM agent_installations WHERE id = $1", [agentId]);
      expect(agent).toMatchObject({ status: "degraded" });
      expect(Number(agent.last_event_sequence)).toBe(7);

      const [event] = await database.query<{
        legacy_unverified: boolean;
        payload_text: string;
      }>(
        "SELECT legacy_unverified, payload::text AS payload_text FROM agent_events WHERE id = $1",
        [eventRecordId],
      );
      expect(event.legacy_unverified).toBe(true);
      expect(JSON.parse(event.payload_text)).toEqual({ legacyRedacted: true });

      const [command] = await database.query<{
        status: string;
        correlation_id: string;
        semantic_hash: string;
        envelope_hash: string;
        issued_at: Date;
        expires_at: Date;
        legacy_unverified: boolean;
      }>(
        [
          "SELECT status, correlation_id, semantic_hash, envelope_hash, issued_at, expires_at, legacy_unverified",
          "FROM agent_commands WHERE id = $1",
        ].join(" "),
        [commandRecordId],
      );
      expect(command).toMatchObject({
        status: "indeterminate",
        correlation_id: commandId,
        legacy_unverified: true,
      });
      expect(command.semantic_hash).toMatch(/^sha256:[a-f0-9]{64}$/);
      expect(command.envelope_hash).toMatch(/^sha256:[a-f0-9]{64}$/);
      expect(new Date(command.expires_at).getTime() - new Date(command.issued_at).getTime()).toBe(10 * 60 * 1000);

      const [acknowledgement] = await database.query<{
        status: string;
        message: string;
        evidence_text: string;
        protocol_version: string;
        correlation_id: string;
        sequence: number;
        evidence_hash: string;
        acknowledgement_hash: string;
        lease_id: string;
        legacy_unverified: boolean;
      }>(
        [
          "SELECT status, message, evidence::text AS evidence_text, protocol_version, correlation_id, sequence,",
          "evidence_hash, acknowledgement_hash, lease_id, legacy_unverified",
          "FROM command_acknowledgements WHERE id = $1",
        ].join(" "),
        [acknowledgementRecordId],
      );
      expect(acknowledgement).toMatchObject({
        status: "indeterminate",
        message: "COMMAND_INDETERMINATE",
        protocol_version: "1.0",
        correlation_id: commandId,
        lease_id: "00000000-0000-4000-8000-000000000000",
        legacy_unverified: true,
      });
      expect(Number(acknowledgement.sequence)).toBe(1);
      expect(acknowledgement.evidence_hash).toMatch(/^sha256:[a-f0-9]{64}$/);
      expect(acknowledgement.acknowledgement_hash).toMatch(/^sha256:[a-f0-9]{64}$/);

      const auditActions = await database.query<{ action: string }>(
        "SELECT action FROM audit_events WHERE action LIKE 'agent.%legacy_quarantined' ORDER BY action",
      );
      expect(auditActions.map((row) => row.action)).toEqual([
        "agent.acknowledgement_legacy_quarantined",
        "agent.command_legacy_quarantined",
        "agent.event_legacy_quarantined",
      ]);

      const [sanitized] = await database.query<{
        event_payload: string;
        acknowledgement_message: string;
        acknowledgement_evidence: string;
        account_display_name: string;
        account_connection_name: string;
        strategy_name: string;
        instrument: string;
        timeframe: string;
        state_detail: string;
      }>(
        [
          "SELECT event.payload::text AS event_payload, acknowledgement.message AS acknowledgement_message,",
          "acknowledgement.evidence::text AS acknowledgement_evidence, account.display_name AS account_display_name,",
          "account.connection_name AS account_connection_name, strategy.strategy_name, strategy.instrument,",
          "strategy.timeframe, strategy.state_detail",
          "FROM agent_events AS event",
          "JOIN runtime_account_observations AS account ON account.agent_event_id = event.id",
          "JOIN runtime_strategy_observations AS strategy ON strategy.agent_event_id = event.id",
          "JOIN command_acknowledgements AS acknowledgement ON acknowledgement.id = $1",
          "WHERE event.id = $2",
        ].join(" "),
        [acknowledgementRecordId, eventRecordId],
      );
      expect(JSON.stringify(sanitized)).not.toContain(legacySecret);
      expect(JSON.parse(acknowledgement.evidence_text)).toMatchObject({
        retrySafe: false,
        errorCode: "INTERNAL_ERROR",
      });
    } finally {
      await database.close();
    }
  });

  it("adds only runtime observation v2 to the event check and reapplies without losing existing event types", async () => {
    const database = createDatabaseClient(":memory:");
    try {
      for (const filename of [
        "0001_initial.sql",
        "0002_runtime_orchestration.sql",
        "0003_runtime_security_and_delivery.sql",
        "0004_deployment_portability.sql",
        "0005_foundation_integrity.sql",
      ]) {
        await database.exec(await migration(filename));
      }
      const v2Migration = await migration("0006_runtime_observation_v2.sql");
      await database.exec(v2Migration);

      await database.query(
        "INSERT INTO organizations (id, name, slug) VALUES ($1, $2, $3)",
        [organizationId, "Vincere", "vincere"],
      );
      await database.query(
        "INSERT INTO users (id, organization_id, email, name, password_hash, role) VALUES ($1, $2, $3, $4, $5, $6)",
        [staffId, organizationId, "staff@test.local", "Staff", "hash", "staff"],
      );
      await database.query(
        [
          "INSERT INTO agent_installations",
          "(id, organization_id, display_name, status, agent_version, protocol_version, capabilities, created_by)",
          "VALUES ($1, $2, $3, 'online', $4, $5, $6::jsonb, $7)",
        ].join(" "),
        [agentId, organizationId, "VPS", "1.0.0", "1.0", "[]", staffId],
      );

      for (const [index, eventType] of [
        "agent.heartbeat",
        "runtime.snapshot",
        "runtime.observation_v2",
      ].entries()) {
        await database.query(
          [
            "INSERT INTO agent_events",
            "(id, organization_id, agent_id, event_id, sequence, event_type, protocol_version, payload_hash, envelope_hash, payload, occurred_at)",
            "VALUES ($1, $2, $3, $4, $5, $6, '1.0', $7, $8, '{}'::jsonb, $9)",
          ].join(" "),
          [
            "70000000-0000-4000-8000-" + String(index + 1).padStart(12, "0"),
            organizationId,
            agentId,
            "71000000-0000-4000-8000-" + String(index + 1).padStart(12, "0"),
            index + 1,
            eventType,
            "sha256:" + "a".repeat(64),
            "sha256:" + "b".repeat(64),
            "2026-07-21T17:00:00.000Z",
          ],
        );
      }
      await expect(database.query(
        [
          "INSERT INTO agent_events",
          "(id, organization_id, agent_id, event_id, sequence, event_type, protocol_version, payload_hash, envelope_hash, payload, occurred_at)",
          "VALUES ($1, $2, $3, $4, 4, 'runtime.unapproved', '1.0', $5, $6, '{}'::jsonb, $7)",
        ].join(" "),
        [
          "72000000-0000-4000-8000-000000000001",
          organizationId,
          agentId,
          "73000000-0000-4000-8000-000000000001",
          "sha256:" + "a".repeat(64),
          "sha256:" + "b".repeat(64),
          "2026-07-21T17:00:00.000Z",
        ],
      )).rejects.toThrow();

      await expect(database.exec(v2Migration)).resolves.toBeUndefined();
      const rows = await database.query<{ event_type: string }>(
        "SELECT event_type FROM agent_events ORDER BY sequence",
      );
      expect(rows.map((row) => row.event_type)).toEqual([
        "agent.heartbeat",
        "runtime.snapshot",
        "runtime.observation_v2",
      ]);
    } finally {
      await database.close();
    }
  });
});
