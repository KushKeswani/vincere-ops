import "server-only";

import { createHash, randomBytes, randomUUID } from "node:crypto";

import type { DatabaseClient, DatabaseTransaction } from "@/lib/db/client";
import { getDatabase } from "@/lib/db/client";
import { agentAuditSubject, userAuditSubject } from "@/lib/domain/audit-evidence";
import {
  acknowledgementHash,
  commandDeliveryEnvelopeHash,
  commandSemanticHash,
  createDeliveredReadOnlyCommandEnvelope,
  hashCanonicalPayload,
  isAcknowledgementTransitionAllowed,
  parseAgentEvent,
  parseCommandAcknowledgement,
  parseRuntimeObservationV2Event,
  processObservationSchema,
  readOnlyCommandEnvelopeSchema,
  RUNTIME_PROTOCOL_VERSION,
  runtimeSnapshotPayloadSchema,
  type DeliveredReadOnlyCommandEnvelope,
  type ProcessObservation,
  type ReadOnlyCommandEnvelope,
  type RuntimeObservationV2Event,
  type RuntimeSnapshotEvent,
} from "@/lib/domain/runtime-contracts";
import type { RuntimeObservationV2 } from "@/lib/domain/runtime-observation-v2";
import { RuntimeServiceError } from "@/lib/domain/runtime-errors";
import type { AuthenticatedUser } from "@/lib/domain/types";
import { requireDeploymentCapability } from "@/lib/deployment/server";
import { writeAuditEvent } from "@/lib/repositories/audit-writer";

const AGENT_TOKEN_PREFIX = "vnm_";
const AGENT_CREDENTIAL_LIFETIME_MS = 90 * 24 * 60 * 60 * 1000;
const MAX_AGENT_CLOCK_SKEW_MS = 5 * 60 * 1000;
const MAX_COMMAND_ISSUE_SKEW_MS = 30 * 1000;
const AGENT_STALE_AFTER_MS = 2 * 60 * 1000;
export const PROCESS_OBSERVATION_FRESH_AFTER_MS = 45 * 1000;
const COMMAND_LEASE_MS = 30 * 1000;
const STRATEGY_INSERT_BATCH_SIZE = 200;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CAPABILITY_PATTERN = /^[a-z][a-z0-9._-]{2,79}$/;

export interface AgentIdentity {
  agentId: string;
  organizationId: string;
  credentialId: string;
  protocolVersion: string;
}

export interface AgentEnrollment {
  agentId: string;
  token: string;
  tokenLastFour: string;
  expiresAt: Date;
}

export interface AgentInstallation {
  id: string;
  displayName: string;
  configuredStatus: string;
  effectiveStatus: "online" | "degraded" | "offline" | "stale" | "disabled";
  agentVersion: string;
  protocolVersion: string;
  capabilities: string[];
  lastHeartbeatAt: Date | null;
  lastContactAt: Date | null;
  addonConnected: boolean | null;
  addonVersion: string | null;
  pendingEventCount: number | null;
  lastEventSequence: number;
  environmentId: string | null;
  processObservation: AgentProcessObservation | null;
}

export interface AgentProcessObservation {
  evidenceEventId: string;
  evidenceSequence: number;
  observedAt: Date;
  receivedAt: Date;
  installationRef: string;
  state: ProcessObservation["state"];
  processStateVersion: string | null;
  processRef: string | null;
  matchedProcessCount: number | null;
  unavailableReason: ProcessObservation["unavailableReason"];
  freshness: {
    status: "fresh" | "stale";
    ageMs: number;
    maxAgeMs: number;
    expiresAt: Date;
  };
}

export interface RuntimeAccountRow {
  account_ref: string;
  masked_identifier: string;
  display_name: string;
  account_type: "simulation" | "evaluation" | "live" | "unknown";
  connection_name: string;
  connection_status: string;
  observed_at: Date;
}

export interface RuntimeStrategyRow {
  strategy_ref: string;
  account_ref: string;
  strategy_name: string;
  strategy_type: string;
  instrument: string;
  timeframe: string;
  enabled: boolean;
  sync: boolean | null;
  runtime_state: string;
  state_detail: string | null;
  observed_at: Date;
}

export interface LatestRuntimeSnapshot {
  eventId: string;
  sequence: number;
  observedAt: Date;
  receivedAt: Date;
  collectionMode: "authoritative_read_only" | "supervised_simulation";
  addonVersion: string;
  stateVersion: string;
  accounts: RuntimeAccountRow[];
  strategies: RuntimeStrategyRow[];
}

export interface LatestRuntimeObservationV2 {
  protocolVersion: RuntimeObservationV2Event["protocolVersion"];
  eventType: RuntimeObservationV2Event["eventType"];
  eventId: string;
  agentId: string;
  sequence: number;
  correlationId: string | null;
  causationId: string | null;
  occurredAt: Date;
  receivedAt: Date;
  payloadHash: string;
  envelopeHash: string;
  observation: RuntimeObservationV2;
}

export interface CommandSummary {
  commandId: string;
  commandType: string;
  status: string;
  issuedAt: Date;
  expiresAt: Date;
  deliveryAttempts: number;
  lastAckSequence: number;
  lastAckAt: Date | null;
}

export interface EnqueueCommandResult {
  id: string;
  commandId: string;
  correlationId: string;
  status: string;
  duplicate: boolean;
}

export interface LeasedCommand {
  envelope: DeliveredReadOnlyCommandEnvelope;
  leaseId: string;
  leaseExpiresAt: Date;
  deliveryAttempt: number;
}

type Clock = () => Date;

interface AgentLockRow {
  id: string;
  last_event_sequence: number;
  status: string;
}

interface StoredCommandRow {
  id: string;
  command_id: string;
  correlation_id: string;
  idempotency_key: string;
  command_type: ReadOnlyCommandEnvelope["commandType"];
  protocol_version: string;
  status: string;
  payload: unknown;
  dry_run: boolean;
  expected_state_version: string | null;
  approval_id: string | null;
  issued_at: Date;
  expires_at: Date;
  semantic_hash: string;
  payload_hash: string;
  envelope_hash: string;
  delivery_attempts: number;
  last_ack_sequence: number;
  bound_lease_id: string | null;
  bound_delivery_attempt: number | null;
}

export class RuntimeRepository {
  constructor(
    private readonly database: DatabaseClient = getDatabase(),
    private readonly clock: Clock = () => new Date(),
  ) {}

  async enrollAgent(
    user: AuthenticatedUser,
    input: {
      id?: string;
      displayName: string;
      agentVersion: string;
      protocolVersion: string;
      capabilities: string[];
      environmentId?: string;
    },
  ): Promise<AgentEnrollment> {
    this.requireStaff(user);
    if (input.protocolVersion !== RUNTIME_PROTOCOL_VERSION) {
      throw new RuntimeServiceError("CONFLICT", "Unsupported agent protocol version");
    }
    if (input.id && !UUID_PATTERN.test(input.id)) {
      throw new Error("Agent identifier must be a UUID");
    }
    if (!input.displayName.trim() || input.displayName.length > 120) {
      throw new Error("Agent display name is required and must be at most 120 characters");
    }
    if (!input.agentVersion.trim() || input.agentVersion.length > 40) {
      throw new Error("Agent version is required and must be at most 40 characters");
    }
    if (
      input.capabilities.length > 100
      || input.capabilities.some((item) => !CAPABILITY_PATTERN.test(item))
    ) {
      throw new Error("Agent capabilities are invalid");
    }

    const agentId = input.id ?? randomUUID();
    const credentialId = randomUUID();
    const token = this.generateToken();
    const tokenHash = this.hashToken(token);
    const expiresAt = new Date(this.clock().getTime() + AGENT_CREDENTIAL_LIFETIME_MS);

    await this.database.transaction(async (transaction) => {
      if (input.environmentId) {
        const environment = await transaction.query<{ id: string }>(
          "SELECT id FROM environments WHERE id = $1 AND organization_id = $2",
          [input.environmentId, user.organizationId],
        );
        if (!environment[0]) throw new RuntimeServiceError("AGENT_NOT_FOUND", "Authorized environment not found");
      }
      await transaction.query(
        "INSERT INTO agent_installations (id, organization_id, environment_id, display_name, agent_version, protocol_version, capabilities, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)",
        [
          agentId,
          user.organizationId,
          input.environmentId ?? null,
          input.displayName.trim(),
          input.agentVersion.trim(),
          input.protocolVersion,
          JSON.stringify([...new Set(input.capabilities)].sort()),
          user.id,
        ],
      );
      await transaction.query(
        "INSERT INTO agent_credentials (id, organization_id, agent_id, token_hash, token_last_four, created_by, created_at, expires_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
        [credentialId, user.organizationId, agentId, tokenHash, token.slice(-4), user.id, this.clock(), expiresAt],
      );
      await this.audit(transaction, user.organizationId, user.id, userAuditSubject(user.id), "agent.enrolled", "agent_installation", agentId, {
        agentVersion: input.agentVersion,
        protocolVersion: input.protocolVersion,
        capabilities: input.capabilities,
        credentialId,
      });
    });

    return { agentId, token, tokenLastFour: token.slice(-4), expiresAt };
  }

