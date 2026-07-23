import "server-only";

import { randomUUID } from "node:crypto";

import { z } from "zod";

import type { DatabaseClient, DatabaseTransaction } from "@/lib/db/client";
import { getDatabase } from "@/lib/db/client";
import { requireDeploymentCapability } from "@/lib/deployment/server";
import { userAuditSubject } from "@/lib/domain/audit-evidence";
import { hashCanonicalPayload } from "@/lib/domain/canonical-json";
import {
  OPERATOR_SCHEDULE_PROTOCOL_VERSION,
  OPERATOR_SCHEDULE_TIME_ZONE,
  RUNTIME_FRESHNESS_LIMIT_MS,
  createWeeklyOperatorAuthority,
  defaultOperatorScheduleSettings,
  isOccurrenceStatusTransitionAllowed,
  materializeWeeklyOperatorOccurrences,
  operatorScheduleSettingsSchema,
  reviseOperatorScheduleSettings,
  type OperatorScheduleOccurrence,
  type OperatorScheduleOccurrenceStatus,
  type OperatorScheduleSettings,
  type WeeklyOperatorAuthority,
} from "@/lib/domain/operator-schedule-contracts";
import {
  parseRuntimeObservationV2Event,
  type RuntimeObservationV2Event,
} from "@/lib/domain/runtime-contracts";
import type {
  RuntimeAccountObservationV2,
  RuntimeConnectionObservationV2,
  RuntimeObservationV2,
  RuntimeStrategyObservationV2,
} from "@/lib/domain/runtime-observation-v2";
import { RuntimeServiceError } from "@/lib/domain/runtime-errors";
import type { AuthenticatedUser } from "@/lib/domain/types";
import { writeAuditEvent } from "@/lib/repositories/audit-writer";

const idSchema = z.uuid();
const idempotencyKeySchema = z.string().regex(/^[A-Za-z0-9:._-]{16,200}$/);
const localDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const DECLARED_AGE_TOLERANCE_MS = 5_000;

const createScheduleInputSchema = z.object({
  agentId: idSchema,
  idempotencyKey: idempotencyKeySchema,
}).strict();

const reviseSettingsInputSchema = z.object({
  scheduleId: idSchema,
  expectedSettingsRevision: z.number().int().positive(),
  operatingWeekdays: operatorScheduleSettingsSchema.shape.operatingWeekdays,
  enableLocalTime: operatorScheduleSettingsSchema.shape.enableLocalTime,
  eodLocalTime: operatorScheduleSettingsSchema.shape.eodLocalTime,
  fridayStopLocalTime: operatorScheduleSettingsSchema.shape.fridayStopLocalTime,
  idempotencyKey: idempotencyKeySchema,
}).strict();

const armWeekInputSchema = z.object({
  scheduleId: idSchema,
  weekStartLocalDate: localDateSchema,
  idempotencyKey: idempotencyKeySchema,
}).strict();

const revokeAuthorityInputSchema = z.object({
  authorityId: idSchema,
  idempotencyKey: idempotencyKeySchema,
  reasonCode: z.enum(["MANUAL_OPERATOR", "FRIDAY_STOP"]).default("MANUAL_OPERATOR"),
}).strict();

const disarmAuthorityInputSchema = z.object({
  authorityId: idSchema,
  idempotencyKey: idempotencyKeySchema,
}).strict();

type Clock = () => Date;

interface ScheduleRow {
  id: string;
  agent_id: string;
  timezone: typeof OPERATOR_SCHEDULE_TIME_ZONE;
  created_at: Date;
  idempotency_key: string;
  request_hash: string;
  content_hash: string;
  created_by: string;
}

interface SettingsRow {
  id: string;
  schedule_id: string;
  agent_id: string;
  settings_revision: number;
  previous_settings_id: string | null;
  timezone: typeof OPERATOR_SCHEDULE_TIME_ZONE;
  operating_weekdays: string[];
  enable_local_time: string;
  eod_local_time: string;
  friday_stop_local_time: string;
  recorded_at: Date;
  idempotency_key: string;
  request_hash: string;
  content_hash: string;
  actor_user_id: string;
}

interface AssignmentRow {
  id: string;
  revision_ref: string;
  agent_id: string;
  state_id: string;
  state_version: number;
  state_recorded_at: Date;
}

interface AssignmentAccountRow {
  account_ref: string;
  runtime_binding_hash: string;
}

interface AssignmentStrategyRow {
  account_ref: string;
  strategy_ref: string;
  runtime_binding_hash: string;
}

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

interface AuthenticatedSource {
  row: SourceEventRow;
  event: RuntimeObservationV2Event;
}

interface FlatTarget {
  accountRef: string;
  expectedAccountType: "simulation";
  accountBindingHash: string;
  strategyRef: string;
  strategyBindingHash: string;
}

interface AuthorityRow {
  id: string;
  schedule_id: string;
  agent_id: string;
  settings_id: string;
  settings_revision: number;
  assignment_revision_id: string;
  assignment_revision_ref: string;
  assignment_state_id: string;
  week_start_local_date: Date | string;
  armed_at: Date;
  enable_authority_expires_at: Date;
  source_agent_event_record_id: string;
  source_event_id: string;
  source_sequence: number | string;
  source_state_digest: string;
  source_as_of: Date;
  source_occurred_at: Date;
  source_received_at: Date;
  target_binding_hash: string;
  account_count: number;
  strategy_count: number;
  idempotency_key: string;
  request_hash: string;
  content_hash: string;
  actor_user_id: string;
}

interface AuthorityTransitionRow {
  id: string;
  authority_id: string;
  schedule_id: string;
  agent_id: string;
  transition_version: number;
  previous_transition_id: string | null;
  from_state: "armed" | "revoked" | null;
  to_state: "armed" | "revoked" | "disarmed";
  reason_code: string;
  source_agent_event_record_id: string | null;
  recorded_at: Date;
  idempotency_key: string;
  request_hash: string;
  content_hash: string;
  actor_user_id: string;
}

interface OccurrenceRow {
  id: string;
  occurrence_key: string;
  authority_id: string;
  schedule_id: string;
  agent_id: string;
  settings_revision: number;
  assignment_revision_ref: string;
  target_binding_hash: string;
  week_start_local_date: Date | string;
  local_date: Date | string;
  local_time: string;
  timezone: typeof OPERATOR_SCHEDULE_TIME_ZONE;
  kind: OperatorScheduleOccurrence["kind"];
  friday_sequence: number | null;
  scheduled_at: Date;
  deadline_at: Date | null;
  retry_policy: OperatorScheduleOccurrence["retryPolicy"];
  created_at: Date;
  content_hash: string;
}

interface OccurrenceTransitionRow {
  id: string;
  occurrence_id: string;
  occurrence_key: string;
  agent_id: string;
  transition_version: number;
  previous_transition_id: string | null;
  from_status: OperatorScheduleOccurrenceStatus | null;
  to_status: OperatorScheduleOccurrenceStatus;
  reason_code: string | null;
  source_agent_event_record_id: string | null;
  recorded_at: Date;
  idempotency_key: string;
  request_hash: string;
  content_hash: string;
  actor_user_id: string;
}

export interface StoredOperatorSchedule {
  scheduleId: string;
  agentId: string;
  createdAt: string;
  settings: OperatorScheduleSettings;
}

export interface StoredWeeklyAuthority {
  authority: WeeklyOperatorAuthority;
  state: "armed" | "revoked" | "disarmed";
  targetBindingHash: string;
  sourceEventId: string;
}

export interface StoredScheduleOccurrence extends OperatorScheduleOccurrence {
  transitionVersion: number;
}

export interface WriteResult<T> {
  value: T;
  duplicate: boolean;
}

export class OperatorScheduleRepository {
  constructor(
    private readonly database: DatabaseClient = getDatabase(),
    private readonly clock: Clock = () => new Date(),
  ) {}

