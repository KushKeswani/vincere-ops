import "server-only";

import { randomUUID } from "node:crypto";

import { z } from "zod";

import type { DatabaseClient, DatabaseTransaction } from "@/lib/db/client";
import { getDatabase } from "@/lib/db/client";
import { agentAuditSubject, userAuditSubject } from "@/lib/domain/audit-evidence";
import {
  createDeliveredProcessControlCommand,
  MAX_PROCESS_CONTROL_APPROVAL_TTL_MS,
  parseProcessControlAcknowledgement,
  PROCESS_CONTROL_PROTOCOL_VERSION,
  processControlApprovalIntentHash,
  processControlCommandSchema,
  processQuitRuntimeStateSchema,
  type DeliveredProcessControlCommand,
  type ProcessControlAcknowledgement,
  type ProcessControlCommand,
} from "@/lib/domain/process-control-contracts";
import { hashCanonicalPayload } from "@/lib/domain/runtime-contracts";
import { RuntimeServiceError } from "@/lib/domain/runtime-errors";
import type { AuthenticatedUser } from "@/lib/domain/types";
import { requireDeploymentCapability } from "@/lib/deployment/server";
import type { AgentIdentity } from "@/lib/repositories/runtime-repository";
import { writeAuditEvent } from "@/lib/repositories/audit-writer";

const MAX_AGENT_CLOCK_SKEW_MS = 5 * 60_000;
const uuid = z.uuid();
const sha256 = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const installationRef = z.string().regex(/^install_[a-z0-9]{16,64}$/);
const processRef = z.string().regex(/^process_[a-z0-9]{16,64}$/);
const idempotencyKey = z.string().regex(/^[A-Za-z0-9:._-]{16,200}$/);

const createApprovalInputSchema = z.discriminatedUnion("commandType", [
  z.object({
    agentId: uuid,
    commandType: z.literal("LAUNCH_NINJATRADER"),
    expectedProcessStateVersion: sha256,
    target: z.object({ installationRef }).strict(),
  }).strict(),
  z.object({
    agentId: uuid,
    commandType: z.literal("REQUEST_NINJATRADER_QUIT"),
    expectedProcessStateVersion: sha256,
    target: z.object({ installationRef, processRef }).strict(),
    runtimeState: processQuitRuntimeStateSchema,
  }).strict(),
]);

const enqueueInputSchema = z.object({
  agentId: uuid,
  approvalId: uuid,
  idempotencyKey,
}).strict();

type Clock = () => Date;

interface ApprovalRow {
  id: string;
  agent_id: string;
  approved_by: string;
  interactive_confirmation_id: string;
  command_type: ProcessControlCommand["commandType"];
  intent_hash: string;
  expected_process_state_version: string;
  runtime_state_digest: string | null;
  intent_payload: unknown;
  issued_at: Date;
  expires_at: Date;
  consumed_at: Date | null;
  consumed_by_command_id: string | null;
}

interface StoredCommandRow {
  id: string;
  approval_id: string;
  command_id: string;
  correlation_id: string;
  idempotency_key: string;
  command_type: ProcessControlCommand["commandType"];
  status: string;
  command: unknown;
  expected_process_state_version: string;
  runtime_state_digest: string | null;
  approval_intent_hash: string;
  payload_hash: string;
  semantic_hash: string;
  envelope_hash: string;
  issued_at: Date;
  expires_at: Date;
  delivery_attempts: number;
  last_ack_sequence: number;
}

export interface ProcessControlApprovalResult {
  approvalId: string;
  interactiveConfirmationId: string;
  commandType: ProcessControlCommand["commandType"];
  intentHash: string;
  issuedAt: Date;
  expiresAt: Date;
}

export interface EnqueuedProcessControlCommand {
  recordId: string;
  commandId: string;
  correlationId: string;
  status: string;
  duplicate: boolean;
}

export interface LeasedProcessControlCommand {
  envelope: DeliveredProcessControlCommand;
  leaseId: string;
  leaseExpiresAt: Date;
  deliveryAttempt: 1;
}

export interface RecordedProcessControlAcknowledgement {
  acknowledgementRecordId: string;
  status: ProcessControlAcknowledgement["status"];
  duplicate: boolean;
}

export interface ProcessControlCommandSafetyCounts {
  inFlight: number;
  indeterminate: number;
}

export class ProcessControlRepository {
  constructor(
    private readonly database: DatabaseClient = getDatabase(),
    private readonly clock: Clock = () => new Date(),
  ) {}