  async rotateAgentCredential(user: AuthenticatedUser, agentId: string): Promise<AgentEnrollment> {
    this.requireStaff(user);
    const credentialId = randomUUID();
    const token = this.generateToken();
    const expiresAt = new Date(this.clock().getTime() + AGENT_CREDENTIAL_LIFETIME_MS);

    await this.database.transaction(async (transaction) => {
      const agent = await this.requireAgentForStaff(transaction, user, agentId, true);
      if (agent.status === "disabled") {
        throw new RuntimeServiceError("CONFLICT", "A disabled agent credential cannot be rotated");
      }
      await transaction.query(
        "UPDATE agent_credentials SET revoked_at = $1, revoked_by = $2 WHERE agent_id = $3 AND organization_id = $4 AND revoked_at IS NULL",
        [this.clock(), user.id, agentId, user.organizationId],
      );
      await transaction.query(
        "INSERT INTO agent_credentials (id, organization_id, agent_id, token_hash, token_last_four, created_by, created_at, expires_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
        [credentialId, user.organizationId, agentId, this.hashToken(token), token.slice(-4), user.id, this.clock(), expiresAt],
      );
      await transaction.query(
        "UPDATE agent_credentials SET replaced_by_id = $1 WHERE agent_id = $2 AND organization_id = $3 AND id <> $1 AND revoked_at IS NOT NULL AND replaced_by_id IS NULL",
        [credentialId, agentId, user.organizationId],
      );
      await this.audit(transaction, user.organizationId, user.id, userAuditSubject(user.id), "agent.credential_rotated", "agent_installation", agentId, {
        credentialId,
      });
    });

    return { agentId, token, tokenLastFour: token.slice(-4), expiresAt };
  }

  async revokeAgent(user: AuthenticatedUser, agentId: string): Promise<void> {
    this.requireStaff(user);
    await this.database.transaction(async (transaction) => {
      const agent = await this.requireAgentForStaff(transaction, user, agentId, true);
      if (agent.status === "disabled") return;
      const disabled = await transaction.query<{ id: string }>(
        "UPDATE agent_installations SET status = 'disabled', updated_at = $1 WHERE id = $2 AND organization_id = $3 AND status <> 'disabled' RETURNING id",
        [this.clock(), agentId, user.organizationId],
      );
      if (!disabled[0]) throw new RuntimeServiceError("CONFLICT", "Agent status changed before revocation");
      await transaction.query(
        "UPDATE agent_credentials SET revoked_at = $1, revoked_by = $2 WHERE agent_id = $3 AND organization_id = $4 AND revoked_at IS NULL",
        [this.clock(), user.id, agentId, user.organizationId],
      );
      await this.audit(transaction, user.organizationId, user.id, userAuditSubject(user.id), "agent.revoked", "agent_installation", agentId, {});
    });
  }

  async authenticateAgentToken(token: string): Promise<AgentIdentity | null> {
    if (!token.startsWith(AGENT_TOKEN_PREFIX) || token.length < 32 || token.length > 200) return null;
    const now = this.clock();
    return this.database.transaction(async (transaction) => {
      const rows = await transaction.query<{
        credential_id: string;
        agent_id: string;
        organization_id: string;
        protocol_version: string;
      }>(
        [
          "SELECT c.id AS credential_id, a.id AS agent_id, a.organization_id, a.protocol_version",
          "FROM agent_credentials c JOIN agent_installations a ON a.id = c.agent_id AND a.organization_id = c.organization_id",
          "WHERE c.token_hash = $1 AND c.revoked_at IS NULL AND c.expires_at > $2 AND a.status <> 'disabled'",
          "LIMIT 1",
        ].join(" "),
        [this.hashToken(token), now],
      );
      const row = rows[0];
      if (!row) return null;
      await transaction.query(
        "UPDATE agent_installations SET last_authenticated_at = $1, last_contact_at = $1, updated_at = $1 WHERE id = $2 AND organization_id = $3",
        [now, row.agent_id, row.organization_id],
      );
      return {
        agentId: row.agent_id,
        organizationId: row.organization_id,
        credentialId: row.credential_id,
        protocolVersion: row.protocol_version,
      };
    });
  }