  async createSchedule(user: AuthenticatedUser, input: unknown): Promise<WriteResult<StoredOperatorSchedule>> {
    this.requireScheduleAccess(user);
    const value = createScheduleInputSchema.parse(input);
    const now = this.requireClock();
    const requestHash = hashCanonicalPayload({
      protocolVersion: OPERATOR_SCHEDULE_PROTOCOL_VERSION,
      action: "create_schedule",
      agentId: value.agentId,
    });
    return this.database.transaction(async (transaction) => {
      await this.lockOrganization(transaction, user.organizationId);
      const duplicate = (await transaction.query<ScheduleRow>(
        "SELECT * FROM operator_schedules WHERE organization_id = $1 AND idempotency_key = $2",
        [user.organizationId, value.idempotencyKey],
      ))[0];
      if (duplicate) {
        this.assertActorIdempotency(duplicate.created_by, user.id, duplicate.request_hash, requestHash, "Schedule creation");
        return { value: await this.readSchedule(transaction, user.organizationId, duplicate.id), duplicate: true };
      }
      await this.requireOwnedAgent(transaction, user, value.agentId, true);
      const existing = (await transaction.query<{ id: string }>(
        "SELECT id FROM operator_schedules WHERE organization_id = $1 AND agent_id = $2",
        [user.organizationId, value.agentId],
      ))[0];
      if (existing) throw new RuntimeServiceError("CONFLICT", "This agent already has an operator schedule");

      const scheduleId = randomUUID();
      const contentHash = this.scheduleContentHash({ scheduleId, agentId: value.agentId, createdAt: now, createdBy: user.id, idempotencyKey: value.idempotencyKey, requestHash });
      await transaction.query(
        "INSERT INTO operator_schedules (id, organization_id, agent_id, timezone, created_at, idempotency_key, request_hash, content_hash, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
        [scheduleId, user.organizationId, value.agentId, OPERATOR_SCHEDULE_TIME_ZONE, now, value.idempotencyKey, requestHash, contentHash, user.id],
      );
      const settings = defaultOperatorScheduleSettings(scheduleId);
      await this.insertSettings(transaction, user.organizationId, value.agentId, settings, null, now, this.derivedIdempotencyKey(value.idempotencyKey, "settings"), requestHash, user.id);
      await writeAuditEvent(transaction, {
        organizationId: user.organizationId,
        actorUserId: user.id,
        actorSubjectId: userAuditSubject(user.id),
        action: "operator_schedule.created",
        entityType: "operator_schedule",
        entityId: scheduleId,
        metadata: { agentId: value.agentId, settingsRevision: 1, requestHash, contentHash },
        occurredAt: now,
      });
      return { value: await this.readSchedule(transaction, user.organizationId, scheduleId), duplicate: false };
    });
  }

  async reviseSettings(user: AuthenticatedUser, input: unknown): Promise<WriteResult<StoredOperatorSchedule>> {
    this.requireScheduleAccess(user);
    const value = reviseSettingsInputSchema.parse(input);
    const now = this.requireClock();
    const requestHash = hashCanonicalPayload({ protocolVersion: OPERATOR_SCHEDULE_PROTOCOL_VERSION, action: "revise_settings", ...value });
    return this.database.transaction(async (transaction) => {
      await this.lockOrganization(transaction, user.organizationId);
      const duplicate = (await transaction.query<SettingsRow>(
        "SELECT * FROM operator_schedule_settings_revisions WHERE organization_id = $1 AND idempotency_key = $2",
        [user.organizationId, value.idempotencyKey],
      ))[0];
      if (duplicate) {
        this.assertActorIdempotency(duplicate.actor_user_id, user.id, duplicate.request_hash, requestHash, "Schedule settings");
        return { value: await this.readSchedule(transaction, user.organizationId, duplicate.schedule_id), duplicate: true };
      }
      const schedule = await this.requireOwnedSchedule(transaction, user, value.scheduleId, true);
      const currentRow = await this.latestSettingsRow(transaction, user.organizationId, schedule.id);
      if (currentRow.settings_revision !== value.expectedSettingsRevision) throw new RuntimeServiceError("CONFLICT", "Schedule settings changed before this edit");
      const current = this.settingsFromRow(currentRow);
      const revised = reviseOperatorScheduleSettings(current, {
        operatingWeekdays: value.operatingWeekdays,
        enableLocalTime: value.enableLocalTime,
        eodLocalTime: value.eodLocalTime,
        fridayStopLocalTime: value.fridayStopLocalTime,
      });
      this.validateSettingsAcrossRepresentativeDates(revised);
      await this.insertSettings(transaction, user.organizationId, schedule.agent_id, revised, currentRow.id, now, value.idempotencyKey, requestHash, user.id);
      const invalidated = await this.invalidateArmedAuthorities(transaction, user, schedule, currentRow.settings_revision, now, value.idempotencyKey);
      await writeAuditEvent(transaction, {
        organizationId: user.organizationId,
        actorUserId: user.id,
        actorSubjectId: userAuditSubject(user.id),
        action: "operator_schedule.settings_revised",
        entityType: "operator_schedule",
        entityId: schedule.id,
        metadata: { previousRevision: current.settingsRevision, settingsRevision: revised.settingsRevision, invalidatedAuthorityCount: invalidated, requestHash },
        occurredAt: now,
      });
      return { value: await this.readSchedule(transaction, user.organizationId, schedule.id), duplicate: false };
    });
  }

  async armWeek(user: AuthenticatedUser, input: unknown): Promise<WriteResult<StoredWeeklyAuthority>> {
    this.requireScheduleAccess(user);
    const value = armWeekInputSchema.parse(input);
    const now = this.requireClock();
    const requestHash = hashCanonicalPayload({ protocolVersion: OPERATOR_SCHEDULE_PROTOCOL_VERSION, action: "arm_week", scheduleId: value.scheduleId, weekStartLocalDate: value.weekStartLocalDate });
    return this.database.transaction(async (transaction) => {
      await this.lockOrganization(transaction, user.organizationId);
      const duplicate = (await transaction.query<AuthorityRow>(
        "SELECT * FROM operator_weekly_authorities WHERE organization_id = $1 AND idempotency_key = $2",
        [user.organizationId, value.idempotencyKey],
      ))[0];
      if (duplicate) {
        this.assertActorIdempotency(duplicate.actor_user_id, user.id, duplicate.request_hash, requestHash, "Weekly arm");
        return { value: await this.readAuthority(transaction, user.organizationId, duplicate.id), duplicate: true };
      }
      const schedule = await this.requireOwnedSchedule(transaction, user, value.scheduleId, true);
      const settingsRow = await this.latestSettingsRow(transaction, user.organizationId, schedule.id);
      const settings = this.settingsFromRow(settingsRow);
      this.validateSettingsForWeek(settings, value.weekStartLocalDate);
      const existing = (await transaction.query<{ id: string }>(
        "SELECT id FROM operator_weekly_authorities WHERE organization_id = $1 AND schedule_id = $2 AND week_start_local_date = $3",
        [user.organizationId, schedule.id, value.weekStartLocalDate],
      ))[0];
      if (existing) throw new RuntimeServiceError("CONFLICT", "This schedule week already has an authority record and cannot silently renew");

      const assignment = await this.getCurrentApprovedAssignment(transaction, user.organizationId, schedule.agent_id);
      const source = await this.getLatestAuthenticatedSource(transaction, user.organizationId, schedule.agent_id);
      this.assertOperationalObservation(source, now);
      const flatTargets = await this.revalidateAndCopyTargets(transaction, user.organizationId, assignment, source.event.payload);
      const groupedTargets = this.groupTargets(flatTargets);
      const authorityId = randomUUID();
      const authority = createWeeklyOperatorAuthority({
        settings,
        authorityId,
        scheduleId: schedule.id,
        settingsRevision: settings.settingsRevision,
        assignmentRevisionRef: assignment.revision_ref,
        weekStartLocalDate: value.weekStartLocalDate,
        armedAt: now.toISOString(),
        targets: groupedTargets,
      });
      const targetBindingHash = hashCanonicalPayload(flatTargets);
      const contentHash = this.authorityContentHash({ authority, agentId: schedule.agent_id, assignment, source, targetBindingHash, actorUserId: user.id, idempotencyKey: value.idempotencyKey, requestHash });
      await transaction.query(
        [
          "INSERT INTO operator_weekly_authorities",
          "(id, organization_id, schedule_id, agent_id, settings_id, settings_revision, assignment_revision_id, assignment_revision_ref, assignment_state_id,",
          "week_start_local_date, armed_at, enable_authority_expires_at, source_agent_event_record_id, source_event_id, source_sequence, source_state_digest,",
          "source_as_of, source_occurred_at, source_received_at, target_binding_hash, account_count, strategy_count, idempotency_key, request_hash, content_hash, actor_user_id)",
          "VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26)",
        ].join(" "),
        [authorityId, user.organizationId, schedule.id, schedule.agent_id, settingsRow.id, settings.settingsRevision, assignment.id, assignment.revision_ref,
          assignment.state_id, value.weekStartLocalDate, now, authority.enableAuthorityExpiresAt, source.row.id, source.event.eventId, source.event.sequence,
          source.event.payload.stateDigest, source.event.payload.asOf, source.event.occurredAt, source.row.received_at, targetBindingHash,
          groupedTargets.length, flatTargets.length, value.idempotencyKey, requestHash, contentHash, user.id],
      );
      await this.insertTargets(transaction, user.organizationId, authorityId, schedule, flatTargets);
      await this.insertAuthorityTransition(transaction, user.organizationId, authorityId, schedule, null, "armed", "EXPLICIT_WEEKLY_ARM", null, now, this.derivedIdempotencyKey(value.idempotencyKey, "armed"), requestHash, user.id);
      const occurrences = materializeWeeklyOperatorOccurrences(settings, authority);
      await this.insertOccurrences(transaction, user, schedule, authorityId, occurrences, now, value.idempotencyKey);
      await writeAuditEvent(transaction, {
        organizationId: user.organizationId,
        actorUserId: user.id,
        actorSubjectId: userAuditSubject(user.id),
        action: "operator_schedule.week_armed",
        entityType: "operator_weekly_authority",
        entityId: authorityId,
        metadata: { scheduleId: schedule.id, agentId: schedule.agent_id, weekStartLocalDate: value.weekStartLocalDate, settingsRevision: settings.settingsRevision, assignmentRevisionRef: assignment.revision_ref, accountCount: groupedTargets.length, strategyCount: flatTargets.length, sourceEventId: source.event.eventId, targetBindingHash, requestHash, contentHash },
        occurredAt: now,
      });
      return { value: await this.readAuthority(transaction, user.organizationId, authorityId), duplicate: false };
    });
  }