  async createApproval(
    user: AuthenticatedUser,
    input: unknown,
  ): Promise<ProcessControlApprovalResult> {
    this.requireProcessController(user);
    const value = createApprovalInputSchema.parse(input);
    const issuedAt = this.clock();
    const expiresAt = new Date(issuedAt.getTime() + MAX_PROCESS_CONTROL_APPROVAL_TTL_MS);
    const approvalId = randomUUID();
    const interactiveConfirmationId = randomUUID();
    const payload = value.commandType === "LAUNCH_NINJATRADER"
      ? { target: value.target, reasonCode: "MANUAL_OPERATOR_LAUNCH" as const }
      : {
          target: value.target,
          reasonCode: "MANUAL_OPERATOR_QUIT" as const,
          runtimeState: value.runtimeState,
        };
    const intentHash = processControlApprovalIntentHash({
      commandType: value.commandType,
      payload,
    } as unknown as ProcessControlCommand);

    // Parse a complete preview so approval creation cannot persist an intent that
    // the finalized command contract would later reject.
    processControlCommandSchema.parse({
      protocolVersion: PROCESS_CONTROL_PROTOCOL_VERSION,
      commandId: randomUUID(),
      correlationId: randomUUID(),
      agentId: value.agentId,
      idempotencyKey: `approval-preview:${approvalId}`,
      commandType: value.commandType,
      issuedAt: issuedAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      expectedProcessStateVersion: value.expectedProcessStateVersion,
      dryRun: false,
      safetyPhase: "local_supervised_process_control",
      approval: {
        approvalId,
        interactiveConfirmationId,
        approvedCommandType: value.commandType,
        issuedAt: issuedAt.toISOString(),
        expiresAt: expiresAt.toISOString(),
        intentHash,
      },
      payload,
    });

    await this.database.transaction(async (transaction) => {
      await this.requireAgentForUser(transaction, user, value.agentId);
      await transaction.query(
        [
          "INSERT INTO process_control_approvals",
          "(id, organization_id, agent_id, interactive_confirmation_id, approved_by, command_type, intent_hash,",
          "expected_process_state_version, runtime_state_digest, intent_payload, issued_at, expires_at, created_at)",
          "VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12, $11)",
        ].join(" "),
        [
          approvalId,
          user.organizationId,
          value.agentId,
          interactiveConfirmationId,
          user.id,
          value.commandType,
          intentHash,
          value.expectedProcessStateVersion,
          value.commandType === "REQUEST_NINJATRADER_QUIT" ? value.runtimeState.digest : null,
          JSON.stringify(payload),
          issuedAt,
          expiresAt,
        ],
      );
      await this.audit(
        transaction,
        user.organizationId,
        user.id,
        userAuditSubject(user.id),
        "process_control.approval_created",
        "process_control_approval",
        approvalId,
        {
          agentId: value.agentId,
          commandType: value.commandType,
          interactiveConfirmationId,
          intentHash,
          expectedProcessStateVersion: value.expectedProcessStateVersion,
          runtimeStateDigest: value.commandType === "REQUEST_NINJATRADER_QUIT" ? value.runtimeState.digest : null,
          expiresAt: expiresAt.toISOString(),
        },
      );
    });

    return { approvalId, interactiveConfirmationId, commandType: value.commandType, intentHash, issuedAt, expiresAt };
  }