  async recordAgentEvent(identity: AgentIdentity, input: unknown): Promise<{
    duplicate: boolean;
    eventRecordId: string;
    acceptedSequence: number;
  }> {
    const event = parseAgentEvent(input);
    if (event.agentId !== identity.agentId) {
      throw new RuntimeServiceError("FORBIDDEN", "Agent identity does not match event envelope");
    }
    this.assertAgentTimestamp(event.occurredAt);
    const observationTimestamp = event.eventType === "runtime.observation_v2"
      ? event.payload.asOf
      : event.payload.observedAt;
    this.assertAgentTimestamp(observationTimestamp);
    const processObservation = event.eventType === "agent.heartbeat"
      ? event.payload.processObservation
      : undefined;
    if (processObservation) this.assertAgentTimestamp(processObservation.observedAt);

    return this.database.transaction(async (transaction) => {
      const receivedAt = this.clock();
      const agent = await this.requireAuthenticatedAgent(transaction, identity);
      const existingRows = await transaction.query<{ id: string; envelope_hash: string; sequence: number }>(
        "SELECT id, envelope_hash, sequence FROM agent_events WHERE agent_id = $1 AND event_id = $2",
        [identity.agentId, event.eventId],
      );
      const existing = existingRows[0];
      if (existing) {
        if (existing.envelope_hash !== event.envelopeHash || Number(existing.sequence) !== event.sequence) {
          throw new RuntimeServiceError("CONFLICT", "Event replay conflicts with stored evidence");
        }
        return { duplicate: true, eventRecordId: existing.id, acceptedSequence: Number(existing.sequence) };
      }

      const expectedSequence = Number(agent.last_event_sequence) + 1;
      if (event.sequence < expectedSequence) {
        throw new RuntimeServiceError("SEQUENCE_STALE", "Event sequence is stale");
      }
      if (event.sequence > expectedSequence) {
        throw new RuntimeServiceError(
          "SEQUENCE_GAP",
          "Event sequence has a gap; replay the durable outbox in order",
          { expectedNextSequence: expectedSequence },
        );
      }

      const eventRecordId = randomUUID();
      await transaction.query(
        [
          "INSERT INTO agent_events",
          "(id, organization_id, agent_id, event_id, sequence, event_type, protocol_version, correlation_id, causation_id, payload_hash, envelope_hash, credential_id, payload, occurred_at)",
          "VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb, $14)",
        ].join(" "),
        [
          eventRecordId,
          identity.organizationId,
          identity.agentId,
          event.eventId,
          event.sequence,
          event.eventType,
          event.protocolVersion,
          event.correlationId,
          event.causationId,
          event.payloadHash,
          event.envelopeHash,
          identity.credentialId,
          JSON.stringify(event.payload),
          event.occurredAt,
        ],
      );

      if (event.eventType === "runtime.snapshot") {
        await this.insertRuntimeSnapshot(transaction, identity, eventRecordId, event);
        await this.audit(
          transaction,
          identity.organizationId,
          null,
          agentAuditSubject(identity.agentId),
          "agent.runtime_snapshot_recorded",
          "agent_event",
          eventRecordId,
          {
            agentId: identity.agentId,
            eventId: event.eventId,
            sequence: event.sequence,
            payloadHash: event.payloadHash,
            envelopeHash: event.envelopeHash,
            collectionMode: event.payload.collectionMode,
            stateVersion: event.payload.stateVersion,
            accountCount: event.payload.accounts.length,
            strategyCount: event.payload.strategies.length,
          },
        );
      } else if (event.eventType === "runtime.observation_v2") {
        await this.bindRuntimeIdentities(transaction, identity, event);
        await this.audit(
          transaction,
          identity.organizationId,
          null,
          agentAuditSubject(identity.agentId),
          "agent.runtime_observation_v2_recorded",
          "agent_event",
          eventRecordId,
          {
            agentId: identity.agentId,
            eventId: event.eventId,
            sequence: event.sequence,
            payloadHash: event.payloadHash,
            envelopeHash: event.envelopeHash,
            observationId: event.payload.observationId,
            stateDigest: event.payload.stateDigest,
            completeness: event.payload.state.collection.overall,
            accountCount: event.payload.state.accounts.length,
            strategyCount: event.payload.state.strategies.length,
          },
        );
      } else if (processObservation) {
        await this.audit(
          transaction,
          identity.organizationId,
          null,
          agentAuditSubject(identity.agentId),
          "agent.process_observation_recorded",
          "agent_event",
          eventRecordId,
          {
            agentId: identity.agentId,
            eventId: event.eventId,
            sequence: event.sequence,
            payloadHash: event.payloadHash,
            envelopeHash: event.envelopeHash,
            installationRef: processObservation.installationRef,
            state: processObservation.state,
            processStateVersion: processObservation.processStateVersion,
            processRef: processObservation.processRef,
            matchedProcessCount: processObservation.matchedProcessCount,
            unavailableReason: processObservation.unavailableReason,
          },
        );
      }

      let updateSql: string;
      let updateParameters: unknown[];
      if (event.eventType === "agent.heartbeat" && processObservation) {
        updateSql = [
          "UPDATE agent_installations",
          "SET status = $1, last_heartbeat_at = $2, last_contact_at = $3, last_event_sequence = $4,",
          "protocol_version = $5, agent_version = $6, addon_connected = $7, addon_version = $8,",
          "pending_event_count = $9, process_evidence_event_id = $10, process_evidence_sequence = $11,",
          "process_observed_at = $12, process_evidence_received_at = $13, process_installation_ref = $14,",
          "process_state_version = $15, process_state = $16, process_ref = $17, process_matched_count = $18,",
          "process_unavailable_reason = $19, updated_at = $3",
          "WHERE id = $20 AND organization_id = $21 AND last_event_sequence = $22 RETURNING id",
        ].join(" ");
        updateParameters = [
          event.payload.health,
          event.payload.observedAt,
          receivedAt,
          event.sequence,
          event.protocolVersion,
          event.payload.agentVersion,
          event.payload.addonConnected,
          event.payload.addonVersion,
          event.payload.pendingEventCount,
          eventRecordId,
          event.sequence,
          processObservation.observedAt,
          receivedAt,
          processObservation.installationRef,
          processObservation.processStateVersion,
          processObservation.state,
          processObservation.processRef,
          processObservation.matchedProcessCount,
          processObservation.unavailableReason,
          identity.agentId,
          identity.organizationId,
          agent.last_event_sequence,
        ];
      } else if (event.eventType === "agent.heartbeat") {
        // A legacy heartbeat retains the last evidence row. The read model always recomputes
        // freshness, so retained evidence expires instead of being silently presented as current.
        updateSql = [
            "UPDATE agent_installations",
            "SET status = $1, last_heartbeat_at = $2, last_contact_at = $3, last_event_sequence = $4,",
            "protocol_version = $5, agent_version = $6, addon_connected = $7, addon_version = $8,",
            "pending_event_count = $9, updated_at = $3",
            "WHERE id = $10 AND organization_id = $11 AND last_event_sequence = $12 RETURNING id",
          ].join(" ");
        updateParameters = [
          event.payload.health,
          event.payload.observedAt,
          receivedAt,
          event.sequence,
          event.protocolVersion,
          event.payload.agentVersion,
          event.payload.addonConnected,
          event.payload.addonVersion,
          event.payload.pendingEventCount,
          identity.agentId,
          identity.organizationId,
          agent.last_event_sequence,
        ];
      } else {
        updateSql = [
          "UPDATE agent_installations",
          "SET last_contact_at = $1, last_event_sequence = $2, protocol_version = $3, updated_at = $1",
          "WHERE id = $4 AND organization_id = $5 AND last_event_sequence = $6 RETURNING id",
        ].join(" ");
        updateParameters = [
          receivedAt,
          event.sequence,
          event.protocolVersion,
          identity.agentId,
          identity.organizationId,
          agent.last_event_sequence,
        ];
      }
      const updated = await transaction.query<{ id: string }>(updateSql, updateParameters);
      if (!updated[0]) throw new RuntimeServiceError("CONFLICT", "Concurrent agent sequence update rejected");

      return { duplicate: false, eventRecordId, acceptedSequence: event.sequence };
    });
  }

  async recordRuntimeSnapshot(
    identity: AgentIdentity,
    input: unknown,
  ): Promise<{ duplicate: boolean; eventRecordId: string; acceptedSequence: number }> {
    const event = parseAgentEvent(input);
    if (event.eventType !== "runtime.snapshot") throw new Error("Expected a runtime snapshot event");
    return this.recordAgentEvent(identity, event);
  }