  async revokeAuthority(user: AuthenticatedUser, input: unknown): Promise<WriteResult<StoredWeeklyAuthority>> {
    this.requireScheduleAccess(user);
    const value = revokeAuthorityInputSchema.parse(input);
    const now = this.requireClock();
    const requestHash = hashCanonicalPayload({ protocolVersion: OPERATOR_SCHEDULE_PROTOCOL_VERSION, action: "revoke_authority", authorityId: value.authorityId, reasonCode: value.reasonCode });
    return this.database.transaction(async (transaction) => {
      await this.lockOrganization(transaction, user.organizationId);
      const duplicate = await this.findAuthorityTransitionByIdempotency(transaction, user.organizationId, value.idempotencyKey);
      if (duplicate) {
        this.assertActorIdempotency(duplicate.actor_user_id, user.id, duplicate.request_hash, requestHash, "Authority revocation");
        return { value: await this.readAuthority(transaction, user.organizationId, duplicate.authority_id), duplicate: true };
      }
      const authority = await this.requireOwnedAuthority(transaction, user, value.authorityId);
      const latest = await this.latestAuthorityTransition(transaction, user.organizationId, authority.id);
      if (latest.to_state !== "armed") throw new RuntimeServiceError("CONFLICT", "Weekly authority is not armed");
      await this.insertAuthorityTransition(transaction, user.organizationId, authority.id, { id: authority.schedule_id, agent_id: authority.agent_id }, latest, "revoked", value.reasonCode, null, now, value.idempotencyKey, requestHash, user.id);
      await this.supersedeOpenOccurrences(transaction, user, authority, now, value.idempotencyKey);
      await writeAuditEvent(transaction, {
        organizationId: user.organizationId,
        actorUserId: user.id,
        actorSubjectId: userAuditSubject(user.id),
        action: "operator_schedule.authority_revoked",
        entityType: "operator_weekly_authority",
        entityId: authority.id,
        metadata: { scheduleId: authority.schedule_id, agentId: authority.agent_id, reasonCode: value.reasonCode, requestHash },
        occurredAt: now,
      });
      return { value: await this.readAuthority(transaction, user.organizationId, authority.id), duplicate: false };
    });
  }

  async recordAuthorityDisarmed(user: AuthenticatedUser, input: unknown): Promise<WriteResult<StoredWeeklyAuthority>> {
    this.requireScheduleAccess(user);
    const value = disarmAuthorityInputSchema.parse(input);
    const now = this.requireClock();
    const requestHash = hashCanonicalPayload({ protocolVersion: OPERATOR_SCHEDULE_PROTOCOL_VERSION, action: "record_disarmed", authorityId: value.authorityId });
    return this.database.transaction(async (transaction) => {
      await this.lockOrganization(transaction, user.organizationId);
      const duplicate = await this.findAuthorityTransitionByIdempotency(transaction, user.organizationId, value.idempotencyKey);
      if (duplicate) {
        this.assertActorIdempotency(duplicate.actor_user_id, user.id, duplicate.request_hash, requestHash, "Authority disarm");
        return { value: await this.readAuthority(transaction, user.organizationId, duplicate.authority_id), duplicate: true };
      }
      const authority = await this.requireOwnedAuthority(transaction, user, value.authorityId);
      const latest = await this.latestAuthorityTransition(transaction, user.organizationId, authority.id);
      if (latest.to_state !== "revoked") throw new RuntimeServiceError("CONFLICT", "Authority must be revoked before disarm is recorded");
      const source = await this.getLatestAuthenticatedSource(transaction, user.organizationId, authority.agent_id);
      this.assertOperationalObservation(source, now);
      const targets = await this.readFlatTargets(transaction, user.organizationId, authority.id);
      this.assertTargetsDisabled(targets, source.event.payload);
      await this.recordVerifiedExactDisableOccurrence(
        transaction,
        user,
        authority,
        source.row.id,
        now,
        value.idempotencyKey,
      );
      await this.insertAuthorityTransition(transaction, user.organizationId, authority.id, { id: authority.schedule_id, agent_id: authority.agent_id }, latest, "disarmed", "EXACT_DISABLE_VERIFIED", source.row.id, now, value.idempotencyKey, requestHash, user.id);
      await this.recordManualDisarmOccurrence(
        transaction,
        user,
        authority,
        source.row.id,
        now,
        value.idempotencyKey,
      );
      await writeAuditEvent(transaction, {
        organizationId: user.organizationId,
        actorUserId: user.id,
        actorSubjectId: userAuditSubject(user.id),
        action: "operator_schedule.authority_disarmed",
        entityType: "operator_weekly_authority",
        entityId: authority.id,
        metadata: { scheduleId: authority.schedule_id, agentId: authority.agent_id, sourceEventId: source.event.eventId, strategyCount: targets.length, requestHash },
        occurredAt: now,
      });
      return { value: await this.readAuthority(transaction, user.organizationId, authority.id), duplicate: false };
    });
  }

  async getSchedule(user: AuthenticatedUser, scheduleIdInput: string): Promise<StoredOperatorSchedule | null> {
    this.requireScheduleAccess(user);
    const scheduleId = idSchema.parse(scheduleIdInput);
    const row = (await this.database.query<ScheduleRow>("SELECT * FROM operator_schedules WHERE organization_id = $1 AND id = $2", [user.organizationId, scheduleId]))[0];
    if (!row) return null;
    await this.requireOwnedAgent(this.database, user, row.agent_id, false);
    return this.readSchedule(this.database, user.organizationId, row.id);
  }

  async listOccurrences(user: AuthenticatedUser, authorityIdInput: string): Promise<StoredScheduleOccurrence[]> {
    this.requireScheduleAccess(user);
    const authorityId = idSchema.parse(authorityIdInput);
    await this.requireOwnedAuthority(this.database, user, authorityId);
    const rows = await this.database.query<OccurrenceRow>("SELECT * FROM operator_schedule_occurrences WHERE organization_id = $1 AND authority_id = $2 ORDER BY scheduled_at, friday_sequence NULLS FIRST, kind", [user.organizationId, authorityId]);
    return Promise.all(rows.map((row) => this.readOccurrence(this.database, user.organizationId, row)));
  }

  async countCurrentlyArmedAuthoritiesForAgent(user: AuthenticatedUser, agentIdInput: string): Promise<number> {
    this.requireScheduleAccess(user);
    const agentId = idSchema.parse(agentIdInput);
    await this.requireOwnedAgent(this.database, user, agentId, false);
    const now = this.requireClock();
    const rows = await this.database.query<{ count: number | string }>(
      [
        "SELECT COUNT(*) AS count FROM operator_weekly_authorities authority",
        "JOIN LATERAL (SELECT to_state FROM operator_weekly_authority_transitions transition WHERE transition.authority_id = authority.id ORDER BY transition_version DESC LIMIT 1) latest_state ON true",
        "JOIN LATERAL (SELECT settings_revision FROM operator_schedule_settings_revisions settings WHERE settings.schedule_id = authority.schedule_id ORDER BY settings_revision DESC LIMIT 1) latest_settings ON true",
        "WHERE authority.organization_id = $1 AND authority.agent_id = $2 AND latest_state.to_state = 'armed'",
        "AND latest_settings.settings_revision = authority.settings_revision AND authority.armed_at <= $3 AND authority.enable_authority_expires_at > $3",
      ].join(" "),
      [user.organizationId, agentId, now],
    );
    return Number(rows[0]?.count ?? 0);
  }