  async enqueueApprovedCommand(
    user: AuthenticatedUser,
    input: unknown,
  ): Promise<EnqueuedProcessControlCommand> {
    this.requireProcessController(user);
    const value = enqueueInputSchema.parse(input);
    const now = this.clock();

    return this.database.transaction(async (transaction) => {
      await this.requireAgentForUser(transaction, user, value.agentId, true);
      const existingRows = await transaction.query<{
        id: string;
        approval_id: string;
        created_by: string;
        command_id: string;
        correlation_id: string;
        status: string;
      }>(
        [
          "SELECT id, approval_id, created_by, command_id, correlation_id, status FROM process_control_commands",
          "WHERE organization_id = $1 AND agent_id = $2 AND idempotency_key = $3",
        ].join(" "),
        [user.organizationId, value.agentId, value.idempotencyKey],
      );
      const existing = existingRows[0];
      if (existing) {
        if (existing.approval_id !== value.approvalId) {
          throw new RuntimeServiceError("CONFLICT", "Idempotency key belongs to a different process approval");
        }
        if (existing.created_by !== user.id) {
          throw new RuntimeServiceError("FORBIDDEN", "Process command retry is bound to a different operator");
        }
        return {
          recordId: existing.id,
          commandId: existing.command_id,
          correlationId: existing.correlation_id,
          status: existing.status,
          duplicate: true,
        };
      }

      const approvals = await transaction.query<ApprovalRow>(
        [
          "SELECT id, agent_id, approved_by, interactive_confirmation_id, command_type, intent_hash,",
          "expected_process_state_version, runtime_state_digest, intent_payload, issued_at, expires_at,",
          "consumed_at, consumed_by_command_id FROM process_control_approvals",
          "WHERE id = $1 AND organization_id = $2 AND agent_id = $3 FOR UPDATE",
        ].join(" "),
        [value.approvalId, user.organizationId, value.agentId],
      );
      const approval = approvals[0];
      if (!approval) throw new RuntimeServiceError("FORBIDDEN", "Authorized process approval not found");
      if (approval.approved_by !== user.id) {
        throw new RuntimeServiceError("FORBIDDEN", "Process approval is bound to a different operator");
      }
      if (approval.consumed_at !== null || approval.consumed_by_command_id !== null) {
        throw new RuntimeServiceError("CONFLICT", "Process approval has already been consumed");
      }
      const approvalExpiresAt = new Date(approval.expires_at);
      if (approvalExpiresAt.getTime() <= now.getTime()) {
        throw new RuntimeServiceError("COMMAND_EXPIRED", "Process approval has expired");
      }

      const commandId = randomUUID();
      const correlationId = randomUUID();
      const recordId = randomUUID();
      const command = processControlCommandSchema.parse({
        protocolVersion: PROCESS_CONTROL_PROTOCOL_VERSION,
        commandId,
        correlationId,
        agentId: value.agentId,
        idempotencyKey: value.idempotencyKey,
        commandType: approval.command_type,
        issuedAt: now.toISOString(),
        expiresAt: approvalExpiresAt.toISOString(),
        expectedProcessStateVersion: approval.expected_process_state_version,
        dryRun: false,
        safetyPhase: "local_supervised_process_control",
        approval: {
          approvalId: approval.id,
          interactiveConfirmationId: approval.interactive_confirmation_id,
          approvedCommandType: approval.command_type,
          issuedAt: new Date(approval.issued_at).toISOString(),
          expiresAt: approvalExpiresAt.toISOString(),
          intentHash: approval.intent_hash,
        },
        payload: this.toJsonObject(approval.intent_payload),
      });
      const delivered = createDeliveredProcessControlCommand(command);
      if (command.approval.intentHash !== approval.intent_hash) {
        throw new RuntimeServiceError("CONFLICT", "Stored process approval intent changed");
      }
      if (
        command.commandType === "REQUEST_NINJATRADER_QUIT"
        && command.payload.runtimeState.digest !== approval.runtime_state_digest
      ) {
        throw new RuntimeServiceError("CONFLICT", "Stored quit runtime digest changed");
      }

      await transaction.query(
        [
          "INSERT INTO process_control_commands",
          "(id, organization_id, agent_id, approval_id, command_id, correlation_id, idempotency_key, command_type,",
          "protocol_version, status, command, expected_process_state_version, runtime_state_digest,",
          "approval_intent_hash, payload_hash, semantic_hash, envelope_hash, issued_at, expires_at, created_by, created_at, updated_at)",
          "VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'queued', $10::jsonb, $11, $12, $13, $14, $15, $16, $17, $18, $19, $17, $17)",
        ].join(" "),
        [
          recordId,
          user.organizationId,
          value.agentId,
          approval.id,
          commandId,
          correlationId,
          value.idempotencyKey,
          command.commandType,
          command.protocolVersion,
          JSON.stringify(command),
          command.expectedProcessStateVersion,
          command.commandType === "REQUEST_NINJATRADER_QUIT" ? command.payload.runtimeState.digest : null,
          command.approval.intentHash,
          delivered.integrity.payloadHash,
          delivered.integrity.semanticHash,
          delivered.integrity.envelopeHash,
          now,
          approvalExpiresAt,
          user.id,
        ],
      );
      const consumed = await transaction.query<{ id: string }>(
        [
          "UPDATE process_control_approvals SET consumed_at = $1, consumed_by_command_id = $2",
          "WHERE id = $3 AND organization_id = $4 AND agent_id = $5 AND consumed_at IS NULL AND expires_at > $1",
          "RETURNING id",
        ].join(" "),
        [now, recordId, approval.id, user.organizationId, value.agentId],
      );
      if (!consumed[0]) throw new RuntimeServiceError("CONFLICT", "Process approval consumption raced another command");

      await this.audit(
        transaction,
        user.organizationId,
        user.id,
        userAuditSubject(user.id),
        "process_control.command_queued",
        "process_control_command",
        recordId,
        {
          agentId: value.agentId,
          approvalId: approval.id,
          commandId,
          correlationId,
          commandType: command.commandType,
          intentHash: command.approval.intentHash,
          payloadHash: delivered.integrity.payloadHash,
          semanticHash: delivered.integrity.semanticHash,
          envelopeHash: delivered.integrity.envelopeHash,
          expectedProcessStateVersion: command.expectedProcessStateVersion,
          runtimeStateDigest: command.commandType === "REQUEST_NINJATRADER_QUIT"
            ? command.payload.runtimeState.digest
            : null,
          expiresAt: command.expiresAt,
        },
      );

      return { recordId, commandId, correlationId, status: "queued", duplicate: false };
    });
  }

