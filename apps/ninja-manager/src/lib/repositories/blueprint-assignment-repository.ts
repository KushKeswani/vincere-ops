import "server-only";

import { randomBytes, randomUUID } from "node:crypto";

import type { DatabaseClient, DatabaseTransaction } from "@/lib/db/client";
import { getDatabase } from "@/lib/db/client";
import { requireDeploymentCapability } from "@/lib/deployment/server";
import { userAuditSubject } from "@/lib/domain/audit-evidence";
import {
  BLUEPRINT_ASSIGNMENT_VERSION,
  BLUEPRINT_DECLARED_AGE_TOLERANCE_MS,
  BLUEPRINT_PREVIEW_EXPIRY_MS,
  BLUEPRINT_RUNTIME_MAX_AGE_MS,
  blueprintApproveInputSchema,
  blueprintAssignmentRevisionRefSchema,
  blueprintAssignmentRevisionSchema,
  blueprintCommitInputSchema,
  blueprintCommitRequestHash,
  blueprintPreviewIdSchema,
  blueprintRevisionContentHash,
  blueprintRevisionStateContentHash,
  blueprintStageContentHash,
  blueprintStageInputSchema,
  blueprintStageRequestHash,
  blueprintStateRequestHash,
  blueprintStagedPreviewSchema,
  type BlueprintAssignmentRevision,
  type BlueprintCommitInput,
  type BlueprintStagedPreview,
} from "@/lib/domain/blueprint-assignment-contracts";
import {
  blueprintAssignmentPreviewSchema,
  blueprintPreviewResultSchema,
  type BlueprintAssignmentPreview,
} from "@/lib/domain/blueprint-import-contracts";
import { hashCanonicalPayload } from "@/lib/domain/canonical-json";
import {
  parseRuntimeObservationV2Event,
  type RuntimeObservationV2Event,
} from "@/lib/domain/runtime-contracts";
import {
  isSequentialInventoryScopeUsable,
  type RuntimeAccountObservationV2,
  type RuntimeConnectionObservationV2,
  type RuntimeObservationV2,
  type RuntimeStrategyObservationV2,
} from "@/lib/domain/runtime-observation-v2";
import { RuntimeServiceError } from "@/lib/domain/runtime-errors";
import type { AuthenticatedUser } from "@/lib/domain/types";
import { writeAuditEvent } from "@/lib/repositories/audit-writer";

const INSERT_BATCH_SIZE = 250;

type Clock = () => Date;

interface SourceEventRow {
  id: string;
  protocol_version: string;
  event_id: string;
  agent_id: string;
  sequence: number | string;
  event_type: string;
  correlation_id: string | null;
  causation_id: string | null;
  occurred_at: Date;
  received_at: Date;
  payload_hash: string;
  envelope_hash: string | null;
  credential_id: string | null;
  credential_agent_id: string | null;
  credential_organization_id: string | null;
  legacy_unverified: boolean;
  payload: unknown;
}

interface StageHeaderRow {
  id: string;
  source_workbook_hash: string;
  canonical_preview_hash: string;
  data_row_count: number;
  assignment_count: number;
  idempotency_key: string;
  request_hash: string;
  content_hash: string;
  staged_at: Date;
  expires_at: Date;
  created_by: string;
}

interface StageAssignmentRow {
  assignment_ordinal: number;
  period: BlueprintAssignmentPreview["period"];
  account_label: string;
  prop_firm: string;
  stack_level: number;
  strategy: string;
  instrument: string;
  source_row: number;
  source_slot: number;
}

interface RevisionHeaderRow {
  id: string;
  revision_ref: string;
  preview_id: string;
  agent_id: string;
  source_event_id: string;
  source_sequence: number | string;
  source_state_digest: string;
  source_as_of: Date;
  source_occurred_at: Date;
  source_received_at: Date;
  committed_at: Date;
  mapping_count: number;
  assignment_count: number;
  idempotency_key: string;
  request_hash: string;
  content_hash: string;
  created_by: string;
}

interface AccountBindingRow {
  mapping_ordinal: number;
  account_label: string;
  account_ref: string;
  identifier_fingerprint: string;
  masked_identifier: string;
  display_label: string;
  runtime_binding_hash: string;
}

interface StrategyBindingRow extends StageAssignmentRow {
  account_ref: string;
  strategy_ref: string;
  runtime_binding_hash: string;
}

interface RevisionStateRow {
  id: string;
  state_version: number;
  status: "draft" | "approved";
  previous_state_id: string | null;
  source_event_id: string;
  source_sequence: number | string;
  source_state_digest: string;
  source_as_of: Date;
  source_occurred_at: Date;
  source_received_at: Date;
  recorded_at: Date;
  idempotency_key: string;
  request_hash: string;
  content_hash: string;
  actor_user_id: string;
}

interface AuthenticatedSource {
  row: SourceEventRow;
  event: RuntimeObservationV2Event;
}

interface InternalAccountBinding {
  accountLabel: string;
  accountRef: string;
  identifierFingerprint: string;
  maskedIdentifier: string;
  displayLabel: string;
  runtimeBindingHash: string;
}

interface InternalAssignmentBinding extends BlueprintAssignmentPreview {
  accountRef: string;
  strategyRef: string;
  runtimeBindingHash: string;
}

export interface StagedBlueprintResult {
  stagedPreview: BlueprintStagedPreview;
  duplicate: boolean;
}

export interface CommittedBlueprintResult {
  revision: BlueprintAssignmentRevision;
  duplicate: boolean;
}

export class BlueprintAssignmentRepository {
  constructor(
    private readonly database: DatabaseClient = getDatabase(),
    private readonly clock: Clock = () => new Date(),
  ) {}