  async listAgents(user: AuthenticatedUser): Promise<AgentInstallation[]> {
    this.requireRuntimeReader(user);
    const accessJoin = user.role === "client"
      ? [
        "JOIN environments environment ON environment.id = agent.environment_id AND environment.organization_id = agent.organization_id",
        "JOIN clients client ON client.id = environment.client_id AND client.organization_id = agent.organization_id",
      ].join(" ")
      : "";
    const accessPredicate = user.role === "client" ? "AND client.user_id = $2" : "";
    const rows = await this.database.query<{
      id: string;
      display_name: string;
      status: string;
      agent_version: string;
      protocol_version: string;
      capabilities: unknown;
      last_heartbeat_at: Date | null;
      last_contact_at: Date | null;
      addon_connected: boolean | null;
      addon_version: string | null;
      pending_event_count: number | null;
      last_event_sequence: number;
      environment_id: string | null;
      process_evidence_event_id: string | null;
      process_evidence_sequence: number | null;
      process_observed_at: Date | null;
      process_evidence_received_at: Date | null;
      process_installation_ref: string | null;
      process_state_version: string | null;
      process_state: string | null;
      process_ref: string | null;
      process_matched_count: number | null;
      process_unavailable_reason: string | null;
    }>(
      [
        "SELECT agent.id, agent.display_name, agent.status, agent.agent_version, agent.protocol_version, agent.capabilities,",
        "agent.last_heartbeat_at, agent.last_contact_at, agent.addon_connected, agent.addon_version, agent.pending_event_count,",
        "agent.last_event_sequence, agent.environment_id, agent.process_evidence_event_id, agent.process_evidence_sequence,",
        "agent.process_observed_at, agent.process_evidence_received_at, agent.process_installation_ref, agent.process_state_version,",
        "agent.process_state, agent.process_ref, agent.process_matched_count, agent.process_unavailable_reason",
        "FROM agent_installations agent", accessJoin,
        "WHERE agent.organization_id = $1", accessPredicate, "ORDER BY agent.display_name",
      ].join(" "),
      user.role === "client" ? [user.organizationId, user.id] : [user.organizationId],
    );
    const now = this.clock().getTime();
    return rows.map((row) => {
      let effectiveStatus: AgentInstallation["effectiveStatus"];
      if (row.status === "disabled") effectiveStatus = "disabled";
      else if (!row.last_heartbeat_at) effectiveStatus = "offline";
      else if (now - new Date(row.last_heartbeat_at).getTime() > AGENT_STALE_AFTER_MS) effectiveStatus = "stale";
      else if (row.status === "degraded" || row.addon_connected === false) effectiveStatus = "degraded";
      else effectiveStatus = "online";
      let processObservation: AgentProcessObservation | null = null;
      if (row.process_evidence_event_id !== null) {
        const observedAt = new Date(row.process_observed_at as Date);
        const receivedAt = new Date(row.process_evidence_received_at as Date);
        const parsed = processObservationSchema.parse({
          observedAt: observedAt.toISOString(),
          installationRef: row.process_installation_ref,
          state: row.process_state,
          processStateVersion: row.process_state_version,
          processRef: row.process_ref,
          matchedProcessCount: row.process_matched_count === null
            ? null
            : Number(row.process_matched_count),
          unavailableReason: row.process_unavailable_reason,
        });
        const freshnessBasis = Math.min(observedAt.getTime(), receivedAt.getTime());
        const ageMs = Math.max(0, now - freshnessBasis);
        processObservation = {
          evidenceEventId: row.process_evidence_event_id,
          evidenceSequence: Number(row.process_evidence_sequence),
          observedAt,
          receivedAt,
          installationRef: parsed.installationRef,
          state: parsed.state,
          processStateVersion: parsed.processStateVersion,
          processRef: parsed.processRef,
          matchedProcessCount: parsed.matchedProcessCount,
          unavailableReason: parsed.unavailableReason,
          freshness: {
            status: ageMs <= PROCESS_OBSERVATION_FRESH_AFTER_MS ? "fresh" : "stale",
            ageMs,
            maxAgeMs: PROCESS_OBSERVATION_FRESH_AFTER_MS,
            expiresAt: new Date(freshnessBasis + PROCESS_OBSERVATION_FRESH_AFTER_MS),
          },
        };
      }
      return {
        id: row.id,
        displayName: row.display_name,
        configuredStatus: row.status,
        effectiveStatus,
        agentVersion: row.agent_version,
        protocolVersion: row.protocol_version,
        capabilities: this.toStringArray(row.capabilities),
        lastHeartbeatAt: row.last_heartbeat_at,
        lastContactAt: row.last_contact_at,
        addonConnected: row.addon_connected,
        addonVersion: row.addon_version,
        pendingEventCount: row.pending_event_count === null ? null : Number(row.pending_event_count),
        lastEventSequence: Number(row.last_event_sequence),
        environmentId: row.environment_id,
        processObservation,
      };
    });
  }

  async getLatestRuntimeSnapshot(user: AuthenticatedUser, agentId: string): Promise<LatestRuntimeSnapshot | null> {
    this.requireRuntimeReader(user);
    if (user.role === "client") {
      await this.requireAgentForRuntimeUser(this.database, user, agentId);
    }
    const events = await this.database.query<{
      id: string;
      event_id: string;
      sequence: number;
      occurred_at: Date;
      received_at: Date;
      payload: unknown;
    }>(
      [
        "SELECT id, event_id, sequence, occurred_at, received_at, payload",
        "FROM agent_events",
        "WHERE agent_id = $1 AND organization_id = $2 AND event_type = 'runtime.snapshot' AND legacy_unverified = false",
        "ORDER BY sequence DESC LIMIT 1",
      ].join(" "),
      [agentId, user.organizationId],
    );
    const event = events[0];
    if (!event) return null;
    const payload = runtimeSnapshotPayloadSchema.parse(event.payload);
    const [accounts, strategies] = await Promise.all([
      this.database.query<RuntimeAccountRow>(
        [
          "SELECT account_ref, masked_identifier, display_name, account_type, connection_name, connection_status, observed_at",
          "FROM runtime_account_observations",
          "WHERE agent_event_id = $1 AND organization_id = $2 ORDER BY display_name",
        ].join(" "),
        [event.id, user.organizationId],
      ),
      this.database.query<RuntimeStrategyRow>(
        [
          "SELECT strategy_ref, account_ref, strategy_name, strategy_type, instrument, timeframe, enabled, sync, runtime_state, state_detail, observed_at",
          "FROM runtime_strategy_observations",
          "WHERE agent_event_id = $1 AND organization_id = $2 ORDER BY account_ref, strategy_name",
        ].join(" "),
        [event.id, user.organizationId],
      ),
    ]);
    return {
      eventId: event.event_id,
      sequence: Number(event.sequence),
      observedAt: new Date(payload.observedAt),
      receivedAt: event.received_at,
      collectionMode: payload.collectionMode,
      addonVersion: payload.addonVersion,
      stateVersion: payload.stateVersion,
      accounts,
      strategies,
    };
  }

  async getLatestRuntimeObservationV2(
    user: AuthenticatedUser,
    agentId: string,
  ): Promise<LatestRuntimeObservationV2 | null> {
    this.requireRuntimeReader(user);
    if (user.role === "client") {
      await this.requireAgentForRuntimeUser(this.database, user, agentId);
    }
    const events = await this.database.query<{
      protocol_version: string;
      event_id: string;
      agent_id: string;
      sequence: number;
      correlation_id: string | null;
      causation_id: string | null;
      occurred_at: Date;
      received_at: Date;
      payload_hash: string;
      envelope_hash: string;
      payload: unknown;
    }>(
      [
        "SELECT protocol_version, event_id, agent_id, sequence, correlation_id, causation_id,",
        "occurred_at, received_at, payload_hash, envelope_hash, payload",
        "FROM agent_events",
        "WHERE agent_id = $1 AND organization_id = $2 AND event_type = 'runtime.observation_v2' AND legacy_unverified = false",
        "ORDER BY sequence DESC LIMIT 1",
      ].join(" "),
      [agentId, user.organizationId],
    );
    const stored = events[0];
    if (!stored) return null;
    const event = parseRuntimeObservationV2Event({
      protocolVersion: stored.protocol_version,
      eventType: "runtime.observation_v2",
      eventId: stored.event_id,
      agentId: stored.agent_id,
      sequence: Number(stored.sequence),
      correlationId: stored.correlation_id,
      causationId: stored.causation_id,
      occurredAt: new Date(stored.occurred_at).toISOString(),
      payloadHash: stored.payload_hash,
      envelopeHash: stored.envelope_hash,
      payload: stored.payload,
    });
    return {
      protocolVersion: event.protocolVersion,
      eventType: event.eventType,
      eventId: event.eventId,
      agentId: event.agentId,
      sequence: event.sequence,
      correlationId: event.correlationId,
      causationId: event.causationId,
      occurredAt: new Date(event.occurredAt),
      receivedAt: stored.received_at,
      payloadHash: event.payloadHash,
      envelopeHash: event.envelopeHash,
      observation: event.payload,
    };
  }

  async listCommands(user: AuthenticatedUser, agentId: string): Promise<CommandSummary[]> {
    this.requireRuntimeCommander(user);
    return this.database.transaction(async (transaction) => {
      await this.requireAgentForRuntimeUser(transaction, user, agentId);
      await this.expireCommands(
        transaction,
        { agentId, organizationId: user.organizationId },
        this.clock(),
        user.id,
      );
      const rows = await transaction.query<{
        command_id: string;
        command_type: string;
        status: string;
        issued_at: Date;
        expires_at: Date;
        delivery_attempts: number;
        last_ack_sequence: number;
        last_ack_at: Date | null;
      }>(
        [
          "SELECT command_id, command_type, status, issued_at, expires_at, delivery_attempts, last_ack_sequence, last_ack_at",
          "FROM agent_commands WHERE agent_id = $1 AND organization_id = $2",
          "ORDER BY created_at DESC LIMIT 50",
        ].join(" "),
        [agentId, user.organizationId],
      );
      return rows.map((row) => ({
        commandId: row.command_id,
        commandType: row.command_type,
        status: row.status,
        issuedAt: row.issued_at,
        expiresAt: row.expires_at,
        deliveryAttempts: Number(row.delivery_attempts),
        lastAckSequence: Number(row.last_ack_sequence),
        lastAckAt: row.last_ack_at,
      }));
    });
  }