  async findCommandByIdempotency(
    user: AuthenticatedUser,
    input: unknown,
  ): Promise<EnqueuedProcessControlCommand | null> {
    this.requireProcessController(user);
    const value = z.object({
      agentId: uuid,
      idempotencyKey,
      commandType: z.enum(["LAUNCH_NINJATRADER", "REQUEST_NINJATRADER_QUIT"]),
    }).strict().parse(input);
    return this.database.transaction(async (transaction) => {
      await this.requireAgentForUser(transaction, user, value.agentId);
      const rows = await transaction.query<{
        id: string;
        command_id: string;
        correlation_id: string;
        status: string;
        created_by: string;
        command_type: ProcessControlCommand["commandType"];
      }>(
        [
          "SELECT id, command_id, correlation_id, status, created_by, command_type FROM process_control_commands",
          "WHERE organization_id = $1 AND agent_id = $2 AND idempotency_key = $3",
        ].join(" "),
        [user.organizationId, value.agentId, value.idempotencyKey],
      );
      const existing = rows[0];
      if (!existing) return null;
      if (existing.created_by !== user.id) {
        throw new RuntimeServiceError("FORBIDDEN", "Process command retry is bound to a different operator");
      }
      if (existing.command_type !== value.commandType) {
        throw new RuntimeServiceError("CONFLICT", "Process command retry does not match the original command type");
      }
      return {
        recordId: existing.id,
        commandId: existing.command_id,
        correlationId: existing.correlation_id,
        status: existing.status,
        duplicate: true,
      };
    });
  }

  async getCommandSafetyCounts(
    user: AuthenticatedUser,
    agentIdInput: string,
  ): Promise<ProcessControlCommandSafetyCounts> {
    this.requireProcessController(user);
    const agentId = uuid.parse(agentIdInput);
    return this.database.transaction(async (transaction) => {
      await this.requireAgentForUser(transaction, user, agentId);
      const rows = await transaction.query<{ status: string; count: number }>(
        [
          "SELECT status, COUNT(*)::integer AS count FROM process_control_commands",
          "WHERE organization_id = $1 AND agent_id = $2 AND status IN ('queued', 'delivered', 'indeterminate')",
          "GROUP BY status",
        ].join(" "),
        [user.organizationId, agentId],
      );
      const counts = new Map(rows.map((row) => [row.status, Number(row.count)]));
      return {
        inFlight: (counts.get("queued") ?? 0) + (counts.get("delivered") ?? 0),
        indeterminate: counts.get("indeterminate") ?? 0,
      };
    });
  }