  async stagePreview(user: AuthenticatedUser, previewInput: unknown, input: unknown): Promise<StagedBlueprintResult> {
    this.requireBlueprintAccess(user);
    const preview = blueprintPreviewResultSchema.parse(previewInput);
    const value = blueprintStageInputSchema.parse(input);
    const sourceWorkbookHash = preview.source.workbookSha256;
    const canonicalPreviewHash = preview.canonicalPreviewHash;
    if (
      !preview.valid
      || sourceWorkbookHash === null
      || canonicalPreviewHash === null
      || preview.assignments.length === 0
    ) {
      throw new RuntimeServiceError("CONFLICT", "Only an error-free non-empty Blueprint preview may be staged");
    }
    const stagedAt = this.requireClock();
    const expiresAt = new Date(stagedAt.getTime() + BLUEPRINT_PREVIEW_EXPIRY_MS);
    const requestHash = blueprintStageRequestHash(preview);

    return this.database.transaction(async (transaction) => {
      await this.lockOrganization(transaction, user.organizationId);
      const existing = (await transaction.query<StageHeaderRow>(
        "SELECT * FROM blueprint_preview_stages WHERE organization_id = $1 AND idempotency_key = $2",
        [user.organizationId, value.idempotencyKey],
      ))[0];
      if (existing) {
        this.assertActorIdempotency(existing.created_by, user.id, existing.request_hash, requestHash, "Blueprint stage");
        return { stagedPreview: await this.readStage(transaction, user.organizationId, existing.id, stagedAt), duplicate: true };
      }

      const previewId = randomUUID();
      const contentHash = blueprintStageContentHash({
        previewId,
        sourceWorkbookHash,
        canonicalPreviewHash,
        dataRowCount: preview.dataRowCount,
        assignments: preview.assignments,
        stagedAt: stagedAt.toISOString(),
        expiresAt: expiresAt.toISOString(),
        createdBy: user.id,
        idempotencyKey: value.idempotencyKey,
        requestHash,
      });
      await transaction.query(
        [
          "INSERT INTO blueprint_preview_stages",
          "(id, organization_id, source_workbook_hash, canonical_preview_hash, data_row_count, assignment_count,",
          "idempotency_key, request_hash, content_hash, staged_at, expires_at, created_by)",
          "VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)",
        ].join(" "),
        [
          previewId,
          user.organizationId,
          sourceWorkbookHash,
          canonicalPreviewHash,
          preview.dataRowCount,
          preview.assignments.length,
          value.idempotencyKey,
          requestHash,
          contentHash,
          stagedAt,
          expiresAt,
          user.id,
        ],
      );
      await this.insertRows(
        transaction,
        [
          "INSERT INTO blueprint_preview_stage_assignments",
          "(id, organization_id, preview_id, assignment_ordinal, period, account_label, prop_firm, stack_level,",
          "strategy, instrument, source_row, source_slot)",
        ].join(" "),
        preview.assignments.map((assignment, index) => [
          randomUUID(), user.organizationId, previewId, index + 1, assignment.period, assignment.accountLabel,
          assignment.propFirm, assignment.stackLevel, assignment.strategy, assignment.instrument,
          assignment.sourceRow, assignment.sourceSlot,
        ]),
      );
      await writeAuditEvent(transaction, {
        organizationId: user.organizationId,
        actorUserId: user.id,
        actorSubjectId: userAuditSubject(user.id),
        action: "blueprint.preview_staged",
        entityType: "blueprint_preview_stage",
        entityId: previewId,
        metadata: {
          dataRowCount: preview.dataRowCount,
          assignmentCount: preview.assignments.length,
          uniqueAccountCount: new Set(preview.assignments.map((entry) => entry.accountLabel)).size,
          expiresAt: expiresAt.toISOString(),
          requestHash,
          contentHash,
        },
        occurredAt: stagedAt,
      });
      return { stagedPreview: await this.readStage(transaction, user.organizationId, previewId, stagedAt), duplicate: false };
    });
  }

  async getStagedPreview(user: AuthenticatedUser, previewIdInput: string): Promise<BlueprintStagedPreview | null> {
    this.requireBlueprintAccess(user);
    const previewId = blueprintPreviewIdSchema.parse(previewIdInput);
    const rows = await this.database.query<{ id: string }>(
      "SELECT id FROM blueprint_preview_stages WHERE organization_id = $1 AND id = $2 AND created_by = $3",
      [user.organizationId, previewId, user.id],
    );
    if (!rows[0]) return null;
    return this.readStage(this.database, user.organizationId, previewId, this.requireClock());
  }