  private async readSchedule(database: Pick<DatabaseClient, "query">, organizationId: string, scheduleId: string): Promise<StoredOperatorSchedule> {
    const schedule = (await database.query<ScheduleRow>("SELECT * FROM operator_schedules WHERE organization_id = $1 AND id = $2", [organizationId, scheduleId]))[0];
    if (!schedule) throw new RuntimeServiceError("CONFLICT", "Operator schedule was not found");
    const expected = this.scheduleContentHash({ scheduleId: schedule.id, agentId: schedule.agent_id, createdAt: schedule.created_at, createdBy: schedule.created_by, idempotencyKey: schedule.idempotency_key, requestHash: schedule.request_hash });
    if (schedule.content_hash !== expected) throw new Error("Stored operator schedule failed canonical content hash validation");
    const settings = this.settingsFromRow(await this.latestSettingsRow(database, organizationId, scheduleId));
    return { scheduleId: schedule.id, agentId: schedule.agent_id, createdAt: schedule.created_at.toISOString(), settings };
  }

  private async readAuthority(database: Pick<DatabaseClient, "query">, organizationId: string, authorityId: string): Promise<StoredWeeklyAuthority> {
    const row = (await database.query<AuthorityRow>("SELECT * FROM operator_weekly_authorities WHERE organization_id = $1 AND id = $2", [organizationId, authorityId]))[0];
    if (!row) throw new RuntimeServiceError("CONFLICT", "Weekly authority was not found");
    const targets = await this.readFlatTargets(database, organizationId, authorityId);
    if (targets.length !== Number(row.strategy_count) || new Set(targets.map((target) => target.accountRef)).size !== Number(row.account_count)) throw new Error("Stored weekly authority target counts are inconsistent");
    if (hashCanonicalPayload(targets) !== row.target_binding_hash) throw new Error("Stored weekly authority target binding hash is invalid");
    const settingsRow = (await database.query<SettingsRow>("SELECT * FROM operator_schedule_settings_revisions WHERE organization_id = $1 AND id = $2", [organizationId, row.settings_id]))[0];
    if (!settingsRow) throw new Error("Stored weekly authority settings evidence is missing");
    const authority = createWeeklyOperatorAuthority({ settings: this.settingsFromRow(settingsRow), authorityId: row.id, scheduleId: row.schedule_id, settingsRevision: Number(row.settings_revision), assignmentRevisionRef: row.assignment_revision_ref, weekStartLocalDate: this.dateOnly(row.week_start_local_date), armedAt: row.armed_at.toISOString(), targets: this.groupTargets(targets) });
    if (authority.enableAuthorityExpiresAt !== row.enable_authority_expires_at.toISOString()) throw new Error("Stored weekly authority expiry is inconsistent");
    const assignment = (await database.query<AssignmentRow>(
      "SELECT revision.id, revision.revision_ref, revision.agent_id, state.id AS state_id, state.state_version, state.recorded_at AS state_recorded_at FROM blueprint_assignment_revisions revision JOIN blueprint_assignment_revision_states state ON state.revision_id = revision.id AND state.organization_id = revision.organization_id WHERE revision.organization_id = $1 AND revision.id = $2 AND state.id = $3",
      [organizationId, row.assignment_revision_id, row.assignment_state_id],
    ))[0];
    if (!assignment) throw new Error("Stored weekly authority assignment evidence is missing");
    const contentHash = this.authorityContentHash({ authority, agentId: row.agent_id, assignment, source: { row: { id: row.source_agent_event_record_id, event_id: row.source_event_id, sequence: row.source_sequence, received_at: row.source_received_at } as SourceEventRow, event: { eventId: row.source_event_id, sequence: Number(row.source_sequence), occurredAt: row.source_occurred_at.toISOString(), payload: { stateDigest: row.source_state_digest, asOf: row.source_as_of.toISOString() } } as RuntimeObservationV2Event }, targetBindingHash: row.target_binding_hash, actorUserId: row.actor_user_id, idempotencyKey: row.idempotency_key, requestHash: row.request_hash });
    if (contentHash !== row.content_hash) throw new Error("Stored weekly authority failed canonical content hash validation");
    const latest = await this.latestAuthorityTransition(database, organizationId, row.id);
    return { authority, state: latest.to_state, targetBindingHash: row.target_binding_hash, sourceEventId: row.source_event_id };
  }

  private async readOccurrence(database: Pick<DatabaseClient, "query">, organizationId: string, row: OccurrenceRow): Promise<StoredScheduleOccurrence> {
    const latest = await this.latestOccurrenceTransition(database, organizationId, row.id);
    const content = this.occurrenceContent(row);
    if (hashCanonicalPayload(content) !== row.content_hash) throw new Error("Stored schedule occurrence failed canonical content hash validation");
    return {
      protocolVersion: OPERATOR_SCHEDULE_PROTOCOL_VERSION,
      occurrenceKey: row.occurrence_key,
      scheduleId: row.schedule_id,
      authorityId: row.authority_id,
      settingsRevision: Number(row.settings_revision),
      assignmentRevisionRef: row.assignment_revision_ref,
      targetBindingHash: row.target_binding_hash,
      weekStartLocalDate: this.dateOnly(row.week_start_local_date),
      localDate: this.dateOnly(row.local_date),
      localTime: row.local_time,
      timezone: row.timezone,
      kind: row.kind,
      fridaySequence: row.friday_sequence,
      scheduledAt: row.scheduled_at.toISOString(),
      deadlineAt: row.deadline_at?.toISOString() ?? null,
      status: latest.to_status,
      statusReason: latest.reason_code === "ARMED_AFTER_DUE" ? "ARMED_AFTER_DUE" : null,
      retryPolicy: row.retry_policy,
      transitionVersion: Number(latest.transition_version),
    };
  }

  private async insertSettings(transaction: DatabaseTransaction, organizationId: string, agentId: string, settings: OperatorScheduleSettings, previousSettingsId: string | null, recordedAt: Date, idempotencyKey: string, requestHash: string, actorUserId: string): Promise<string> {
    const id = randomUUID();
    const contentHash = this.settingsContentHash({ id, settings, agentId, previousSettingsId, recordedAt, idempotencyKey, requestHash, actorUserId });
    await transaction.query(
      [
        "INSERT INTO operator_schedule_settings_revisions",
        "(id, organization_id, schedule_id, agent_id, settings_revision, previous_settings_id, timezone, operating_weekdays, enable_local_time, eod_local_time, friday_stop_local_time, renewal_policy, dst_policy, enable_missed_policy, eod_missed_policy, friday_stop_policy, recorded_at, idempotency_key, request_hash, content_hash, actor_user_id)",
        "VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)",
      ].join(" "),
      [id, organizationId, settings.scheduleId, agentId, settings.settingsRevision, previousSettingsId, settings.timezone, settings.operatingWeekdays, settings.enableLocalTime, settings.eodLocalTime, settings.fridayStopLocalTime, settings.renewalPolicy, settings.dstPolicy, settings.missedPolicies.enable, settings.missedPolicies.eod, settings.missedPolicies.fridayStop, recordedAt, idempotencyKey, requestHash, contentHash, actorUserId],
    );
    return id;
  }

  private async insertTargets(transaction: DatabaseTransaction, organizationId: string, authorityId: string, schedule: Pick<ScheduleRow, "id" | "agent_id">, targets: FlatTarget[]): Promise<void> {
    for (const [index, target] of targets.entries()) {
      await transaction.query(
        "INSERT INTO operator_weekly_authority_targets (id, organization_id, authority_id, schedule_id, agent_id, target_ordinal, account_ref, expected_account_type, account_binding_hash, strategy_ref, strategy_binding_hash) VALUES ($1,$2,$3,$4,$5,$6,$7,'simulation',$8,$9,$10)",
        [randomUUID(), organizationId, authorityId, schedule.id, schedule.agent_id, index + 1, target.accountRef, target.accountBindingHash, target.strategyRef, target.strategyBindingHash],
      );
    }
  }