  async leaseNextCommand(identity: AgentIdentity): Promise<LeasedProcessControlCommand | null> {
    const now = this.clock();
    return this.database.transaction(async (transaction) => {
      await this.requireAuthenticatedAgent(transaction, identity);
      await this.expireCommands(transaction, identity, now);
      const rows = await transaction.query<StoredCommandRow>(
        [
          "SELECT id, approval_id, command_id, correlation_id, idempotency_key, command_type, status, command,",
          "expected_process_state_version, runtime_state_digest, approval_intent_hash, payload_hash, semantic_hash,",
          "envelope_hash, issued_at, expires_at, delivery_attempts, last_ack_sequence",
          "FROM process_control_commands",
          "WHERE organization_id = $1 AND agent_id = $2 AND status = 'queued' AND expires_at > $3",
          "AND NOT EXISTS (",
          "SELECT 1 FROM process_control_commands active",
          "WHERE active.organization_id = process_control_commands.organization_id",
          "AND active.agent_id = process_control_commands.agent_id AND active.status = 'delivered'",
          ")",
          "ORDER BY queue_sequence FOR UPDATE SKIP LOCKED LIMIT 1",
        ].join(" "),
        [identity.organizationId, identity.agentId, now],
      );
      const stored = rows[0];
      if (!stored) return null;

      let command: ProcessControlCommand;
      let envelope: DeliveredProcessControlCommand;
      try {
        command = processControlCommandSchema.parse(this.toJsonObject(stored.command));
        envelope = createDeliveredProcessControlCommand(command);
        if (
          command.commandId !== stored.command_id
          || command.correlationId !== stored.correlation_id
          || command.agentId !== identity.agentId
          || command.commandType !== stored.command_type
          || command.approval.approvalId !== stored.approval_id
          || command.approval.intentHash !== stored.approval_intent_hash
          || command.expectedProcessStateVersion !== stored.expected_process_state_version
          || (command.commandType === "REQUEST_NINJATRADER_QUIT"
            ? command.payload.runtimeState.digest
            : null) !== stored.runtime_state_digest
          || envelope.integrity.payloadHash !== stored.payload_hash
          || envelope.integrity.semanticHash !== stored.semantic_hash
          || envelope.integrity.envelopeHash !== stored.envelope_hash
        ) throw new Error("Stored process command integrity mismatch");
      } catch {
        await transaction.query(
          "UPDATE process_control_commands SET status = 'indeterminate', terminal_at = $1, updated_at = $1 WHERE id = $2 AND organization_id = $3",
          [now, stored.id, identity.organizationId],
        );
        await this.audit(
          transaction,
          identity.organizationId,
          null,
          agentAuditSubject(identity.agentId),
          "process_control.command_integrity_failed",
          "process_control_command",
          stored.id,
          {
            agentId: identity.agentId,
            commandId: stored.command_id,
            payloadHash: stored.payload_hash,
            semanticHash: stored.semantic_hash,
            envelopeHash: stored.envelope_hash,
          },
        );
        return null;
      }

      const leaseId = randomUUID();
      const deliveryId = randomUUID();
      // Process control is delivered at most once. Its lease therefore remains
      // valid through the command's approval-bounded expiry instead of creating
      // a shorter window that could strand a legitimate launch/quit verification.
      const leaseExpiresAt = new Date(stored.expires_at);
      await transaction.query(
        [
          "INSERT INTO process_control_deliveries",
          "(id, organization_id, agent_id, command_record_id, credential_id, lease_id, attempt, delivered_at,",
          "lease_expires_at, canonicalization, payload_hash, semantic_hash, envelope_hash)",
          "VALUES ($1, $2, $3, $4, $5, $6, 1, $7, $8, $9, $10, $11, $12)",
        ].join(" "),
        [
          deliveryId,
          identity.organizationId,
          identity.agentId,
          stored.id,
          identity.credentialId,
          leaseId,
          now,
          leaseExpiresAt,
          envelope.integrity.canonicalization,
          envelope.integrity.payloadHash,
          envelope.integrity.semanticHash,
          envelope.integrity.envelopeHash,
        ],
      );
      const deliveredRows = await transaction.query<{ id: string }>(
        [
          "UPDATE process_control_commands SET status = 'delivered', delivery_attempts = 1, delivered_at = $1, updated_at = $1",
          "WHERE id = $2 AND organization_id = $3 AND agent_id = $4 AND status = 'queued' AND delivery_attempts = 0",
          "RETURNING id",
        ].join(" "),
        [now, stored.id, identity.organizationId, identity.agentId],
      );
      if (!deliveredRows[0]) throw new RuntimeServiceError("CONFLICT", "Process command delivery raced another poll");
      await this.audit(
        transaction,
        identity.organizationId,
        null,
        agentAuditSubject(identity.agentId),
        "process_control.command_delivered",
        "process_control_command",
        stored.id,
        {
          agentId: identity.agentId,
          commandId: command.commandId,
          leaseId,
          deliveryAttempt: 1,
          leaseExpiresAt: leaseExpiresAt.toISOString(),
          envelopeHash: envelope.integrity.envelopeHash,
        },
      );
      return { envelope, leaseId, leaseExpiresAt, deliveryAttempt: 1 };
    });
  }