  async commitMapping(user: AuthenticatedUser, input: unknown): Promise<CommittedBlueprintResult> {
    this.requireBlueprintAccess(user);
    const value = blueprintCommitInputSchema.parse(input);
    const committedAt = this.requireClock();
    const requestHash = blueprintCommitRequestHash(value);

    return this.database.transaction(async (transaction) => {
      await this.lockOrganization(transaction, user.organizationId);
      const existing = (await transaction.query<RevisionHeaderRow>(
        "SELECT * FROM blueprint_assignment_revisions WHERE organization_id = $1 AND idempotency_key = $2",
        [user.organizationId, value.idempotencyKey],
      ))[0];
      if (existing) {
        await this.requireAgentAccess(transaction, user, existing.agent_id);
        this.assertActorIdempotency(existing.created_by, user.id, existing.request_hash, requestHash, "Blueprint commit");
        return { revision: await this.readRevision(transaction, user.organizationId, existing.revision_ref), duplicate: true };
      }

      await this.requireAgentAccess(transaction, user, value.agentId);
      const staged = await this.readStageInternal(transaction, user.organizationId, value.previewId);
      if (staged.header.created_by !== user.id) {
        throw new RuntimeServiceError("FORBIDDEN", "Blueprint stage belongs to a different operator");
      }
      if (committedAt.getTime() >= staged.header.expires_at.getTime()) {
        throw new RuntimeServiceError("CONFLICT", "Blueprint stage expired before mapping was committed");
      }
      this.assertExactMappings(staged.assignments, value);

      const source = await this.getLatestAuthenticatedSource(transaction, user.organizationId, value.agentId);
      this.assertOperationalObservation(source.event.payload, source.event.occurredAt, source.row.received_at, committedAt);
      const bindings = this.bindAssignments(staged.assignments, value, source.event.payload);

      const revisionId = randomUUID();
      const revisionRef = `assignment_rev_${randomBytes(16).toString("hex")}`;
      const sourceEvidence = this.sourceEvidence(source);
      const contentHash = blueprintRevisionContentHash({
        revisionRef,
        previewId: value.previewId,
        agentId: value.agentId,
        source: sourceEvidence,
        committedAt: committedAt.toISOString(),
        createdBy: user.id,
        idempotencyKey: value.idempotencyKey,
        requestHash,
        accounts: bindings.accounts,
        assignments: bindings.assignments,
      });
      await transaction.query(
        [
          "INSERT INTO blueprint_assignment_revisions",
          "(id, organization_id, revision_ref, preview_id, agent_id, source_agent_event_record_id, source_event_id,",
          "source_sequence, source_state_digest, source_as_of, source_occurred_at, source_received_at, committed_at,",
          "mapping_count, assignment_count, idempotency_key, request_hash, content_hash, created_by)",
          "VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)",
        ].join(" "),
        [
          revisionId, user.organizationId, revisionRef, value.previewId, value.agentId, source.row.id,
          source.event.eventId, source.event.sequence, source.event.payload.stateDigest, source.event.payload.asOf,
          source.event.occurredAt, source.row.received_at, committedAt, bindings.accounts.length,
          bindings.assignments.length, value.idempotencyKey, requestHash, contentHash, user.id,
        ],
      );
      await this.insertRows(
        transaction,
        [
          "INSERT INTO blueprint_assignment_account_bindings",
          "(id, organization_id, revision_id, agent_id, mapping_ordinal, account_label, account_ref, identifier_fingerprint,",
          "masked_identifier, display_label, runtime_binding_hash)",
        ].join(" "),
        bindings.accounts.map((binding, index) => [
          randomUUID(), user.organizationId, revisionId, value.agentId, index + 1, binding.accountLabel, binding.accountRef,
          binding.identifierFingerprint, binding.maskedIdentifier, binding.displayLabel, binding.runtimeBindingHash,
        ]),
      );
      await this.insertRows(
        transaction,
        [
          "INSERT INTO blueprint_assignment_strategy_bindings",
          "(id, organization_id, revision_id, assignment_ordinal, period, account_label, prop_firm, stack_level,",
          "strategy, instrument, source_row, source_slot, account_ref, strategy_ref, runtime_binding_hash)",
        ].join(" "),
        bindings.assignments.map((binding, index) => [
          randomUUID(), user.organizationId, revisionId, index + 1, binding.period, binding.accountLabel,
          binding.propFirm, binding.stackLevel, binding.strategy, binding.instrument, binding.sourceRow,
          binding.sourceSlot, binding.accountRef, binding.strategyRef, binding.runtimeBindingHash,
        ]),
      );

      const stateId = randomUUID();
      const stateHash = blueprintRevisionStateContentHash({
        revisionRef,
        stateVersion: 1,
        status: "draft",
        previousStateId: null,
        source: sourceEvidence,
        recordedAt: committedAt.toISOString(),
        actorUserId: user.id,
        idempotencyKey: value.idempotencyKey,
        requestHash,
      });
      await this.insertState(transaction, {
        id: stateId,
        organizationId: user.organizationId,
        revisionId,
        agentId: value.agentId,
        stateVersion: 1,
        status: "draft",
        previousStateId: null,
        source,
        recordedAt: committedAt,
        idempotencyKey: value.idempotencyKey,
        requestHash,
        contentHash: stateHash,
        actorUserId: user.id,
      });
      await writeAuditEvent(transaction, {
        organizationId: user.organizationId,
        actorUserId: user.id,
        actorSubjectId: userAuditSubject(user.id),
        action: "blueprint.assignment_draft_created",
        entityType: "blueprint_assignment_revision",
        entityId: revisionRef,
        metadata: {
          agentId: value.agentId,
          sourceEventId: source.event.eventId,
          sourceSequence: source.event.sequence,
          mappingCount: bindings.accounts.length,
          assignmentCount: bindings.assignments.length,
          requestHash,
          contentHash,
          stateHash,
        },
        occurredAt: committedAt,
      });
      return { revision: await this.readRevision(transaction, user.organizationId, revisionRef), duplicate: false };
    });
  }