  async enqueueReadOnlyCommand(
    user: AuthenticatedUser,
    input: ReadOnlyCommandEnvelope,
  ): Promise<EnqueueCommandResult> {
    this.requireRuntimeCommander(user);
    const command = readOnlyCommandEnvelopeSchema.parse(input);
    const now = this.clock();
    if (Date.parse(command.issuedAt) > now.getTime() + MAX_COMMAND_ISSUE_SKEW_MS) {
      throw new RuntimeServiceError("CONFLICT", "Command issue time is too far in the future");
    }
    if (Date.parse(command.expiresAt) <= now.getTime()) {
      throw new RuntimeServiceError("COMMAND_EXPIRED", "Command is already expired");
    }
    const payloadHash = hashCanonicalPayload(command.payload);
    const semanticHash = commandSemanticHash(command);
    const envelopeHash = commandDeliveryEnvelopeHash(command, payloadHash, semanticHash);

    return this.database.transaction(async (transaction) => {
      await this.requireAgentForRuntimeUser(transaction, user, command.agentId);
      const agentRows = await transaction.query<{ capabilities: unknown }>(
        "SELECT capabilities FROM agent_installations WHERE id = $1 AND organization_id = $2",
        [command.agentId, user.organizationId],
      );
      const capabilities = this.toStringArray(agentRows[0]?.capabilities);
      const requiredCapability = {
        DISCOVER_RUNTIME_STATE: "runtime.discovery",
        COLLECT_ACCOUNT_SNAPSHOT: "runtime.accounts.read",
        COLLECT_EXECUTIONS: "runtime.executions.read",
      }[command.commandType];
      if (!capabilities.includes(requiredCapability)) {
        throw new RuntimeServiceError("CONFLICT", "Agent does not advertise the required read-only capability");
      }
      if (command.commandType === "COLLECT_EXECUTIONS") {
        throw new RuntimeServiceError(
          "CONFLICT",
          "Execution collection remains disabled until its versioned result-event contract is implemented",
        );
      }
      if (command.expectedStateVersion) {
        const latestEvents = await transaction.query<{ payload: unknown }>(
          [
            "SELECT payload FROM agent_events",
            "WHERE agent_id = $1 AND organization_id = $2 AND event_type = 'runtime.snapshot' AND legacy_unverified = false",
            "ORDER BY sequence DESC LIMIT 1",
          ].join(" "),
          [command.agentId, user.organizationId],
        );
        const latestPayload = latestEvents[0] ? runtimeSnapshotPayloadSchema.parse(latestEvents[0].payload) : null;
        if (!latestPayload || latestPayload.stateVersion !== command.expectedStateVersion) {
          throw new RuntimeServiceError("CONFLICT", "Expected runtime state version is stale");
        }
      }

      const id = randomUUID();
      const inserted = await transaction.query<{ id: string; status: string; command_id: string; correlation_id: string }>(
        [
          "INSERT INTO agent_commands",
          "(id, organization_id, agent_id, command_id, correlation_id, idempotency_key, command_type, protocol_version, semantic_hash, payload_hash, envelope_hash, payload, dry_run, expected_state_version, approval_id, issued_at, expires_at, created_by)",
          "VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13, $14, $15, $16, $17, $18)",
          "ON CONFLICT DO NOTHING",
          "RETURNING id, status, command_id, correlation_id",
        ].join(" "),
        [
          id,
          user.organizationId,
          command.agentId,
          command.commandId,
          command.correlationId,
          command.idempotencyKey,
          command.commandType,
          command.protocolVersion,
          semanticHash,
          payloadHash,
          envelopeHash,
          JSON.stringify(command.payload),
          command.dryRun,
          command.expectedStateVersion,
          command.approvalId,
          command.issuedAt,
          command.expiresAt,
          user.id,
        ],
      );
      if (inserted[0]) {
        await this.audit(transaction, user.organizationId, user.id, userAuditSubject(user.id), "agent.command_queued", "agent_command", id, {
          agentId: command.agentId,
          commandId: command.commandId,
          correlationId: command.correlationId,
          commandType: command.commandType,
          semanticHash,
          payloadHash,
          envelopeHash,
          dryRun: true,
          expiresAt: command.expiresAt,
        });
        return {
          id: inserted[0].id,
          commandId: inserted[0].command_id,
          correlationId: inserted[0].correlation_id,
          status: inserted[0].status,
          duplicate: false,
        };
      }

      const existingRows = await transaction.query<{
        id: string;
        status: string;
        command_id: string;
        correlation_id: string;
        semantic_hash: string;
      }>(
        [
          "SELECT id, status, command_id, correlation_id, semantic_hash FROM agent_commands",
          "WHERE agent_id = $1 AND idempotency_key = $2 AND organization_id = $3",
        ].join(" "),
        [command.agentId, command.idempotencyKey, user.organizationId],
      );
      const existing = existingRows[0];
      if (!existing || existing.semantic_hash !== semanticHash) {
        throw new RuntimeServiceError("CONFLICT", "Idempotency key conflicts with a different command");
      }
      return {
        id: existing.id,
        commandId: existing.command_id,
        correlationId: existing.correlation_id,
        status: existing.status,
        duplicate: true,
      };
    });
  }