  async recordAcknowledgement(
    identity: AgentIdentity,
    input: unknown,
  ): Promise<RecordedProcessControlAcknowledgement> {
    const acknowledgement = parseProcessControlAcknowledgement(input);
    if (acknowledgement.agentId !== identity.agentId) {
      throw new RuntimeServiceError("FORBIDDEN", "Agent identity does not match process acknowledgement");
    }
    this.assertAgentTimestamp(acknowledgement.occurredAt);
    const acknowledgementHash = hashCanonicalPayload(acknowledgement);
    const now = this.clock();

    return this.database.transaction(async (transaction) => {
      await this.requireAuthenticatedAgent(transaction, identity);
      const commands = await transaction.query<StoredCommandRow>(
        [
          "SELECT id, approval_id, command_id, correlation_id, idempotency_key, command_type, status, command,",
          "expected_process_state_version, runtime_state_digest, approval_intent_hash, payload_hash, semantic_hash,",
          "envelope_hash, issued_at, expires_at, delivery_attempts, last_ack_sequence",
          "FROM process_control_commands WHERE organization_id = $1 AND agent_id = $2 AND command_id = $3 FOR UPDATE",
        ].join(" "),
        [identity.organizationId, identity.agentId, acknowledgement.commandId],
      );
      const command = commands[0];
      if (!command) throw new RuntimeServiceError("COMMAND_NOT_FOUND", "Process command not found");
      if (command.correlation_id !== acknowledgement.correlationId) {
        throw new RuntimeServiceError("CONFLICT", "Process acknowledgement correlation does not match command");
      }
      if (command.command_type !== acknowledgement.commandType) {
        throw new RuntimeServiceError("CONFLICT", "Process acknowledgement command type does not match command");
      }
      const storedCommand = processControlCommandSchema.parse(this.toJsonObject(command.command));
      const storedEnvelope = createDeliveredProcessControlCommand(storedCommand);
      if (
        storedCommand.commandId !== command.command_id
        || storedCommand.correlationId !== command.correlation_id
        || storedCommand.agentId !== identity.agentId
        || storedCommand.commandType !== command.command_type
        || storedCommand.approval.approvalId !== command.approval_id
        || storedCommand.approval.intentHash !== command.approval_intent_hash
        || storedCommand.expectedProcessStateVersion !== command.expected_process_state_version
        || (storedCommand.commandType === "REQUEST_NINJATRADER_QUIT"
          ? storedCommand.payload.runtimeState.digest
          : null) !== command.runtime_state_digest
        || storedEnvelope.integrity.payloadHash !== command.payload_hash
        || storedEnvelope.integrity.semanticHash !== command.semantic_hash
        || storedEnvelope.integrity.envelopeHash !== command.envelope_hash
      ) {
        throw new RuntimeServiceError("CONFLICT", "Stored process command integrity changed before acknowledgement");
      }
      if (hashCanonicalPayload(acknowledgement.evidence.target)
        !== hashCanonicalPayload(storedCommand.payload.target)) {
        throw new RuntimeServiceError("CONFLICT", "Process acknowledgement evidence does not bind the delivered target state");
      }
      if (acknowledgement.commandType === "LAUNCH_NINJATRADER") {
        const changedStateWasBlocked = acknowledgement.status === "blocked"
          && acknowledgement.outcomeCode === "PROCESS_STATE_CHANGED";
        if (
          acknowledgement.evidence.preProcessStateVersion !== storedCommand.expectedProcessStateVersion
          && !changedStateWasBlocked
        ) {
          throw new RuntimeServiceError("CONFLICT", "Launch acknowledgement pre-state does not bind the delivered command");
        }
      } else {
        if (storedCommand.commandType !== "REQUEST_NINJATRADER_QUIT") {
          throw new RuntimeServiceError("CONFLICT", "Quit acknowledgement does not bind a quit command");
        }
        const changedStateWasBlocked = acknowledgement.status === "blocked"
          && acknowledgement.evidence.blockers.includes("PROCESS_STATE_CHANGED");
        const runtimeStateChanged = acknowledgement.evidence.runtimeStateDigest !== storedCommand.payload.runtimeState.digest
          || acknowledgement.evidence.runtimeObservedAt !== storedCommand.payload.runtimeState.observedAt
          || hashCanonicalPayload(acknowledgement.evidence.preflight)
            !== hashCanonicalPayload(storedCommand.payload.runtimeState.summary);
        if (
          (acknowledgement.evidence.preProcessStateVersion !== storedCommand.expectedProcessStateVersion
            && !changedStateWasBlocked)
          || (runtimeStateChanged && !changedStateWasBlocked)
        ) {
          throw new RuntimeServiceError("CONFLICT", "Quit acknowledgement evidence does not bind the delivered runtime preflight");
        }
      }

      const duplicates = await transaction.query<{
        id: string;
        status: ProcessControlAcknowledgement["status"];
        acknowledgement_hash: string;
      }>(
        [
          "SELECT id, status, acknowledgement_hash FROM process_control_acknowledgements",
          "WHERE organization_id = $1 AND agent_id = $2 AND acknowledgement_id = $3",
        ].join(" "),
        [identity.organizationId, identity.agentId, acknowledgement.acknowledgementId],
      );
      const duplicate = duplicates[0];
      if (duplicate) {
        if (duplicate.acknowledgement_hash !== acknowledgementHash) {
          throw new RuntimeServiceError("CONFLICT", "Process acknowledgement replay conflicts with stored evidence");
        }
        return { acknowledgementRecordId: duplicate.id, status: duplicate.status, duplicate: true };
      }

      if (acknowledgement.sequence < 1 || Number(command.last_ack_sequence) >= acknowledgement.sequence) {
        throw new RuntimeServiceError("SEQUENCE_STALE", "Process acknowledgement sequence is stale");
      }
      if (acknowledgement.sequence > Number(command.last_ack_sequence) + 1) {
        throw new RuntimeServiceError("SEQUENCE_GAP", "Process acknowledgement sequence has a gap", {
          expectedNextSequence: Number(command.last_ack_sequence) + 1,
        });
      }
      if (acknowledgement.sequence !== 1 || command.status !== "delivered") {
        throw new RuntimeServiceError("INVALID_TRANSITION", "Process command accepts one terminal acknowledgement only");
      }

      const deliveries = await transaction.query<{
        id: string;
        credential_id: string;
        delivered_at: Date;
        lease_expires_at: Date;
      }>(
        [
          "SELECT id, credential_id, delivered_at, lease_expires_at FROM process_control_deliveries",
          "WHERE organization_id = $1 AND agent_id = $2 AND command_record_id = $3 AND lease_id = $4",
        ].join(" "),
        [identity.organizationId, identity.agentId, command.id, acknowledgement.leaseId],
      );
      const delivery = deliveries[0];
      if (!delivery) throw new RuntimeServiceError("INVALID_DELIVERY", "Process acknowledgement lease is unknown");
      if (delivery.credential_id !== identity.credentialId) {
        throw new RuntimeServiceError("INVALID_DELIVERY", "Process acknowledgement credential does not match delivery");
      }
      const occurredAt = Date.parse(acknowledgement.occurredAt);
      const deliveredAt = new Date(delivery.delivered_at).getTime();
      const leaseExpiresAt = new Date(delivery.lease_expires_at).getTime();
      const commandExpiresAt = new Date(command.expires_at).getTime();
      if (occurredAt < deliveredAt) {
        throw new RuntimeServiceError("INVALID_DELIVERY", "Process acknowledgement predates delivery");
      }
      if (
        occurredAt >= leaseExpiresAt
        || occurredAt >= commandExpiresAt
        || now.getTime() >= leaseExpiresAt
        || now.getTime() >= commandExpiresAt
      ) {
        throw new RuntimeServiceError("COMMAND_EXPIRED", "Process acknowledgement arrived after its exact delivery window");
      }

      const acknowledgementRecordId = randomUUID();
      await transaction.query(
        [
          "INSERT INTO process_control_acknowledgements",
          "(id, organization_id, agent_id, command_record_id, delivery_id, credential_id, acknowledgement_id,",
          "command_id, correlation_id, lease_id, sequence, command_type, status, outcome_code, acknowledgement,",
          "evidence_hash, acknowledgement_hash, occurred_at, received_at)",
          "VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15::jsonb, $16, $17, $18, $19)",
        ].join(" "),
        [
          acknowledgementRecordId,
          identity.organizationId,
          identity.agentId,
          command.id,
          delivery.id,
          identity.credentialId,
          acknowledgement.acknowledgementId,
          acknowledgement.commandId,
          acknowledgement.correlationId,
          acknowledgement.leaseId,
          acknowledgement.sequence,
          acknowledgement.commandType,
          acknowledgement.status,
          acknowledgement.outcomeCode,
          JSON.stringify(acknowledgement),
          acknowledgement.evidenceHash,
          acknowledgementHash,
          acknowledgement.occurredAt,
          now,
        ],
      );
      await transaction.query(
        "UPDATE process_control_deliveries SET acknowledged_at = $1 WHERE id = $2 AND acknowledged_at IS NULL",
        [now, delivery.id],
      );
      await transaction.query(
        [
          "UPDATE process_control_commands SET status = $1, last_ack_sequence = 1, terminal_at = $2, updated_at = $2",
          "WHERE id = $3 AND organization_id = $4 AND agent_id = $5 AND status = 'delivered'",
        ].join(" "),
        [acknowledgement.status, now, command.id, identity.organizationId, identity.agentId],
      );
      await this.audit(
        transaction,
        identity.organizationId,
        null,
        agentAuditSubject(identity.agentId),
        `process_control.command_${acknowledgement.status}`,
        "process_control_command",
        command.id,
        {
          agentId: identity.agentId,
          commandId: acknowledgement.commandId,
          correlationId: acknowledgement.correlationId,
          acknowledgementId: acknowledgement.acknowledgementId,
          commandType: acknowledgement.commandType,
          outcomeCode: acknowledgement.outcomeCode,
          leaseId: acknowledgement.leaseId,
          sequence: acknowledgement.sequence,
          evidenceHash: acknowledgement.evidenceHash,
          acknowledgementHash,
        },
      );
      return { acknowledgementRecordId, status: acknowledgement.status, duplicate: false };
    });
  }