  async approveRevision(user: AuthenticatedUser, input: unknown): Promise<CommittedBlueprintResult> {
    this.requireBlueprintAccess(user);
    const value = blueprintApproveInputSchema.parse(input);
    const recordedAt = this.requireClock();
    const requestHash = blueprintStateRequestHash(value);

    return this.database.transaction(async (transaction) => {
      await this.lockOrganization(transaction, user.organizationId);
      const duplicate = (await transaction.query<RevisionStateRow & { revision_ref: string }>(
        [
          "SELECT state.*, revision.revision_ref FROM blueprint_assignment_revision_states state",
          "JOIN blueprint_assignment_revisions revision ON revision.id = state.revision_id AND revision.organization_id = state.organization_id",
          "WHERE state.organization_id = $1 AND state.idempotency_key = $2",
        ].join(" "),
        [user.organizationId, value.idempotencyKey],
      ))[0];
      if (duplicate) {
        const duplicateRevision = (await transaction.query<RevisionHeaderRow>(
          "SELECT * FROM blueprint_assignment_revisions WHERE organization_id = $1 AND revision_ref = $2",
          [user.organizationId, duplicate.revision_ref],
        ))[0];
        if (!duplicateRevision) throw new RuntimeServiceError("FORBIDDEN", "Forbidden");
        await this.requireAgentAccess(transaction, user, duplicateRevision.agent_id);
        this.assertActorIdempotency(duplicate.actor_user_id, user.id, duplicate.request_hash, requestHash, "Blueprint approval");
        if (duplicate.status !== "approved") throw new RuntimeServiceError("CONFLICT", "Approval idempotency key is already used");
        return { revision: await this.readRevision(transaction, user.organizationId, duplicate.revision_ref), duplicate: true };
      }

      const revision = (await transaction.query<RevisionHeaderRow>(
        "SELECT * FROM blueprint_assignment_revisions WHERE organization_id = $1 AND revision_ref = $2 FOR UPDATE",
        [user.organizationId, value.revisionRef],
      ))[0];
      if (!revision) throw new RuntimeServiceError("CONFLICT", "Blueprint assignment revision was not found");
      await this.requireAgentAccess(transaction, user, revision.agent_id);
      await this.readRevision(transaction, user.organizationId, value.revisionRef);
      const current = (await transaction.query<RevisionStateRow>(
        [
          "SELECT * FROM blueprint_assignment_revision_states",
          "WHERE organization_id = $1 AND revision_id = $2 ORDER BY state_version DESC LIMIT 1",
        ].join(" "),
        [user.organizationId, revision.id],
      ))[0];
      if (!current || current.status !== "draft" || current.state_version !== value.expectedVersion) {
        throw new RuntimeServiceError("CONFLICT", "Blueprint assignment revision changed before approval");
      }

      const source = await this.getLatestAuthenticatedSource(transaction, user.organizationId, revision.agent_id);
      this.assertOperationalObservation(source.event.payload, source.event.occurredAt, source.row.received_at, recordedAt);
      const accounts = await this.readAccountBindings(transaction, user.organizationId, revision.id);
      const assignments = await this.readStrategyBindings(transaction, user.organizationId, revision.id);
      this.revalidateBindings(accounts, assignments, source.event.payload);

      const sourceEvidence = this.sourceEvidence(source);
      const stateId = randomUUID();
      const stateHash = blueprintRevisionStateContentHash({
        revisionRef: revision.revision_ref,
        stateVersion: current.state_version + 1,
        status: "approved",
        previousStateId: current.id,
        source: sourceEvidence,
        recordedAt: recordedAt.toISOString(),
        actorUserId: user.id,
        idempotencyKey: value.idempotencyKey,
        requestHash,
      });
      await this.insertState(transaction, {
        id: stateId,
        organizationId: user.organizationId,
        revisionId: revision.id,
        agentId: revision.agent_id,
        stateVersion: current.state_version + 1,
        status: "approved",
        previousStateId: current.id,
        source,
        recordedAt,
        idempotencyKey: value.idempotencyKey,
        requestHash,
        contentHash: stateHash,
        actorUserId: user.id,
      });
      await writeAuditEvent(transaction, {
        organizationId: user.organizationId,
        actorUserId: user.id,
        actorSubjectId: userAuditSubject(user.id),
        action: "blueprint.assignment_approved",
        entityType: "blueprint_assignment_revision",
        entityId: revision.revision_ref,
        metadata: {
          agentId: revision.agent_id,
          sourceEventId: source.event.eventId,
          sourceSequence: source.event.sequence,
          expectedVersion: value.expectedVersion,
          approvedVersion: current.state_version + 1,
          accountCount: accounts.length,
          assignmentCount: assignments.length,
          requestHash,
          stateHash,
        },
        occurredAt: recordedAt,
      });
      return { revision: await this.readRevision(transaction, user.organizationId, revision.revision_ref), duplicate: false };
    });
  }

  async getRevision(user: AuthenticatedUser, revisionRefInput: string): Promise<BlueprintAssignmentRevision | null> {
    this.requireBlueprintAccess(user);
    const revisionRef = blueprintAssignmentRevisionRefSchema.parse(revisionRefInput);
    return this.database.transaction(async (transaction) => {
      const rows = await transaction.query<{ revision_ref: string; agent_id: string }>(
        "SELECT revision_ref, agent_id FROM blueprint_assignment_revisions WHERE organization_id = $1 AND revision_ref = $2",
        [user.organizationId, revisionRef],
      );
      if (!rows[0]) return null;
      await this.requireAgentAccess(transaction, user, rows[0].agent_id);
      return this.readRevision(transaction, user.organizationId, revisionRef);
    });
  }

  async listRecentRevisions(
    user: AuthenticatedUser,
    limitInput = 10,
  ): Promise<BlueprintAssignmentRevision[]> {
    this.requireBlueprintAccess(user);
    if (!Number.isInteger(limitInput) || limitInput < 1 || limitInput > 20) {
      throw new RuntimeServiceError("CONFLICT", "Blueprint revision read limit is invalid");
    }
    return this.database.transaction(async (transaction) => {
      const rows = await transaction.query<{ revision_ref: string }>(
        [
          "SELECT revision.revision_ref FROM blueprint_assignment_revisions revision",
          "JOIN agent_installations agent ON agent.organization_id = revision.organization_id AND agent.id = revision.agent_id",
          "JOIN environments environment ON environment.organization_id = agent.organization_id AND environment.id = agent.environment_id",
          "JOIN clients client ON client.organization_id = environment.organization_id AND client.id = environment.client_id",
          "WHERE revision.organization_id = $1 AND ($2 = 'staff' OR client.user_id = $3)",
          "ORDER BY revision.committed_at DESC, revision.revision_ref DESC LIMIT $4 FOR UPDATE OF agent",
        ].join(" "),
        [user.organizationId, user.role, user.id, limitInput],
      );
      return Promise.all(rows.map((row) => this.readRevision(transaction, user.organizationId, row.revision_ref)));
    });
  }

  private async readStage(
    database: Pick<DatabaseClient, "query">,
    organizationId: string,
    previewId: string,
    now: Date,
  ): Promise<BlueprintStagedPreview> {
    const stored = await this.readStageInternal(database, organizationId, previewId);
    return blueprintStagedPreviewSchema.parse({
      version: BLUEPRINT_ASSIGNMENT_VERSION,
      previewId: stored.header.id,
      stagedAt: stored.header.staged_at.toISOString(),
      expiresAt: stored.header.expires_at.toISOString(),
      expired: now.getTime() >= stored.header.expires_at.getTime(),
      dataRowCount: Number(stored.header.data_row_count),
      assignmentCount: stored.assignments.length,
      uniqueAccountCount: new Set(stored.assignments.map((entry) => entry.accountLabel)).size,
      assignments: stored.assignments,
    });
  }