  private async insertOccurrences(transaction: DatabaseTransaction, user: AuthenticatedUser, schedule: ScheduleRow, authorityId: string, occurrences: OperatorScheduleOccurrence[], now: Date, armIdempotencyKey: string): Promise<void> {
    for (const [index, occurrence] of occurrences.entries()) {
      const id = randomUUID();
      const row = { id, occurrence_key: occurrence.occurrenceKey, authority_id: authorityId, schedule_id: schedule.id, agent_id: schedule.agent_id, settings_revision: occurrence.settingsRevision, assignment_revision_ref: occurrence.assignmentRevisionRef, target_binding_hash: occurrence.targetBindingHash, week_start_local_date: occurrence.weekStartLocalDate, local_date: occurrence.localDate, local_time: occurrence.localTime, timezone: occurrence.timezone, kind: occurrence.kind, friday_sequence: occurrence.fridaySequence, scheduled_at: new Date(occurrence.scheduledAt), deadline_at: occurrence.deadlineAt ? new Date(occurrence.deadlineAt) : null, retry_policy: occurrence.retryPolicy, created_at: now } as OccurrenceRow;
      const contentHash = hashCanonicalPayload(this.occurrenceContent(row));
      await transaction.query(
        "INSERT INTO operator_schedule_occurrences (id, organization_id, occurrence_key, authority_id, schedule_id, agent_id, settings_revision, assignment_revision_ref, target_binding_hash, week_start_local_date, local_date, local_time, timezone, kind, friday_sequence, scheduled_at, deadline_at, retry_policy, created_at, content_hash) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)",
        [id, user.organizationId, occurrence.occurrenceKey, authorityId, schedule.id, schedule.agent_id, occurrence.settingsRevision, occurrence.assignmentRevisionRef, occurrence.targetBindingHash, occurrence.weekStartLocalDate, occurrence.localDate, occurrence.localTime, occurrence.timezone, occurrence.kind, occurrence.fridaySequence, occurrence.scheduledAt, occurrence.deadlineAt, occurrence.retryPolicy, now, contentHash],
      );
      const initialKey = this.derivedIdempotencyKey(armIdempotencyKey, `occ:${String(index + 1).padStart(2, "0")}`);
      const initialRequestHash = hashCanonicalPayload({ occurrenceKey: occurrence.occurrenceKey, toStatus: occurrence.status, reasonCode: occurrence.statusReason });
      await this.insertOccurrenceTransition(transaction, user.organizationId, row, null, occurrence.status, occurrence.statusReason, null, now, initialKey, initialRequestHash, user.id);
    }
  }

  private async insertAuthorityTransition(transaction: DatabaseTransaction, organizationId: string, authorityId: string, schedule: Pick<ScheduleRow, "id" | "agent_id">, previous: AuthorityTransitionRow | null, toState: "armed" | "revoked" | "disarmed", reasonCode: string, sourceEventRecordId: string | null, recordedAt: Date, idempotencyKey: string, requestHash: string, actorUserId: string): Promise<void> {
    const id = randomUUID();
    const version = previous ? Number(previous.transition_version) + 1 : 1;
    const content = { authorityId, scheduleId: schedule.id, agentId: schedule.agent_id, transitionVersion: version, previousTransitionId: previous?.id ?? null, fromState: previous?.to_state ?? null, toState, reasonCode, sourceEventRecordId, recordedAt: recordedAt.toISOString(), idempotencyKey, requestHash, actorUserId };
    await transaction.query(
      "INSERT INTO operator_weekly_authority_transitions (id, organization_id, authority_id, schedule_id, agent_id, transition_version, previous_transition_id, from_state, to_state, reason_code, source_agent_event_record_id, recorded_at, idempotency_key, request_hash, content_hash, actor_user_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)",
      [id, organizationId, authorityId, schedule.id, schedule.agent_id, version, previous?.id ?? null, previous?.to_state ?? null, toState, reasonCode, sourceEventRecordId, recordedAt, idempotencyKey, requestHash, hashCanonicalPayload(content), actorUserId],
    );
  }

  private async insertOccurrenceTransition(transaction: DatabaseTransaction, organizationId: string, occurrence: OccurrenceRow, previous: OccurrenceTransitionRow | null, toStatus: OperatorScheduleOccurrenceStatus, reasonCode: string | null, sourceEventRecordId: string | null, recordedAt: Date, idempotencyKey: string, requestHash: string, actorUserId: string): Promise<void> {
    const id = randomUUID();
    const version = previous ? Number(previous.transition_version) + 1 : 1;
    const content = { occurrenceKey: occurrence.occurrence_key, agentId: occurrence.agent_id, transitionVersion: version, previousTransitionId: previous?.id ?? null, fromStatus: previous?.to_status ?? null, toStatus, reasonCode, sourceEventRecordId, recordedAt: recordedAt.toISOString(), idempotencyKey, requestHash, actorUserId };
    await transaction.query(
      "INSERT INTO operator_schedule_occurrence_transitions (id, organization_id, occurrence_id, occurrence_key, agent_id, transition_version, previous_transition_id, from_status, to_status, reason_code, source_agent_event_record_id, recorded_at, idempotency_key, request_hash, content_hash, actor_user_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)",
      [id, organizationId, occurrence.id, occurrence.occurrence_key, occurrence.agent_id, version, previous?.id ?? null, previous?.to_status ?? null, toStatus, reasonCode, sourceEventRecordId, recordedAt, idempotencyKey, requestHash, hashCanonicalPayload(content), actorUserId],
    );
  }

  private async invalidateArmedAuthorities(transaction: DatabaseTransaction, user: AuthenticatedUser, schedule: ScheduleRow, invalidatedRevision: number, now: Date, idempotencyKey: string): Promise<number> {
    const rows = await transaction.query<AuthorityRow>(
      "SELECT authority.* FROM operator_weekly_authorities authority JOIN LATERAL (SELECT to_state FROM operator_weekly_authority_transitions transition WHERE transition.authority_id = authority.id ORDER BY transition_version DESC LIMIT 1) latest ON true WHERE authority.organization_id = $1 AND authority.schedule_id = $2 AND authority.settings_revision = $3 AND latest.to_state = 'armed'",
      [user.organizationId, schedule.id, invalidatedRevision],
    );
    for (const [index, authority] of rows.entries()) {
      const latest = await this.latestAuthorityTransition(transaction, user.organizationId, authority.id);
      const transitionKey = this.derivedIdempotencyKey(idempotencyKey, `revoke:${String(index + 1).padStart(2, "0")}`);
      const requestHash = hashCanonicalPayload({ authorityId: authority.id, reasonCode: "SETTINGS_REVISION_CHANGED", settingsRevision: invalidatedRevision });
      await this.insertAuthorityTransition(transaction, user.organizationId, authority.id, schedule, latest, "revoked", "SETTINGS_REVISION_CHANGED", null, now, transitionKey, requestHash, user.id);
      await this.supersedeOpenOccurrences(transaction, user, authority, now, transitionKey);
    }
    return rows.length;
  }

  private async supersedeOpenOccurrences(transaction: DatabaseTransaction, user: AuthenticatedUser, authority: AuthorityRow, now: Date, keyPrefix: string): Promise<void> {
    const rows = await transaction.query<OccurrenceRow>("SELECT * FROM operator_schedule_occurrences WHERE organization_id = $1 AND authority_id = $2 ORDER BY scheduled_at, kind", [user.organizationId, authority.id]);
    let index = 0;
    for (const occurrence of rows) {
      if (["REVOKE_ENABLE_AUTHORITY", "DISABLE_EXACT_SIM_STACK", "DISARM_WEEKLY_SCHEDULE"].includes(occurrence.kind)) continue;
      const latest = await this.latestOccurrenceTransition(transaction, user.organizationId, occurrence.id);
      if (!isOccurrenceStatusTransitionAllowed(latest.to_status, "superseded")) continue;
      index += 1;
      const idempotencyKey = this.derivedIdempotencyKey(keyPrefix, `sup:${String(index).padStart(2, "0")}`);
      const requestHash = hashCanonicalPayload({ occurrenceKey: occurrence.occurrence_key, toStatus: "superseded", reasonCode: "AUTHORITY_REVOKED" });
      await this.insertOccurrenceTransition(transaction, user.organizationId, occurrence, latest, "superseded", "AUTHORITY_REVOKED", null, now, idempotencyKey, requestHash, user.id);
    }
  }

  private async recordVerifiedExactDisableOccurrence(
    transaction: DatabaseTransaction,
    user: AuthenticatedUser,
    authority: AuthorityRow,
    sourceEventRecordId: string,
    now: Date,
    keyPrefix: string,
  ): Promise<void> {
    const occurrence = (await transaction.query<OccurrenceRow>(
      "SELECT * FROM operator_schedule_occurrences WHERE organization_id = $1 AND authority_id = $2 AND kind = 'DISABLE_EXACT_SIM_STACK'",
      [user.organizationId, authority.id],
    ))[0];
    if (!occurrence) throw new Error("Exact-disable occurrence evidence is missing");
    const latest = await this.latestOccurrenceTransition(transaction, user.organizationId, occurrence.id);
    if (latest.to_status === "completed") return;
    if (!isOccurrenceStatusTransitionAllowed(latest.to_status, "skipped")) {
      throw new RuntimeServiceError("CONFLICT", "Exact-disable occurrence cannot be reconciled safely from its current state");
    }
    const idempotencyKey = this.derivedIdempotencyKey(keyPrefix, "verified-exact-disable");
    const requestHash = hashCanonicalPayload({
      occurrenceKey: occurrence.occurrence_key,
      toStatus: "skipped",
      reasonCode: "EXACT_TARGETS_ALREADY_DISABLED",
      sourceEventRecordId,
    });
    await this.insertOccurrenceTransition(
      transaction,
      user.organizationId,
      occurrence,
      latest,
      "skipped",
      "EXACT_TARGETS_ALREADY_DISABLED",
      sourceEventRecordId,
      now,
      idempotencyKey,
      requestHash,
      user.id,
    );
  }