  private async expireCommands(
    transaction: DatabaseTransaction,
    identity: Pick<AgentIdentity, "agentId" | "organizationId">,
    now: Date,
  ): Promise<void> {
    const expiredQueued = await transaction.query<{ id: string; command_id: string }>(
      [
        "UPDATE process_control_commands SET status = 'expired', terminal_at = $1, updated_at = $1",
        "WHERE organization_id = $2 AND agent_id = $3 AND status = 'queued' AND expires_at <= $1",
        "RETURNING id, command_id",
      ].join(" "),
      [now, identity.organizationId, identity.agentId],
    );
    for (const command of expiredQueued) {
      await this.audit(
        transaction,
        identity.organizationId,
        null,
        agentAuditSubject(identity.agentId),
        "process_control.command_expired",
        "process_control_command",
        command.id,
        { agentId: identity.agentId, commandId: command.command_id, expiredAt: now.toISOString() },
      );
    }

    const uncertain = await transaction.query<{ id: string; command_id: string }>(
      [
        "UPDATE process_control_commands SET status = 'indeterminate', terminal_at = $1, updated_at = $1",
        "WHERE organization_id = $2 AND agent_id = $3 AND status = 'delivered'",
        "AND (expires_at <= $1 OR EXISTS (",
        "SELECT 1 FROM process_control_deliveries delivery",
        "WHERE delivery.command_record_id = process_control_commands.id AND delivery.lease_expires_at <= $1",
        ")) RETURNING id, command_id",
      ].join(" "),
      [now, identity.organizationId, identity.agentId],
    );
    for (const command of uncertain) {
      await this.audit(
        transaction,
        identity.organizationId,
        null,
        agentAuditSubject(identity.agentId),
        "process_control.command_delivery_unacknowledged",
        "process_control_command",
        command.id,
        { agentId: identity.agentId, commandId: command.command_id, markedIndeterminateAt: now.toISOString() },
      );
    }
  }