  async leaseCommands(identity: AgentIdentity, requestedLimit = 5): Promise<LeasedCommand[]> {
    const limit = Math.max(1, Math.min(10, Math.trunc(requestedLimit)));
    const now = this.clock();
    return this.database.transaction(async (transaction) => {
      await this.requireAuthenticatedAgent(transaction, identity);
      await this.expireCommands(transaction, identity, now);
      const commands = await transaction.query<StoredCommandRow>(
        [
          "SELECT c.id, c.command_id, c.correlation_id, c.idempotency_key, c.command_type, c.protocol_version,",
          "c.status, c.payload, c.dry_run, c.expected_state_version, c.approval_id, c.issued_at, c.expires_at,",
          "c.semantic_hash, c.payload_hash, c.envelope_hash, c.delivery_attempts, c.last_ack_sequence,",
          "c.bound_lease_id, c.bound_delivery_attempt",
          "FROM agent_commands c",
          "WHERE c.agent_id = $1 AND c.organization_id = $2 AND c.status = 'queued' AND c.expires_at > $3",
          "AND NOT EXISTS (SELECT 1 FROM command_deliveries d WHERE d.command_record_id = c.id AND d.lease_expires_at > $3)",
          "AND NOT EXISTS (",
          "SELECT 1 FROM agent_commands prior WHERE prior.agent_id = c.agent_id",
          "AND prior.organization_id = c.organization_id",
          "AND prior.status IN ('queued', 'accepted', 'started', 'progress')",
          "AND (prior.created_at < c.created_at OR (prior.created_at = c.created_at AND prior.id < c.id))",
          ")",
          "ORDER BY c.created_at FOR UPDATE SKIP LOCKED LIMIT " + String(limit),
        ].join(" "),
        [identity.agentId, identity.organizationId, now],
      );

      const leased: LeasedCommand[] = [];
      for (const command of commands) {
        let commandEnvelope: ReadOnlyCommandEnvelope;
        try {
          commandEnvelope = this.toCommandEnvelope(command, identity.agentId);
          const actualPayloadHash = hashCanonicalPayload(commandEnvelope.payload);
          const actualSemanticHash = commandSemanticHash(commandEnvelope);
          const actualEnvelopeHash = commandDeliveryEnvelopeHash(
            commandEnvelope,
            actualPayloadHash,
            actualSemanticHash,
          );
          if (
            actualPayloadHash !== command.payload_hash
            || actualSemanticHash !== command.semantic_hash
            || actualEnvelopeHash !== command.envelope_hash
          ) {
            throw new Error("Stored command integrity mismatch");
          }
        } catch {
          await transaction.query(
            "UPDATE agent_commands SET status = 'indeterminate', updated_at = $1 WHERE id = $2 AND organization_id = $3",
            [now, command.id, identity.organizationId],
          );
          await this.audit(
            transaction,
            identity.organizationId,
            null,
            agentAuditSubject(identity.agentId),
            "agent.command_integrity_failed",
            "agent_command",
            command.id,
            {
              agentId: identity.agentId,
              commandId: command.command_id,
              storedPayloadHash: command.payload_hash,
              storedSemanticHash: command.semantic_hash,
              storedEnvelopeHash: command.envelope_hash,
            },
          );
          continue;
        }

        const leaseId = randomUUID();
        const attempt = Number(command.delivery_attempts) + 1;
        const deliveryId = randomUUID();
        const leaseExpiresAt = new Date(Math.min(
          now.getTime() + COMMAND_LEASE_MS,
          new Date(command.expires_at).getTime(),
        ));
        const deliveredEnvelope = createDeliveredReadOnlyCommandEnvelope(commandEnvelope);
        await transaction.query(
          [
            "INSERT INTO command_deliveries",
            "(id, organization_id, agent_id, command_record_id, credential_id, lease_id, attempt, delivered_at, lease_expires_at, canonicalization, payload_hash, semantic_hash, envelope_hash)",
            "VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)",
          ].join(" "),
          [
            deliveryId,
            identity.organizationId,
            identity.agentId,
            command.id,
            identity.credentialId,
            leaseId,
            attempt,
            now,
            leaseExpiresAt,
            deliveredEnvelope.integrity.canonicalization,
            deliveredEnvelope.integrity.payloadHash,
            deliveredEnvelope.integrity.semanticHash,
            deliveredEnvelope.integrity.envelopeHash,
          ],
        );
        await transaction.query(
          [
            "UPDATE agent_commands SET delivery_attempts = $1, first_delivered_at = COALESCE(first_delivered_at, $2),",
            "last_delivered_at = $2, updated_at = $2 WHERE id = $3 AND organization_id = $4",
          ].join(" "),
          [attempt, now, command.id, identity.organizationId],
        );
        leased.push({
          envelope: deliveredEnvelope,
          leaseId,
          leaseExpiresAt,
          deliveryAttempt: attempt,
        });
      }
      return leased;
    });
  }

  async recordAcknowledgement(
    identity: AgentIdentity,
    input: unknown,
  ): Promise<{ duplicate: boolean; status: string; acknowledgementRecordId: string }> {
    const acknowledgement = parseCommandAcknowledgement(input);
    if (acknowledgement.agentId !== identity.agentId) {
      throw new RuntimeServiceError("FORBIDDEN", "Agent identity does not match acknowledgement");
    }
    this.assertAgentTimestamp(acknowledgement.occurredAt);
    const storedHash = acknowledgementHash(acknowledgement);

    return this.database.transaction(async (transaction) => {
      const receivedAt = this.clock();
      await this.requireAuthenticatedAgent(transaction, identity);
      const commandRows = await transaction.query<{
        id: string;
        status: string;
        correlation_id: string;
        issued_at: Date;
        expires_at: Date;
        delivery_attempts: number;
        last_ack_sequence: number;
        bound_lease_id: string | null;
        bound_delivery_attempt: number | null;
      }>(
        [
          "SELECT id, status, correlation_id, issued_at, expires_at, delivery_attempts, last_ack_sequence,",
          "bound_lease_id, bound_delivery_attempt FROM agent_commands",
          "WHERE agent_id = $1 AND organization_id = $2 AND command_id = $3 FOR UPDATE",
        ].join(" "),
        [identity.agentId, identity.organizationId, acknowledgement.commandId],
      );
      const command = commandRows[0];
      if (!command) throw new RuntimeServiceError("COMMAND_NOT_FOUND", "Command not found");
      if (command.correlation_id !== acknowledgement.correlationId) {
        throw new RuntimeServiceError("CONFLICT", "Acknowledgement correlation does not match command");
      }

      const duplicateRows = await transaction.query<{ id: string; acknowledgement_hash: string; status: string }>(
        "SELECT id, acknowledgement_hash, status FROM command_acknowledgements WHERE agent_id = $1 AND acknowledgement_id = $2",
        [identity.agentId, acknowledgement.acknowledgementId],
      );
      const duplicate = duplicateRows[0];
      if (duplicate) {
        if (duplicate.acknowledgement_hash !== storedHash) {
          throw new RuntimeServiceError("CONFLICT", "Acknowledgement replay conflicts with stored evidence");
        }
        return { duplicate: true, status: duplicate.status, acknowledgementRecordId: duplicate.id };
      }

      const deliveries = await transaction.query<{
        id: string;
        credential_id: string;
        attempt: number;
        delivered_at: Date;
        lease_expires_at: Date;
      }>(
        [
          "SELECT id, credential_id, attempt, delivered_at, lease_expires_at FROM command_deliveries",
          "WHERE command_record_id = $1 AND organization_id = $2 AND agent_id = $3 AND lease_id = $4",
        ].join(" "),
        [command.id, identity.organizationId, identity.agentId, acknowledgement.leaseId],
      );
      const delivery = deliveries[0];
      if (!delivery) throw new RuntimeServiceError("INVALID_DELIVERY", "Acknowledgement delivery lease is unknown");

      const expectedSequence = Number(command.last_ack_sequence) + 1;
      if (acknowledgement.sequence < expectedSequence) {
        throw new RuntimeServiceError("SEQUENCE_STALE", "Acknowledgement sequence is stale");
      }
      if (acknowledgement.sequence > expectedSequence) {
        throw new RuntimeServiceError(
          "SEQUENCE_GAP",
          "Acknowledgement sequence has a gap",
          { expectedNextSequence: expectedSequence },
        );
      }
      const occurredAt = Date.parse(acknowledgement.occurredAt);
      const issuedAt = new Date(command.issued_at).getTime();
      const deliveredAt = new Date(delivery.delivered_at).getTime();
      const expiresAt = new Date(command.expires_at).getTime();
      if (receivedAt.getTime() >= expiresAt || occurredAt > expiresAt) {
        throw new RuntimeServiceError("COMMAND_EXPIRED", "Command expired before acknowledgement was received");
      }
      if (occurredAt < issuedAt || occurredAt < deliveredAt) {
        throw new RuntimeServiceError("INVALID_DELIVERY", "Acknowledgement predates command delivery");
      }
      if (delivery.credential_id !== identity.credentialId) {
        throw new RuntimeServiceError("INVALID_DELIVERY", "Acknowledgement credential does not match delivery");
      }
      if (expectedSequence === 1) {
        if (
          command.bound_lease_id !== null
          || Number(delivery.attempt) !== Number(command.delivery_attempts)
          || receivedAt.getTime() >= new Date(delivery.lease_expires_at).getTime()
        ) {
          throw new RuntimeServiceError("INVALID_DELIVERY", "Initial acknowledgement lease is stale");
        }
      } else if (
        command.bound_lease_id !== acknowledgement.leaseId
        || Number(command.bound_delivery_attempt) !== Number(delivery.attempt)
      ) {
        throw new RuntimeServiceError("INVALID_DELIVERY", "Acknowledgement changed the command delivery binding");
      }
      if (!isAcknowledgementTransitionAllowed(command.status, acknowledgement.status)) {
        throw new RuntimeServiceError(
          "INVALID_TRANSITION",
          "Command acknowledgement transition is not allowed from " + command.status,
        );
      }

      const acknowledgementRecordId = randomUUID();
      await transaction.query(
        [
          "INSERT INTO command_acknowledgements",
          "(id, organization_id, agent_id, command_record_id, command_id, acknowledgement_id, protocol_version, correlation_id, sequence, status, message, evidence, evidence_hash, acknowledgement_hash, credential_id, lease_id, occurred_at)",
          "VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13, $14, $15, $16, $17)",
        ].join(" "),
        [
          acknowledgementRecordId,
          identity.organizationId,
          identity.agentId,
          command.id,
          acknowledgement.commandId,
          acknowledgement.acknowledgementId,
          acknowledgement.protocolVersion,
          acknowledgement.correlationId,
          acknowledgement.sequence,
          acknowledgement.status,
          acknowledgement.messageCode,
          JSON.stringify(acknowledgement.evidence),
          acknowledgement.evidenceHash,
          storedHash,
          identity.credentialId,
          acknowledgement.leaseId,
          acknowledgement.occurredAt,
        ],
      );
      await transaction.query(
        [
          "UPDATE agent_commands SET status = $1, last_ack_sequence = $2, last_ack_at = $3, updated_at = $4,",
          "bound_lease_id = COALESCE(bound_lease_id, $5),",
          "bound_delivery_attempt = COALESCE(bound_delivery_attempt, $6)",
          "WHERE id = $7 AND organization_id = $8",
        ].join(" "),
        [
          acknowledgement.status,
          acknowledgement.sequence,
          acknowledgement.occurredAt,
          receivedAt,
          acknowledgement.leaseId,
          delivery.attempt,
          command.id,
          identity.organizationId,
        ],
      );
      await this.audit(
        transaction,
        identity.organizationId,
        null,
        agentAuditSubject(identity.agentId),
        "agent.command_" + acknowledgement.status,
        "agent_command",
        command.id,
        {
          agentId: identity.agentId,
          commandId: acknowledgement.commandId,
          acknowledgementId: acknowledgement.acknowledgementId,
          sequence: acknowledgement.sequence,
          evidenceHash: acknowledgement.evidenceHash,
          acknowledgementHash: storedHash,
          leaseId: acknowledgement.leaseId,
        },
      );
      return { duplicate: false, status: acknowledgement.status, acknowledgementRecordId };
    });
  }