  private async readStageInternal(
    database: Pick<DatabaseClient, "query">,
    organizationId: string,
    previewId: string,
  ): Promise<{ header: StageHeaderRow; assignments: BlueprintAssignmentPreview[] }> {
    const header = (await database.query<StageHeaderRow>(
      "SELECT * FROM blueprint_preview_stages WHERE organization_id = $1 AND id = $2",
      [organizationId, previewId],
    ))[0];
    if (!header) throw new RuntimeServiceError("CONFLICT", "Blueprint stage was not found");
    const rows = await database.query<StageAssignmentRow>(
      [
        "SELECT assignment_ordinal, period, account_label, prop_firm, stack_level, strategy, instrument, source_row, source_slot",
        "FROM blueprint_preview_stage_assignments WHERE organization_id = $1 AND preview_id = $2 ORDER BY assignment_ordinal",
      ].join(" "),
      [organizationId, previewId],
    );
    const assignments = rows.map((row) => this.toAssignment(row));
    if (Number(header.assignment_count) !== assignments.length) throw new Error("Stored Blueprint stage assignment count is inconsistent");
    const expectedRequestHash = hashCanonicalPayload({
      version: BLUEPRINT_ASSIGNMENT_VERSION,
      sourceWorkbookHash: header.source_workbook_hash,
      canonicalPreviewHash: header.canonical_preview_hash,
      dataRowCount: Number(header.data_row_count),
      assignments,
    });
    const expectedContentHash = blueprintStageContentHash({
      previewId: header.id,
      sourceWorkbookHash: header.source_workbook_hash,
      canonicalPreviewHash: header.canonical_preview_hash,
      dataRowCount: Number(header.data_row_count),
      assignments,
      stagedAt: header.staged_at.toISOString(),
      expiresAt: header.expires_at.toISOString(),
      createdBy: header.created_by,
      idempotencyKey: header.idempotency_key,
      requestHash: header.request_hash,
    });
    if (header.request_hash !== expectedRequestHash || header.content_hash !== expectedContentHash) {
      throw new Error("Stored Blueprint stage failed canonical content hash validation");
    }
    return { header, assignments };
  }

  private async readRevision(
    database: Pick<DatabaseClient, "query">,
    organizationId: string,
    revisionRef: string,
  ): Promise<BlueprintAssignmentRevision> {
    const header = (await database.query<RevisionHeaderRow>(
      "SELECT * FROM blueprint_assignment_revisions WHERE organization_id = $1 AND revision_ref = $2",
      [organizationId, revisionRef],
    ))[0];
    if (!header) throw new RuntimeServiceError("CONFLICT", "Blueprint assignment revision was not found");
    const accounts = await this.readAccountBindings(database, organizationId, header.id);
    const assignments = await this.readStrategyBindings(database, organizationId, header.id);
    if (Number(header.mapping_count) !== accounts.length || Number(header.assignment_count) !== assignments.length) {
      throw new Error("Stored Blueprint assignment revision counts are inconsistent");
    }
    const expectedRequestHash = blueprintCommitRequestHash({
      previewId: header.preview_id,
      agentId: header.agent_id,
      idempotencyKey: header.idempotency_key,
      mappings: accounts.map((entry) => ({ accountLabel: entry.accountLabel, accountRef: entry.accountRef })),
    });
    const rootSource = {
      eventId: header.source_event_id,
      sequence: Number(header.source_sequence),
      stateDigest: header.source_state_digest,
      asOf: header.source_as_of.toISOString(),
      occurredAt: header.source_occurred_at.toISOString(),
      receivedAt: header.source_received_at.toISOString(),
    };
    const expectedContentHash = blueprintRevisionContentHash({
      revisionRef: header.revision_ref,
      previewId: header.preview_id,
      agentId: header.agent_id,
      source: rootSource,
      committedAt: header.committed_at.toISOString(),
      createdBy: header.created_by,
      idempotencyKey: header.idempotency_key,
      requestHash: header.request_hash,
      accounts,
      assignments,
    });
    if (header.request_hash !== expectedRequestHash || header.content_hash !== expectedContentHash) {
      throw new Error("Stored Blueprint assignment revision failed canonical content hash validation");
    }

    const states = await database.query<RevisionStateRow>(
      "SELECT * FROM blueprint_assignment_revision_states WHERE organization_id = $1 AND revision_id = $2 ORDER BY state_version",
      [organizationId, header.id],
    );
    if (states.length < 1 || states.length > 2) throw new Error("Stored Blueprint assignment state history is invalid");
    states.forEach((state, index) => {
      if (state.state_version !== index + 1 || (index === 0 ? state.previous_state_id !== null : state.previous_state_id !== states[index - 1].id)) {
        throw new Error("Stored Blueprint assignment state chain is invalid");
      }
      const expectedStateRequestHash = index === 0
        ? header.request_hash
        : blueprintStateRequestHash({
            revisionRef: header.revision_ref,
            expectedVersion: state.state_version - 1,
            idempotencyKey: state.idempotency_key,
          });
      const expectedStateHash = blueprintRevisionStateContentHash({
        revisionRef: header.revision_ref,
        stateVersion: state.state_version,
        status: state.status,
        previousStateId: state.previous_state_id,
        source: {
          eventId: state.source_event_id,
          sequence: Number(state.source_sequence),
          stateDigest: state.source_state_digest,
          asOf: state.source_as_of.toISOString(),
          occurredAt: state.source_occurred_at.toISOString(),
          receivedAt: state.source_received_at.toISOString(),
        },
        recordedAt: state.recorded_at.toISOString(),
        actorUserId: state.actor_user_id,
        idempotencyKey: state.idempotency_key,
        requestHash: state.request_hash,
      });
      if (state.request_hash !== expectedStateRequestHash || state.content_hash !== expectedStateHash) {
        throw new Error("Stored Blueprint assignment state failed canonical content hash validation");
      }
    });
    const current = states.at(-1) as RevisionStateRow;
    return blueprintAssignmentRevisionSchema.parse({
      version: BLUEPRINT_ASSIGNMENT_VERSION,
      revisionRef: header.revision_ref,
      agentId: header.agent_id,
      status: current.status,
      stateVersion: current.state_version,
      recordedAt: current.recorded_at.toISOString(),
      source: {
        eventId: current.source_event_id,
        sequence: Number(current.source_sequence),
        asOf: current.source_as_of.toISOString(),
        occurredAt: current.source_occurred_at.toISOString(),
        receivedAt: current.source_received_at.toISOString(),
      },
      accounts: accounts.map(({ accountLabel, accountRef, maskedIdentifier, displayLabel }) => ({
        accountLabel, accountRef, maskedIdentifier, displayLabel,
      })),
      assignments: assignments.map((assignment) => ({
        period: assignment.period,
        accountLabel: assignment.accountLabel,
        propFirm: assignment.propFirm,
        stackLevel: assignment.stackLevel,
        strategy: assignment.strategy,
        instrument: assignment.instrument,
        sourceRow: assignment.sourceRow,
        sourceSlot: assignment.sourceSlot,
        accountRef: assignment.accountRef,
        strategyRef: assignment.strategyRef,
      })),
    });
  }