  private async recordManualDisarmOccurrence(
    transaction: DatabaseTransaction,
    user: AuthenticatedUser,
    authority: AuthorityRow,
    sourceEventRecordId: string,
    now: Date,
    keyPrefix: string,
  ): Promise<void> {
    const occurrence = (await transaction.query<OccurrenceRow>(
      "SELECT * FROM operator_schedule_occurrences WHERE organization_id = $1 AND authority_id = $2 AND kind = 'DISARM_WEEKLY_SCHEDULE'",
      [user.organizationId, authority.id],
    ))[0];
    if (!occurrence) throw new Error("Disarm occurrence evidence is missing");
    const latest = await this.latestOccurrenceTransition(transaction, user.organizationId, occurrence.id);
    if (latest.to_status === "completed") return;
    if (!isOccurrenceStatusTransitionAllowed(latest.to_status, "skipped")) {
      throw new RuntimeServiceError("CONFLICT", "Disarm occurrence cannot be reconciled safely from its current state");
    }
    const idempotencyKey = this.derivedIdempotencyKey(keyPrefix, "manual-disarm");
    const requestHash = hashCanonicalPayload({
      occurrenceKey: occurrence.occurrence_key,
      toStatus: "skipped",
      reasonCode: "MANUAL_DISARM_RECORDED",
      sourceEventRecordId,
    });
    await this.insertOccurrenceTransition(
      transaction,
      user.organizationId,
      occurrence,
      latest,
      "skipped",
      "MANUAL_DISARM_RECORDED",
      sourceEventRecordId,
      now,
      idempotencyKey,
      requestHash,
      user.id,
    );
  }

  private async getCurrentApprovedAssignment(database: Pick<DatabaseClient, "query">, organizationId: string, agentId: string): Promise<AssignmentRow> {
    const row = (await database.query<AssignmentRow>(
      [
        "SELECT revision.id, revision.revision_ref, revision.agent_id, state.id AS state_id, state.state_version, state.recorded_at AS state_recorded_at",
        "FROM blueprint_assignment_revisions revision",
        "JOIN LATERAL (SELECT current_state.* FROM blueprint_assignment_revision_states current_state WHERE current_state.organization_id = revision.organization_id AND current_state.revision_id = revision.id ORDER BY state_version DESC LIMIT 1) state ON true",
        "WHERE revision.organization_id = $1 AND revision.agent_id = $2 AND state.status = 'approved'",
        "ORDER BY state.recorded_at DESC, revision.committed_at DESC LIMIT 1",
      ].join(" "),
      [organizationId, agentId],
    ))[0];
    if (!row) throw new RuntimeServiceError("CONFLICT", "No current approved Blueprint assignment revision exists for this agent");
    return row;
  }

  private async revalidateAndCopyTargets(database: Pick<DatabaseClient, "query">, organizationId: string, assignment: AssignmentRow, observation: RuntimeObservationV2): Promise<FlatTarget[]> {
    const accounts = await database.query<AssignmentAccountRow>("SELECT account_ref, runtime_binding_hash FROM blueprint_assignment_account_bindings WHERE organization_id = $1 AND revision_id = $2 ORDER BY account_ref", [organizationId, assignment.id]);
    const strategies = await database.query<AssignmentStrategyRow>("SELECT account_ref, strategy_ref, runtime_binding_hash FROM blueprint_assignment_strategy_bindings WHERE organization_id = $1 AND revision_id = $2 ORDER BY account_ref, strategy_ref", [organizationId, assignment.id]);
    if (!accounts.length || !strategies.length) throw new RuntimeServiceError("CONFLICT", "Approved Blueprint assignment has no exact targets");
    const accountHashes = new Map<string, string>();
    for (const binding of accounts) {
      const account = this.requireEligibleAccount(observation, binding.account_ref);
      const hash = this.accountBindingHash(observation, account);
      if (hash !== binding.runtime_binding_hash) throw new RuntimeServiceError("CONFLICT", "Approved Blueprint account binding no longer matches Runtime-v2 evidence");
      accountHashes.set(binding.account_ref, hash);
    }
    const targets = strategies.map((binding) => {
      if (!accountHashes.has(binding.account_ref)) throw new RuntimeServiceError("CONFLICT", "Approved Blueprint strategy binding references an unavailable account");
      const matches = observation.state.strategies.filter((strategy) => strategy.strategyRef === binding.strategy_ref && strategy.accountRef === binding.account_ref);
      if (matches.length !== 1) throw new RuntimeServiceError("CONFLICT", "Approved Blueprint strategy target is missing or ambiguous");
      this.assertStableStrategy(matches[0]);
      const hash = hashCanonicalPayload(matches[0]);
      if (hash !== binding.runtime_binding_hash) throw new RuntimeServiceError("CONFLICT", "Approved Blueprint strategy binding no longer matches Runtime-v2 evidence");
      return { accountRef: binding.account_ref, expectedAccountType: "simulation" as const, accountBindingHash: accountHashes.get(binding.account_ref) as string, strategyRef: binding.strategy_ref, strategyBindingHash: hash };
    });
    return targets.sort((left, right) => left.accountRef.localeCompare(right.accountRef) || left.strategyRef.localeCompare(right.strategyRef));
  }

  private requireEligibleAccount(observation: RuntimeObservationV2, accountRef: string): RuntimeAccountObservationV2 {
    const matches = observation.state.accounts.filter((account) => account.accountRef === accountRef);
    if (matches.length !== 1) throw new RuntimeServiceError("CONFLICT", "Approved Blueprint account target is missing or ambiguous");
    const account = matches[0];
    if (account.classification.environment !== "simulation" || account.classification.authority !== "authoritative" || account.classification.source !== "ninjatrader_simulation_account" || account.status !== "connected" || !account.connectionRefs.length) {
      throw new RuntimeServiceError("CONFLICT", "Weekly authority requires authoritative connected simulation accounts");
    }
    const connections = account.connectionRefs.map((ref) => observation.state.connections.find((connection) => connection.connectionRef === ref));
    if (connections.some((connection) => !connection || !this.isEligibleConnection(connection))) throw new RuntimeServiceError("CONFLICT", "Weekly authority requires complete healthy connection evidence for every account");
    return account;
  }

  private isEligibleConnection(connection: RuntimeConnectionObservationV2): boolean {
    return connection.kind !== "unknown" && connection.providerCode !== null && connection.status === "connected" && connection.health === "healthy" && !["stale", "unavailable", "unknown"].includes(connection.marketDataStatus);
  }

  private assertStableStrategy(strategy: RuntimeStrategyObservationV2): void {
    if (!["disabled", "running"].includes(strategy.runtimeState) || strategy.synchronizationState === "unknown") throw new RuntimeServiceError("CONFLICT", "Weekly authority requires exact stable strategy evidence");
  }

  private assertTargetsDisabled(targets: FlatTarget[], observation: RuntimeObservationV2): void {
    for (const target of targets) {
      const strategy = observation.state.strategies.find((entry) => entry.strategyRef === target.strategyRef && entry.accountRef === target.accountRef);
      if (!strategy || strategy.enabled || strategy.runtimeState !== "disabled") throw new RuntimeServiceError("CONFLICT", "Every exact strategy must be observed disabled before disarm is recorded");
    }
  }

  private accountBindingHash(observation: RuntimeObservationV2, account: RuntimeAccountObservationV2): string {
    const connections = account.connectionRefs.map((ref) => {
      const connection = observation.state.connections.find((entry) => entry.connectionRef === ref);
      if (!connection) throw new RuntimeServiceError("CONFLICT", "Account references missing connection evidence");
      return connection;
    });
    return hashCanonicalPayload({ account, connections });
  }

  private assertOperationalObservation(source: AuthenticatedSource, now: Date): void {
    const observation = source.event.payload;
    const asOfMs = Date.parse(observation.asOf);
    const occurredMs = Date.parse(source.event.occurredAt);
    const receivedMs = source.row.received_at.getTime();
    const nowMs = now.getTime();
    if (!(asOfMs <= occurredMs && occurredMs <= receivedMs && receivedMs <= nowMs)) throw new RuntimeServiceError("CONFLICT", "Runtime evidence chronology is invalid for weekly authority");
    if (observation.freshness.status !== "fresh" || observation.freshness.ageMs === null || nowMs - asOfMs > RUNTIME_FRESHNESS_LIMIT_MS || Math.abs(observation.freshness.ageMs - (occurredMs - asOfMs)) > DECLARED_AGE_TOLERANCE_MS) throw new RuntimeServiceError("CONFLICT", "Runtime evidence exceeds the server-owned 30-second weekly authority freshness policy");
    const addon = observation.state.addon;
    if (!addon || addon.status !== "connected" || addon.health !== "healthy" || !addon.ipcAuthenticated) throw new RuntimeServiceError("CONFLICT", "Weekly authority requires a healthy authenticated NinjaTrader Add-On");
    for (const scope of ["accounts", "connections", "strategies"] as const) {
      const evidence = observation.state.collection.scopes[scope];
      if (evidence.status !== "complete" || evidence.errors.length !== 0) throw new RuntimeServiceError("CONFLICT", "Weekly authority requires complete Runtime-v2 account, connection, and strategy evidence");
    }
  }