  private async insertRuntimeSnapshot(
    transaction: DatabaseTransaction,
    identity: AgentIdentity,
    eventRecordId: string,
    event: RuntimeSnapshotEvent,
  ): Promise<void> {
    await this.bindRuntimeIdentities(transaction, identity, event);
    const accountRows = event.payload.accounts.map((account) => [
      randomUUID(),
      identity.organizationId,
      identity.agentId,
      eventRecordId,
      account.accountRef,
      account.maskedIdentifier,
      account.identifierFingerprint,
      account.displayLabel,
      account.accountType,
      account.connectionKind,
      account.connectionStatus,
      event.payload.observedAt,
    ]);
    await this.insertRows(
      transaction,
      [
        "INSERT INTO runtime_account_observations",
        "(id, organization_id, agent_id, agent_event_id, account_ref, masked_identifier, identifier_fingerprint, display_name, account_type, connection_name, connection_status, observed_at)",
      ].join(" "),
      accountRows,
    );

    for (let offset = 0; offset < event.payload.strategies.length; offset += STRATEGY_INSERT_BATCH_SIZE) {
      const strategyRows = event.payload.strategies
        .slice(offset, offset + STRATEGY_INSERT_BATCH_SIZE)
        .map((strategy) => [
          randomUUID(),
          identity.organizationId,
          identity.agentId,
          eventRecordId,
          strategy.strategyRef,
          strategy.accountRef,
          strategy.displayLabel,
          strategy.strategyType,
          strategy.instrumentCode,
          strategy.timeframeCode,
          strategy.enabled,
          strategy.sync,
          strategy.runtimeState,
          strategy.stateCode,
          event.payload.observedAt,
        ]);
      await this.insertRows(
        transaction,
        [
          "INSERT INTO runtime_strategy_observations",
          "(id, organization_id, agent_id, agent_event_id, strategy_ref, account_ref, strategy_name, strategy_type, instrument, timeframe, enabled, sync, runtime_state, state_detail, observed_at)",
        ].join(" "),
        strategyRows,
      );
    }
  }

  private async bindRuntimeIdentities(
    transaction: DatabaseTransaction,
    identity: AgentIdentity,
    event: RuntimeSnapshotEvent | RuntimeObservationV2Event,
  ): Promise<void> {
    const accounts = event.eventType === "runtime.observation_v2"
      ? event.payload.state.accounts
      : event.payload.accounts;
    const strategies = event.eventType === "runtime.observation_v2"
      ? event.payload.state.strategies.map((strategy) => ({
          strategyRef: strategy.strategyRef,
          accountRef: strategy.accountRef,
          strategyType: strategy.strategyTypeCode,
        }))
      : event.payload.strategies.map((strategy) => ({
          strategyRef: strategy.strategyRef,
          accountRef: strategy.accountRef,
          strategyType: strategy.strategyType,
        }));
    const accountIdentityRows = accounts.map((account) => [
      randomUUID(),
      identity.organizationId,
      identity.agentId,
      account.accountRef,
      account.identifierFingerprint,
    ]);
    await this.insertRows(
      transaction,
      [
        "INSERT INTO runtime_account_identities",
        "(id, organization_id, agent_id, account_ref, identifier_fingerprint)",
      ].join(" "),
      accountIdentityRows,
      " ON CONFLICT DO NOTHING",
    );

    for (let offset = 0; offset < strategies.length; offset += STRATEGY_INSERT_BATCH_SIZE) {
      const strategyIdentityRows = strategies
        .slice(offset, offset + STRATEGY_INSERT_BATCH_SIZE)
        .map((strategy) => [
          randomUUID(),
          identity.organizationId,
          identity.agentId,
          strategy.strategyRef,
          strategy.accountRef,
          strategy.strategyType,
        ]);
      await this.insertRows(
        transaction,
        [
          "INSERT INTO runtime_strategy_identities",
          "(id, organization_id, agent_id, strategy_ref, account_ref, strategy_type)",
        ].join(" "),
        strategyIdentityRows,
        " ON CONFLICT DO NOTHING",
      );
    }

    const storedAccounts = await transaction.query<{
      account_ref: string;
      identifier_fingerprint: string;
    }>(
      "SELECT account_ref, identifier_fingerprint FROM runtime_account_identities WHERE organization_id = $1 AND agent_id = $2",
      [identity.organizationId, identity.agentId],
    );
    const accountBindings = new Map(storedAccounts.map((row) => [row.account_ref, row.identifier_fingerprint]));
    for (const account of accounts) {
      if (accountBindings.get(account.accountRef) !== account.identifierFingerprint) {
        throw new RuntimeServiceError("CONFLICT", "Runtime account identity binding changed");
      }
    }

    const storedStrategies = await transaction.query<{
      strategy_ref: string;
      account_ref: string;
      strategy_type: string;
    }>(
      "SELECT strategy_ref, account_ref, strategy_type FROM runtime_strategy_identities WHERE organization_id = $1 AND agent_id = $2",
      [identity.organizationId, identity.agentId],
    );
    const strategyBindings = new Map(storedStrategies.map((row) => [
      row.strategy_ref,
      { accountRef: row.account_ref, strategyType: row.strategy_type },
    ]));
    for (const strategy of strategies) {
      const binding = strategyBindings.get(strategy.strategyRef);
      if (
        !binding
        || binding.accountRef !== strategy.accountRef
        || binding.strategyType !== strategy.strategyType
      ) {
        throw new RuntimeServiceError("CONFLICT", "Runtime strategy identity binding changed");
      }
    }
  }

  private async insertRows(
    transaction: DatabaseTransaction,
    insertPrefix: string,
    rows: unknown[][],
    suffix = "",
  ): Promise<void> {
    if (!rows.length) return;
    const columnCount = rows[0].length;
    if (!rows.every((row) => row.length === columnCount)) throw new Error("Bulk insert row shape mismatch");
    let parameter = 1;
    const placeholders = rows.map(() => {
      const rowPlaceholders = Array.from({ length: columnCount }, () => "$" + parameter++);
      return "(" + rowPlaceholders.join(", ") + ")";
    });
    await transaction.query(insertPrefix + " VALUES " + placeholders.join(", ") + suffix, rows.flat());
  }