  private async readAccountBindings(
    database: Pick<DatabaseClient, "query">,
    organizationId: string,
    revisionId: string,
  ): Promise<InternalAccountBinding[]> {
    const rows = await database.query<AccountBindingRow>(
      [
        "SELECT mapping_ordinal, account_label, account_ref, identifier_fingerprint, masked_identifier, display_label, runtime_binding_hash",
        "FROM blueprint_assignment_account_bindings WHERE organization_id = $1 AND revision_id = $2 ORDER BY mapping_ordinal",
      ].join(" "),
      [organizationId, revisionId],
    );
    return rows.map((row) => ({
      accountLabel: row.account_label,
      accountRef: row.account_ref,
      identifierFingerprint: row.identifier_fingerprint,
      maskedIdentifier: row.masked_identifier,
      displayLabel: row.display_label,
      runtimeBindingHash: row.runtime_binding_hash,
    }));
  }

  private async readStrategyBindings(
    database: Pick<DatabaseClient, "query">,
    organizationId: string,
    revisionId: string,
  ): Promise<InternalAssignmentBinding[]> {
    const rows = await database.query<StrategyBindingRow>(
      [
        "SELECT assignment_ordinal, period, account_label, prop_firm, stack_level, strategy, instrument, source_row,",
        "source_slot, account_ref, strategy_ref, runtime_binding_hash FROM blueprint_assignment_strategy_bindings",
        "WHERE organization_id = $1 AND revision_id = $2 ORDER BY assignment_ordinal",
      ].join(" "),
      [organizationId, revisionId],
    );
    return rows.map((row) => ({
      ...this.toAssignment(row),
      accountRef: row.account_ref,
      strategyRef: row.strategy_ref,
      runtimeBindingHash: row.runtime_binding_hash,
    }));
  }

  private assertExactMappings(assignments: BlueprintAssignmentPreview[], input: BlueprintCommitInput): void {
    const labels = [...new Set(assignments.map((entry) => entry.accountLabel))].sort();
    const mappedLabels = input.mappings.map((entry) => entry.accountLabel).sort();
    if (labels.length !== mappedLabels.length || labels.some((label, index) => label !== mappedLabels[index])) {
      throw new RuntimeServiceError("CONFLICT", "Mapping must cover every logical Blueprint account exactly once with no extras");
    }
  }

  private bindAssignments(
    assignments: BlueprintAssignmentPreview[],
    input: BlueprintCommitInput,
    observation: RuntimeObservationV2,
  ): { accounts: InternalAccountBinding[]; assignments: InternalAssignmentBinding[] } {
    const mappingByLabel = new Map(input.mappings.map((entry) => [entry.accountLabel, entry.accountRef]));
    const accounts = [...input.mappings]
      .sort((left, right) => left.accountLabel.localeCompare(right.accountLabel))
      .map((mapping) => {
        const account = this.requireEligibleAccount(observation, mapping.accountRef);
        return {
          accountLabel: mapping.accountLabel,
          accountRef: account.accountRef,
          identifierFingerprint: account.identifierFingerprint,
          maskedIdentifier: account.maskedIdentifier,
          displayLabel: account.displayLabel,
          runtimeBindingHash: this.accountBindingHash(observation, account),
        };
      });
    const seenStrategyRefs = new Set<string>();
    const boundAssignments = assignments.map((assignment) => {
      const accountRef = mappingByLabel.get(assignment.accountLabel);
      if (!accountRef) throw new Error("Validated Blueprint mapping disappeared");
      const matches = observation.state.strategies.filter((strategy) =>
        strategy.accountRef === accountRef
        && strategy.strategyTypeCode === assignment.strategy
        && strategy.instrumentCode === assignment.instrument,
      );
      if (matches.length !== 1) {
        throw new RuntimeServiceError("CONFLICT", "Each Blueprint strategy and instrument must match exactly one current strategy instance");
      }
      this.assertStableStrategy(matches[0]);
      if (seenStrategyRefs.has(matches[0].strategyRef)) {
        throw new RuntimeServiceError("CONFLICT", "A runtime strategy instance may be bound only once in a Blueprint revision");
      }
      seenStrategyRefs.add(matches[0].strategyRef);
      return {
        ...assignment,
        accountRef,
        strategyRef: matches[0].strategyRef,
        runtimeBindingHash: hashCanonicalPayload(matches[0]),
      };
    });
    return { accounts, assignments: boundAssignments };
  }