  private async getLatestAuthenticatedSource(database: Pick<DatabaseClient, "query">, organizationId: string, agentId: string): Promise<AuthenticatedSource> {
    const row = (await database.query<SourceEventRow>(
      "SELECT event.id, event.protocol_version, event.event_id, event.agent_id, event.sequence, event.event_type, event.correlation_id, event.causation_id, event.occurred_at, event.received_at, event.payload_hash, event.envelope_hash, event.credential_id, event.legacy_unverified, event.payload, credential.agent_id AS credential_agent_id, credential.organization_id AS credential_organization_id FROM agent_events event LEFT JOIN agent_credentials credential ON credential.id = event.credential_id AND credential.organization_id = event.organization_id AND credential.agent_id = event.agent_id WHERE event.organization_id = $1 AND event.agent_id = $2 AND event.event_type = 'runtime.observation_v2' ORDER BY event.sequence DESC LIMIT 1",
      [organizationId, agentId],
    ))[0];
    if (!row) throw new RuntimeServiceError("CONFLICT", "No Runtime-v2 observation is available for this agent");
    if (row.legacy_unverified || row.credential_id === null || row.envelope_hash === null || row.credential_agent_id !== row.agent_id || row.credential_organization_id !== organizationId) throw new RuntimeServiceError("CONFLICT", "Latest Runtime-v2 observation is not authenticated evidence");
    try {
      return { row, event: parseRuntimeObservationV2Event({ protocolVersion: row.protocol_version, eventId: row.event_id, agentId: row.agent_id, sequence: Number(row.sequence), eventType: row.event_type, correlationId: row.correlation_id, causationId: row.causation_id, occurredAt: row.occurred_at.toISOString(), payloadHash: row.payload_hash, envelopeHash: row.envelope_hash, payload: row.payload }) };
    } catch {
      throw new RuntimeServiceError("CONFLICT", "Latest Runtime-v2 observation failed canonical integrity validation");
    }
  }

  private async requireOwnedAgent(database: Pick<DatabaseClient, "query">, user: AuthenticatedUser, agentId: string, lock: boolean): Promise<void> {
    const rows = await database.query<{ id: string }>(
      `SELECT agent.id FROM agent_installations agent JOIN environments environment ON environment.id = agent.environment_id AND environment.organization_id = agent.organization_id JOIN clients client ON client.id = environment.client_id AND client.organization_id = environment.organization_id WHERE agent.organization_id = $1 AND agent.id = $2 AND client.user_id = $3${lock ? " FOR UPDATE OF agent" : ""}`,
      [user.organizationId, agentId, user.id],
    );
    if (!rows[0]) throw new RuntimeServiceError("FORBIDDEN", "The selected agent is not owned by this client");
  }

  private async requireOwnedSchedule(database: Pick<DatabaseClient, "query">, user: AuthenticatedUser, scheduleId: string, lock: boolean): Promise<ScheduleRow> {
    const row = (await database.query<ScheduleRow>(`SELECT * FROM operator_schedules WHERE organization_id = $1 AND id = $2${lock ? " FOR UPDATE" : ""}`, [user.organizationId, scheduleId]))[0];
    if (!row) throw new RuntimeServiceError("CONFLICT", "Operator schedule was not found");
    await this.requireOwnedAgent(database, user, row.agent_id, false);
    return row;
  }

  private async requireOwnedAuthority(database: Pick<DatabaseClient, "query">, user: AuthenticatedUser, authorityId: string): Promise<AuthorityRow> {
    const row = (await database.query<AuthorityRow>("SELECT * FROM operator_weekly_authorities WHERE organization_id = $1 AND id = $2", [user.organizationId, authorityId]))[0];
    if (!row) throw new RuntimeServiceError("CONFLICT", "Weekly authority was not found");
    await this.requireOwnedAgent(database, user, row.agent_id, false);
    return row;
  }

  private async requireOwnedOccurrence(database: Pick<DatabaseClient, "query">, user: AuthenticatedUser, occurrenceKey: string): Promise<OccurrenceRow> {
    const row = (await database.query<OccurrenceRow>("SELECT * FROM operator_schedule_occurrences WHERE organization_id = $1 AND occurrence_key = $2", [user.organizationId, occurrenceKey]))[0];
    if (!row) throw new RuntimeServiceError("CONFLICT", "Schedule occurrence was not found");
    await this.requireOwnedAgent(database, user, row.agent_id, false);
    return row;
  }

  private async latestSettingsRow(database: Pick<DatabaseClient, "query">, organizationId: string, scheduleId: string): Promise<SettingsRow> {
    const row = (await database.query<SettingsRow>("SELECT * FROM operator_schedule_settings_revisions WHERE organization_id = $1 AND schedule_id = $2 ORDER BY settings_revision DESC LIMIT 1", [organizationId, scheduleId]))[0];
    if (!row) throw new Error("Operator schedule settings evidence is missing");
    this.assertSettingsHash(row);
    return row;
  }

  private async latestAuthorityTransition(database: Pick<DatabaseClient, "query">, organizationId: string, authorityId: string): Promise<AuthorityTransitionRow> {
    const rows = await database.query<AuthorityTransitionRow>("SELECT * FROM operator_weekly_authority_transitions WHERE organization_id = $1 AND authority_id = $2 ORDER BY transition_version", [organizationId, authorityId]);
    if (!rows.length) throw new Error("Weekly authority transition evidence is missing");
    rows.forEach((row, index) => {
      const previous = index ? rows[index - 1] : null;
      if (Number(row.transition_version) !== index + 1 || row.previous_transition_id !== (previous?.id ?? null) || row.from_state !== (previous?.to_state ?? null)) throw new Error("Weekly authority transition chain is invalid");
      const expected = hashCanonicalPayload({ authorityId: row.authority_id, scheduleId: row.schedule_id, agentId: row.agent_id, transitionVersion: Number(row.transition_version), previousTransitionId: row.previous_transition_id, fromState: row.from_state, toState: row.to_state, reasonCode: row.reason_code, sourceEventRecordId: row.source_agent_event_record_id, recordedAt: row.recorded_at.toISOString(), idempotencyKey: row.idempotency_key, requestHash: row.request_hash, actorUserId: row.actor_user_id });
      if (expected !== row.content_hash) throw new Error("Weekly authority transition failed canonical content hash validation");
    });
    return rows.at(-1) as AuthorityTransitionRow;
  }

  private async latestOccurrenceTransition(database: Pick<DatabaseClient, "query">, organizationId: string, occurrenceId: string): Promise<OccurrenceTransitionRow> {
    const rows = await database.query<OccurrenceTransitionRow>("SELECT * FROM operator_schedule_occurrence_transitions WHERE organization_id = $1 AND occurrence_id = $2 ORDER BY transition_version", [organizationId, occurrenceId]);
    if (!rows.length) throw new Error("Occurrence transition evidence is missing");
    rows.forEach((row, index) => {
      const previous = index ? rows[index - 1] : null;
      if (Number(row.transition_version) !== index + 1 || row.previous_transition_id !== (previous?.id ?? null) || row.from_status !== (previous?.to_status ?? null)) throw new Error("Occurrence transition chain is invalid");
      const expected = hashCanonicalPayload({ occurrenceKey: row.occurrence_key, agentId: row.agent_id, transitionVersion: Number(row.transition_version), previousTransitionId: row.previous_transition_id, fromStatus: row.from_status, toStatus: row.to_status, reasonCode: row.reason_code, sourceEventRecordId: row.source_agent_event_record_id, recordedAt: row.recorded_at.toISOString(), idempotencyKey: row.idempotency_key, requestHash: row.request_hash, actorUserId: row.actor_user_id });
      if (expected !== row.content_hash) throw new Error("Occurrence transition failed canonical content hash validation");
    });
    return rows.at(-1) as OccurrenceTransitionRow;
  }

  private async findAuthorityTransitionByIdempotency(database: Pick<DatabaseClient, "query">, organizationId: string, idempotencyKey: string): Promise<AuthorityTransitionRow | undefined> {
    return (await database.query<AuthorityTransitionRow>("SELECT * FROM operator_weekly_authority_transitions WHERE organization_id = $1 AND idempotency_key = $2", [organizationId, idempotencyKey]))[0];
  }