  private async expireCommands(
    transaction: DatabaseTransaction,
    identity: Pick<AgentIdentity, "agentId" | "organizationId">,
    now: Date,
    actorUserId: string | null = null,
  ): Promise<void> {
    const expired = await transaction.query<{ id: string; command_id: string }>(
      [
        "UPDATE agent_commands SET status = 'expired', updated_at = $1",
        "WHERE agent_id = $2 AND organization_id = $3 AND expires_at <= $1",
        "AND status IN ('queued', 'accepted', 'started', 'progress')",
        "RETURNING id, command_id",
      ].join(" "),
      [now, identity.agentId, identity.organizationId],
    );
    for (const command of expired) {
      await this.audit(
        transaction,
        identity.organizationId,
        actorUserId,
        actorUserId ? userAuditSubject(actorUserId) : agentAuditSubject(identity.agentId),
        "agent.command_expired",
        "agent_command",
        command.id,
        { agentId: identity.agentId, commandId: command.command_id, expiredAt: now.toISOString() },
      );
    }
  }

  private async requireAuthenticatedAgent(
    transaction: DatabaseTransaction,
    identity: AgentIdentity,
  ): Promise<AgentLockRow> {
    const rows = await transaction.query<AgentLockRow>(
      [
        "SELECT a.id, a.last_event_sequence, a.status",
        "FROM agent_installations a",
        "JOIN agent_credentials c ON c.agent_id = a.id AND c.organization_id = a.organization_id",
        "WHERE a.id = $1 AND a.organization_id = $2 AND c.id = $3",
        "AND c.revoked_at IS NULL AND c.expires_at > $4 AND a.status <> 'disabled'",
        "AND a.protocol_version = $5 FOR UPDATE",
      ].join(" "),
      [
        identity.agentId,
        identity.organizationId,
        identity.credentialId,
        this.clock(),
        identity.protocolVersion,
      ],
    );
    if (!rows[0]) throw new RuntimeServiceError("UNAUTHORIZED", "Authorized agent credential not found");
    return rows[0];
  }

  private async requireAgentForStaff(
    database: Pick<DatabaseTransaction, "query">,
    user: AuthenticatedUser,
    agentId: string,
    lock = false,
  ): Promise<{ id: string; status: string }> {
    const rows = await database.query<{ id: string; status: string }>(
      "SELECT id, status FROM agent_installations WHERE id = $1 AND organization_id = $2" + (lock ? " FOR UPDATE" : ""),
      [agentId, user.organizationId],
    );
    if (!rows[0]) throw new RuntimeServiceError("AGENT_NOT_FOUND", "Authorized agent installation not found");
    return rows[0];
  }

  private async requireAgentForRuntimeUser(
    database: Pick<DatabaseTransaction, "query">,
    user: AuthenticatedUser,
    agentId: string,
    lock = false,
  ): Promise<{ id: string; status: string }> {
    const rows = user.role === "client"
      ? await database.query<{ id: string; status: string }>(
        [
          "SELECT agent.id, agent.status FROM agent_installations agent",
          "JOIN environments environment ON environment.id = agent.environment_id AND environment.organization_id = agent.organization_id",
          "JOIN clients client ON client.id = environment.client_id AND client.organization_id = agent.organization_id",
          "WHERE agent.id = $1 AND agent.organization_id = $2 AND client.user_id = $3",
          lock ? "FOR UPDATE OF agent" : "",
        ].join(" "),
        [agentId, user.organizationId, user.id],
      )
      : await database.query<{ id: string; status: string }>(
        "SELECT id, status FROM agent_installations WHERE id = $1 AND organization_id = $2" + (lock ? " FOR UPDATE" : ""),
        [agentId, user.organizationId],
      );
    if (!rows[0]) throw new RuntimeServiceError("AGENT_NOT_FOUND", "Authorized agent installation not found");
    return rows[0];
  }

  private toCommandEnvelope(command: StoredCommandRow, agentId: string): ReadOnlyCommandEnvelope {
    return readOnlyCommandEnvelopeSchema.parse({
      protocolVersion: command.protocol_version,
      commandId: command.command_id,
      correlationId: command.correlation_id,
      agentId,
      idempotencyKey: command.idempotency_key,
      commandType: command.command_type,
      issuedAt: new Date(command.issued_at).toISOString(),
      expiresAt: new Date(command.expires_at).toISOString(),
      expectedStateVersion: command.expected_state_version,
      approvalId: command.approval_id,
      dryRun: command.dry_run,
      payload: this.toJsonObject(command.payload),
    });
  }

  private toJsonObject(value: unknown): Record<string, unknown> {
    if (typeof value === "string") {
      const parsed = JSON.parse(value) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Stored JSON object is invalid");
      return parsed as Record<string, unknown>;
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Stored JSON object is invalid");
    return value as Record<string, unknown>;
  }

  private toStringArray(value: unknown): string[] {
    const parsed = typeof value === "string" ? JSON.parse(value) as unknown : value;
    if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === "string")) return [];
    return parsed;
  }

  private assertAgentTimestamp(timestamp: string): void {
    if (Date.parse(timestamp) > this.clock().getTime() + MAX_AGENT_CLOCK_SKEW_MS) {
      throw new RuntimeServiceError("CONFLICT", "Agent timestamp is too far in the future");
    }
  }

  private generateToken(): string {
    return AGENT_TOKEN_PREFIX + randomBytes(32).toString("base64url");
  }

  private hashToken(token: string): string {
    return createHash("sha256").update(token).digest("hex");
  }

  private requireStaff(user: AuthenticatedUser): void {
    if (user.role !== "staff") throw new RuntimeServiceError("FORBIDDEN", "Forbidden");
  }

  private deploymentAllows(capability: Parameters<typeof requireDeploymentCapability>[0]): boolean {
    // Fail-closed: any failure to confirm the capability (absent capability OR a
    // deployment-configuration error) yields false. NOTE: this also swallows genuine
    // config errors, so a misconfiguration surfaces as FORBIDDEN rather than a clear
    // config error — a known diagnosability trade-off (see baseline handoff notes).
    try {
      requireDeploymentCapability(capability);
      return true;
    } catch {
      return false;
    }
  }

  private requireRuntimeReader(user: AuthenticatedUser): void {
    // Staff are the fleet operators and read via fleet.runtime (central) or
    // transport.local (local-only); the client operator reads only via
    // transport.local. This mirrors the action-layer authorization in
    // src/app/actions/runtime.ts. Central runtime evidence stays private to
    // clients until a client-issued, scope-bound OTP support grant is validated
    // at this boundary.
    if (user.role === "staff" && (this.deploymentAllows("fleet.runtime") || this.deploymentAllows("transport.local"))) return;
    if (user.role === "client" && this.deploymentAllows("transport.local")) return;
    throw new RuntimeServiceError("FORBIDDEN", "Forbidden");
  }

  private requireRuntimeCommander(user: AuthenticatedUser): void {
    // Same operator model as reads, and every command additionally requires the
    // durable runtime queue. Clients receive no implicit central fallback.
    if (this.deploymentAllows("runtime.queue")) {
      if (user.role === "staff" && (this.deploymentAllows("fleet.runtime") || this.deploymentAllows("transport.local"))) return;
      if (user.role === "client" && this.deploymentAllows("transport.local")) return;
    }
    throw new RuntimeServiceError("FORBIDDEN", "Forbidden");
  }

  private async audit(
    transaction: Pick<DatabaseTransaction, "query">,
    organizationId: string,
    actorUserId: string | null,
    actorSubjectId: string,
    action: string,
    entityType: string,
    entityId: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await writeAuditEvent(transaction, {
      organizationId,
      actorUserId,
      actorSubjectId,
      action,
      entityType,
      entityId,
      metadata,
      occurredAt: this.clock(),
    });
  }
}

export function getRuntimeRepository(): RuntimeRepository {
  return new RuntimeRepository();
}