  private revalidateBindings(
    accounts: InternalAccountBinding[],
    assignments: InternalAssignmentBinding[],
    observation: RuntimeObservationV2,
  ): void {
    for (const binding of accounts) {
      const account = this.requireEligibleAccount(observation, binding.accountRef);
      if (
        account.identifierFingerprint !== binding.identifierFingerprint
        || account.maskedIdentifier !== binding.maskedIdentifier
        || account.displayLabel !== binding.displayLabel
        || this.accountBindingHash(observation, account) !== binding.runtimeBindingHash
      ) {
        throw new RuntimeServiceError("CONFLICT", "Bound simulation account changed after the Blueprint draft was created");
      }
    }
    for (const binding of assignments) {
      const matches = observation.state.strategies.filter((strategy) =>
        strategy.accountRef === binding.accountRef
        && strategy.strategyTypeCode === binding.strategy
        && strategy.instrumentCode === binding.instrument,
      );
      if (
        matches.length !== 1
        || matches[0].strategyRef !== binding.strategyRef
        || hashCanonicalPayload(matches[0]) !== binding.runtimeBindingHash
      ) {
        throw new RuntimeServiceError("CONFLICT", "Bound strategy instance changed after the Blueprint draft was created");
      }
      this.assertStableStrategy(matches[0]);
    }
  }

  private requireEligibleAccount(observation: RuntimeObservationV2, accountRef: string): RuntimeAccountObservationV2 {
    const matches = observation.state.accounts.filter((account) => account.accountRef === accountRef);
    if (matches.length !== 1) throw new RuntimeServiceError("CONFLICT", "Mapped runtime account is missing or ambiguous");
    const account = matches[0];
    if (
      account.classification.environment !== "simulation"
      || account.classification.authority !== "authoritative"
      || account.classification.source !== "ninjatrader_simulation_account"
      || account.status !== "connected"
      || account.connectionRefs.length === 0
    ) {
      throw new RuntimeServiceError("CONFLICT", "Blueprint mappings require an authoritative connected simulation account");
    }
    const connections = account.connectionRefs.map((ref) => observation.state.connections.find((entry) => entry.connectionRef === ref));
    if (connections.some((connection) => !connection || !this.isEligibleConnection(connection))) {
      throw new RuntimeServiceError("CONFLICT", "Mapped simulation account does not have complete healthy connection evidence");
    }
    return account;
  }

  private isEligibleConnection(connection: RuntimeConnectionObservationV2): boolean {
    return connection.kind !== "unknown"
      && connection.providerCode !== null
      && connection.status === "connected"
      && connection.health === "healthy"
      && !["stale", "unavailable", "unknown"].includes(connection.marketDataStatus);
  }

  private assertStableStrategy(strategy: RuntimeStrategyObservationV2): void {
    if (
      !["disabled", "running"].includes(strategy.runtimeState)
      || strategy.synchronizationState === "unknown"
    ) {
      throw new RuntimeServiceError("CONFLICT", "Blueprint strategy evidence is transitional or ambiguous");
    }
  }

  private accountBindingHash(observation: RuntimeObservationV2, account: RuntimeAccountObservationV2): string {
    const connections = account.connectionRefs.map((ref) => {
      const connection = observation.state.connections.find((entry) => entry.connectionRef === ref);
      if (!connection) throw new RuntimeServiceError("CONFLICT", "Mapped account references missing connection evidence");
      return connection;
    });
    return hashCanonicalPayload({ account, connections });
  }

  private assertOperationalObservation(
    observation: RuntimeObservationV2,
    occurredAt: string,
    receivedAt: Date,
    serverNow: Date,
  ): void {
    const asOfMs = Date.parse(observation.asOf);
    const occurredMs = Date.parse(occurredAt);
    const receivedMs = receivedAt.getTime();
    const nowMs = serverNow.getTime();
    if (!(asOfMs <= occurredMs && occurredMs <= receivedMs && receivedMs <= nowMs)) {
      throw new RuntimeServiceError("CONFLICT", "Runtime evidence chronology is invalid for Blueprint assignment");
    }
    if (
      observation.freshness.status !== "fresh"
      || observation.freshness.ageMs === null
      || nowMs - asOfMs > BLUEPRINT_RUNTIME_MAX_AGE_MS
      || Math.abs(observation.freshness.ageMs - (occurredMs - asOfMs)) > BLUEPRINT_DECLARED_AGE_TOLERANCE_MS
    ) {
      throw new RuntimeServiceError("CONFLICT", "Runtime evidence exceeds the server-owned Blueprint freshness policy");
    }
    const addon = observation.state.addon;
    if (!addon || addon.status !== "connected" || addon.health !== "healthy" || !addon.ipcAuthenticated) {
      throw new RuntimeServiceError("CONFLICT", "Blueprint assignment requires a healthy authenticated NinjaTrader Add-On");
    }
    for (const scope of ["accounts", "connections", "strategies"] as const) {
      const evidence = observation.state.collection.scopes[scope];
      if (!isSequentialInventoryScopeUsable(evidence)) {
        throw new RuntimeServiceError("CONFLICT", "Blueprint assignment requires usable sequential runtime account, connection, and strategy evidence with no source error");
      }
    }
  }

  private async getLatestAuthenticatedSource(
    transaction: Pick<DatabaseTransaction, "query">,
    organizationId: string,
    agentId: string,
  ): Promise<AuthenticatedSource> {
    const row = (await transaction.query<SourceEventRow>(
      [
        "SELECT event.id, event.protocol_version, event.event_id, event.agent_id, event.sequence, event.event_type,",
        "event.correlation_id, event.causation_id, event.occurred_at, event.received_at, event.payload_hash,",
        "event.envelope_hash, event.credential_id, event.legacy_unverified, event.payload,",
        "credential.agent_id AS credential_agent_id, credential.organization_id AS credential_organization_id",
        "FROM agent_events event LEFT JOIN agent_credentials credential",
        "ON credential.id = event.credential_id AND credential.organization_id = event.organization_id AND credential.agent_id = event.agent_id",
        "WHERE event.organization_id = $1 AND event.agent_id = $2 AND event.event_type = 'runtime.observation_v2'",
        "ORDER BY event.sequence DESC LIMIT 1",
      ].join(" "),
      [organizationId, agentId],
    ))[0];
    if (!row) throw new RuntimeServiceError("CONFLICT", "No Runtime-v2 observation is available for this agent");
    if (
      row.legacy_unverified
      || row.credential_id === null
      || row.envelope_hash === null
      || row.credential_agent_id !== row.agent_id
      || row.credential_organization_id !== organizationId
    ) {
      throw new RuntimeServiceError("CONFLICT", "Latest Runtime-v2 observation is not authenticated evidence");
    }
    try {
      return {
        row,
        event: parseRuntimeObservationV2Event({
          protocolVersion: row.protocol_version,
          eventId: row.event_id,
          agentId: row.agent_id,
          sequence: Number(row.sequence),
          eventType: row.event_type,
          correlationId: row.correlation_id,
          causationId: row.causation_id,
          occurredAt: row.occurred_at.toISOString(),
          payloadHash: row.payload_hash,
          envelopeHash: row.envelope_hash,
          payload: row.payload,
        }),
      };
    } catch {
      throw new RuntimeServiceError("CONFLICT", "Latest Runtime-v2 observation failed canonical integrity validation");
    }
  }