  private async requireAgentForUser(
    transaction: DatabaseTransaction,
    user: AuthenticatedUser,
    agentId: string,
    lock = false,
  ): Promise<void> {
    const rows = await transaction.query<{ id: string }>(
      [
        "SELECT id FROM agent_installations WHERE id = $1 AND organization_id = $2 AND status <> 'disabled'",
        lock ? "FOR UPDATE" : "",
      ].join(" "),
      [agentId, user.organizationId],
    );
    if (!rows[0]) throw new RuntimeServiceError("AGENT_NOT_FOUND", "Authorized agent installation not found");
  }

  private async requireAuthenticatedAgent(
    transaction: DatabaseTransaction,
    identity: AgentIdentity,
  ): Promise<void> {
    const rows = await transaction.query<{ id: string }>(
      [
        "SELECT a.id FROM agent_installations a",
        "JOIN agent_credentials c ON c.organization_id = a.organization_id AND c.agent_id = a.id",
        "WHERE a.organization_id = $1 AND a.id = $2 AND c.id = $3",
        "AND c.revoked_at IS NULL AND c.expires_at > $4 AND a.status <> 'disabled' FOR UPDATE",
      ].join(" "),
      [identity.organizationId, identity.agentId, identity.credentialId, this.clock()],
    );
    if (!rows[0]) throw new RuntimeServiceError("UNAUTHORIZED", "Authorized agent credential not found");
  }

  private requireProcessController(user: AuthenticatedUser): void {
    if (user.role === "staff" || user.role === "client") {
      try {
        requireDeploymentCapability("transport.local");
        requireDeploymentCapability("runtime.queue");
        return;
      } catch {
        // This milestone is local-only. Central staff must later present a
        // client-issued, scope-bound OTP support grant before this boundary
        // can be expanded.
      }
    }
    throw new RuntimeServiceError("FORBIDDEN", "Forbidden");
  }

  private assertAgentTimestamp(timestamp: string): void {
    if (Date.parse(timestamp) > this.clock().getTime() + MAX_AGENT_CLOCK_SKEW_MS) {
      throw new RuntimeServiceError("CONFLICT", "Agent timestamp is too far in the future");
    }
  }

  private toJsonObject(value: unknown): Record<string, unknown> {
    if (typeof value === "string") {
      const parsed = JSON.parse(value) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("Stored process JSON object is invalid");
      }
      return parsed as Record<string, unknown>;
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("Stored process JSON object is invalid");
    }
    return value as Record<string, unknown>;
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

export function getProcessControlRepository(): ProcessControlRepository {
  return new ProcessControlRepository();
}