  private async readFlatTargets(database: Pick<DatabaseClient, "query">, organizationId: string, authorityId: string): Promise<FlatTarget[]> {
    const rows = await database.query<{ account_ref: string; expected_account_type: "simulation"; account_binding_hash: string; strategy_ref: string; strategy_binding_hash: string }>("SELECT account_ref, expected_account_type, account_binding_hash, strategy_ref, strategy_binding_hash FROM operator_weekly_authority_targets WHERE organization_id = $1 AND authority_id = $2 ORDER BY target_ordinal", [organizationId, authorityId]);
    return rows.map((row) => ({ accountRef: row.account_ref, expectedAccountType: row.expected_account_type, accountBindingHash: row.account_binding_hash, strategyRef: row.strategy_ref, strategyBindingHash: row.strategy_binding_hash }));
  }

  private settingsFromRow(row: SettingsRow): OperatorScheduleSettings {
    const settings = operatorScheduleSettingsSchema.parse({ protocolVersion: OPERATOR_SCHEDULE_PROTOCOL_VERSION, scheduleId: row.schedule_id, settingsRevision: Number(row.settings_revision), timezone: row.timezone, operatingWeekdays: row.operating_weekdays, enableLocalTime: row.enable_local_time, eodLocalTime: row.eod_local_time, fridayStopLocalTime: row.friday_stop_local_time, renewalPolicy: "explicit_arm_each_week", dstPolicy: "reject_ambiguous_or_nonexistent", missedPolicies: { enable: "skip_after_due_window_no_catch_up", eod: "run_once_same_local_day", fridayStop: "revoke_then_latch_until_verified" } });
    this.assertSettingsHash(row);
    return settings;
  }

  private assertSettingsHash(row: SettingsRow): void {
    const settings = operatorScheduleSettingsSchema.parse({ protocolVersion: OPERATOR_SCHEDULE_PROTOCOL_VERSION, scheduleId: row.schedule_id, settingsRevision: Number(row.settings_revision), timezone: row.timezone, operatingWeekdays: row.operating_weekdays, enableLocalTime: row.enable_local_time, eodLocalTime: row.eod_local_time, fridayStopLocalTime: row.friday_stop_local_time, renewalPolicy: "explicit_arm_each_week", dstPolicy: "reject_ambiguous_or_nonexistent", missedPolicies: { enable: "skip_after_due_window_no_catch_up", eod: "run_once_same_local_day", fridayStop: "revoke_then_latch_until_verified" } });
    const expected = this.settingsContentHash({ id: row.id, settings, agentId: row.agent_id, previousSettingsId: row.previous_settings_id, recordedAt: row.recorded_at, idempotencyKey: row.idempotency_key, requestHash: row.request_hash, actorUserId: row.actor_user_id });
    if (expected !== row.content_hash) throw new Error("Stored schedule settings failed canonical content hash validation");
  }

  private groupTargets(targets: FlatTarget[]): WeeklyOperatorAuthority["targets"] {
    const grouped = new Map<string, string[]>();
    for (const target of targets) grouped.set(target.accountRef, [...(grouped.get(target.accountRef) ?? []), target.strategyRef]);
    return [...grouped.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([accountRef, strategyRefs]) => ({ accountRef, expectedAccountType: "simulation" as const, strategyRefs: strategyRefs.sort() }));
  }

  private validateSettingsForWeek(settings: OperatorScheduleSettings, weekStartLocalDate: string): void {
    const probe = createWeeklyOperatorAuthority({ settings, authorityId: randomUUID(), scheduleId: settings.scheduleId, settingsRevision: settings.settingsRevision, assignmentRevisionRef: `assignment_rev_${"a".repeat(16)}`, weekStartLocalDate, armedAt: new Date(0).toISOString(), targets: [{ accountRef: `acct_${"a".repeat(16)}`, expectedAccountType: "simulation", strategyRefs: [`strat_${"a".repeat(16)}`] }] });
    materializeWeeklyOperatorOccurrences(settings, probe);
  }

  private validateSettingsAcrossRepresentativeDates(settings: OperatorScheduleSettings): void {
    for (const week of ["2026-01-05", "2026-03-02", "2026-07-06", "2026-10-26"]) this.validateSettingsForWeek(settings, week);
  }

  private scheduleContentHash(input: { scheduleId: string; agentId: string; createdAt: Date; createdBy: string; idempotencyKey: string; requestHash: string }): string {
    return hashCanonicalPayload({ protocolVersion: OPERATOR_SCHEDULE_PROTOCOL_VERSION, scheduleId: input.scheduleId, agentId: input.agentId, timezone: OPERATOR_SCHEDULE_TIME_ZONE, createdAt: input.createdAt.toISOString(), createdBy: input.createdBy, idempotencyKey: input.idempotencyKey, requestHash: input.requestHash });
  }

  private settingsContentHash(input: { id: string; settings: OperatorScheduleSettings; agentId: string; previousSettingsId: string | null; recordedAt: Date; idempotencyKey: string; requestHash: string; actorUserId: string }): string {
    return hashCanonicalPayload({ protocolVersion: OPERATOR_SCHEDULE_PROTOCOL_VERSION, settingsId: input.id, agentId: input.agentId, settings: input.settings, previousSettingsId: input.previousSettingsId, recordedAt: input.recordedAt.toISOString(), idempotencyKey: input.idempotencyKey, requestHash: input.requestHash, actorUserId: input.actorUserId });
  }

  private authorityContentHash(input: { authority: WeeklyOperatorAuthority; agentId: string; assignment: AssignmentRow; source: AuthenticatedSource; targetBindingHash: string; actorUserId: string; idempotencyKey: string; requestHash: string }): string {
    return hashCanonicalPayload({ protocolVersion: OPERATOR_SCHEDULE_PROTOCOL_VERSION, authority: input.authority, agentId: input.agentId, assignmentRevisionId: input.assignment.id, assignmentStateId: input.assignment.state_id, source: { eventRecordId: input.source.row.id, eventId: input.source.event.eventId, sequence: Number(input.source.event.sequence), stateDigest: input.source.event.payload.stateDigest, asOf: input.source.event.payload.asOf, occurredAt: input.source.event.occurredAt, receivedAt: input.source.row.received_at.toISOString() }, targetBindingHash: input.targetBindingHash, actorUserId: input.actorUserId, idempotencyKey: input.idempotencyKey, requestHash: input.requestHash });
  }

  private occurrenceContent(row: OccurrenceRow) {
    return { protocolVersion: OPERATOR_SCHEDULE_PROTOCOL_VERSION, occurrenceKey: row.occurrence_key, authorityId: row.authority_id, scheduleId: row.schedule_id, agentId: row.agent_id, settingsRevision: Number(row.settings_revision), assignmentRevisionRef: row.assignment_revision_ref, targetBindingHash: row.target_binding_hash, weekStartLocalDate: this.dateOnly(row.week_start_local_date), localDate: this.dateOnly(row.local_date), localTime: row.local_time, timezone: row.timezone, kind: row.kind, fridaySequence: row.friday_sequence, scheduledAt: row.scheduled_at.toISOString(), deadlineAt: row.deadline_at?.toISOString() ?? null, retryPolicy: row.retry_policy, createdAt: row.created_at.toISOString() };
  }

  private dateOnly(value: Date | string): string {
    return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : new Date(value).toISOString().slice(0, 10);
  }

  private derivedIdempotencyKey(parent: string, suffix: string): string {
    return `operator-derived:${hashCanonicalPayload({ parent, suffix }).slice("sha256:".length)}`;
  }

  private async lockOrganization(database: Pick<DatabaseClient, "query">, organizationId: string): Promise<void> {
    const rows = await database.query<{ id: string }>("SELECT id FROM organizations WHERE id = $1 FOR UPDATE", [organizationId]);
    if (!rows[0]) throw new RuntimeServiceError("FORBIDDEN", "Forbidden");
  }

  private assertActorIdempotency(storedActor: string, actor: string, storedRequestHash: string, requestHash: string, label: string): void {
    if (storedActor !== actor) throw new RuntimeServiceError("FORBIDDEN", `${label} idempotency key belongs to a different operator`);
    if (storedRequestHash !== requestHash) throw new RuntimeServiceError("CONFLICT", `${label} idempotency replay conflicts with stored evidence`);
  }

  private requireClock(): Date {
    const value = this.clock();
    if (!Number.isFinite(value.getTime())) throw new Error("Operator schedule repository clock returned an invalid timestamp");
    return value;
  }

  private requireScheduleAccess(user: AuthenticatedUser): void {
    if (user.role === "client") {
      try {
        requireDeploymentCapability("transport.local");
        return;
      } catch {
        // Weekly schedule authority is never available from the central control plane.
      }
    }
    throw new RuntimeServiceError("FORBIDDEN", "Forbidden");
  }
}

export function getOperatorScheduleRepository(): OperatorScheduleRepository {
  return new OperatorScheduleRepository();
}