  private sourceEvidence(source: AuthenticatedSource) {
    return {
      eventId: source.event.eventId,
      sequence: source.event.sequence,
      stateDigest: source.event.payload.stateDigest,
      asOf: source.event.payload.asOf,
      occurredAt: source.event.occurredAt,
      receivedAt: source.row.received_at.toISOString(),
    };
  }

  private async insertState(transaction: DatabaseTransaction, input: {
    id: string;
    organizationId: string;
    revisionId: string;
    agentId: string;
    stateVersion: number;
    status: "draft" | "approved";
    previousStateId: string | null;
    source: AuthenticatedSource;
    recordedAt: Date;
    idempotencyKey: string;
    requestHash: string;
    contentHash: string;
    actorUserId: string;
  }): Promise<void> {
    await transaction.query(
      [
        "INSERT INTO blueprint_assignment_revision_states",
        "(id, organization_id, revision_id, agent_id, state_version, status, previous_state_id, source_agent_event_record_id,",
        "source_event_id, source_sequence, source_state_digest, source_as_of, source_occurred_at, source_received_at,",
        "recorded_at, idempotency_key, request_hash, content_hash, actor_user_id)",
        "VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)",
      ].join(" "),
      [
        input.id, input.organizationId, input.revisionId, input.agentId, input.stateVersion, input.status,
        input.previousStateId, input.source.row.id, input.source.event.eventId, input.source.event.sequence,
        input.source.event.payload.stateDigest, input.source.event.payload.asOf, input.source.event.occurredAt,
        input.source.row.received_at, input.recordedAt, input.idempotencyKey, input.requestHash, input.contentHash,
        input.actorUserId,
      ],
    );
  }

  private async requireAgentAccess(
    transaction: Pick<DatabaseClient, "query">,
    user: AuthenticatedUser,
    agentId: string,
  ): Promise<void> {
    const rows = await transaction.query<{ id: string }>(
      [
        "SELECT agent.id FROM agent_installations agent",
        "JOIN environments environment ON environment.organization_id = agent.organization_id AND environment.id = agent.environment_id",
        "JOIN clients client ON client.organization_id = environment.organization_id AND client.id = environment.client_id",
        "WHERE agent.organization_id = $1 AND agent.id = $2 AND ($3 = 'staff' OR client.user_id = $4)",
        "FOR UPDATE OF agent",
      ].join(" "),
      [user.organizationId, agentId, user.role, user.id],
    );
    if (!rows[0]) throw new RuntimeServiceError("FORBIDDEN", "Forbidden");
  }

  private async lockOrganization(transaction: Pick<DatabaseTransaction, "query">, organizationId: string): Promise<void> {
    const rows = await transaction.query<{ id: string }>("SELECT id FROM organizations WHERE id = $1 FOR UPDATE", [organizationId]);
    if (!rows[0]) throw new RuntimeServiceError("FORBIDDEN", "Forbidden");
  }

  private assertActorIdempotency(
    storedActor: string,
    actor: string,
    storedRequestHash: string,
    requestHash: string,
    label: string,
  ): void {
    if (storedActor !== actor) throw new RuntimeServiceError("FORBIDDEN", `${label} idempotency key belongs to a different operator`);
    if (storedRequestHash !== requestHash) throw new RuntimeServiceError("CONFLICT", `${label} idempotency replay conflicts with stored evidence`);
  }

  private toAssignment(row: StageAssignmentRow): BlueprintAssignmentPreview {
    return blueprintAssignmentPreviewSchema.parse({
      period: row.period,
      accountLabel: row.account_label,
      propFirm: row.prop_firm,
      stackLevel: Number(row.stack_level),
      strategy: row.strategy,
      instrument: row.instrument,
      sourceRow: Number(row.source_row),
      sourceSlot: Number(row.source_slot),
    });
  }

  private requireClock(): Date {
    const value = this.clock();
    if (!Number.isFinite(value.getTime())) throw new Error("Blueprint repository clock returned an invalid timestamp");
    return value;
  }

  private requireBlueprintAccess(user: AuthenticatedUser): void {
    if (user.role === "staff" || user.role === "client") {
      try {
        requireDeploymentCapability("transport.local");
        return;
      } catch {
        // Central Blueprint evidence remains private until a client-issued,
        // scope-bound support OTP grant is enforced at this repository boundary.
      }
    }
    throw new RuntimeServiceError("FORBIDDEN", "Forbidden");
  }

  private async insertRows(transaction: DatabaseTransaction, prefix: string, rows: unknown[][]): Promise<void> {
    for (let offset = 0; offset < rows.length; offset += INSERT_BATCH_SIZE) {
      const batch = rows.slice(offset, offset + INSERT_BATCH_SIZE);
      if (!batch.length) continue;
      const width = batch[0].length;
      if (!batch.every((row) => row.length === width)) throw new Error("Blueprint bulk insert row shape mismatch");
      let parameter = 1;
      const placeholders = batch.map(() => `(${Array.from({ length: width }, () => `$${parameter++}`).join(", ")})`);
      await transaction.query(`${prefix} VALUES ${placeholders.join(", ")}`, batch.flat());
    }
  }
}

export function getBlueprintAssignmentRepository(): BlueprintAssignmentRepository {
  return new BlueprintAssignmentRepository();
}
