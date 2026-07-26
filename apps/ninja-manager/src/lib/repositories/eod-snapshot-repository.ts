import "server-only";

import { randomUUID } from "node:crypto";

import { z } from "zod";

import type { DatabaseClient, DatabaseTransaction } from "@/lib/db/client";
import { getDatabase } from "@/lib/db/client";
import { userAuditSubject } from "@/lib/domain/audit-evidence";
import {
  EOD_DECLARED_AGE_TOLERANCE_MS,
  EOD_DEFAULT_TIME_ZONE,
  EOD_MAX_SOURCE_AGE_MS,
  EOD_SNAPSHOT_VERSION,
  eodCaptureInputSchema,
  eodCaptureRequestHash,
  eodCollectionScopesSchema,
  eodMoneyValueSchema,
  eodSnapshotContentHash,
  eodSnapshotContentSchema,
  eodSnapshotListInputSchema,
  eodSnapshotSchema,
  eodSnapshotSummarySchema,
  localDateInTimeZone,
  type EodMoneyValue,
  type EodSnapshot,
  type EodSnapshotContent,
  type EodSnapshotSummary,
} from "@/lib/domain/eod-snapshot-contracts";
import {
  parseRuntimeObservationV2Event,
  type RuntimeObservationV2Event,
} from "@/lib/domain/runtime-contracts";
import type {
  RuntimeMoneyObservationV2,
  RuntimeObservationV2,
} from "@/lib/domain/runtime-observation-v2";
import { RuntimeServiceError } from "@/lib/domain/runtime-errors";
import type { AuthenticatedUser } from "@/lib/domain/types";
import { requireDeploymentCapability } from "@/lib/deployment/server";
import { writeAuditEvent } from "@/lib/repositories/audit-writer";

const snapshotIdSchema = z.uuid();
const scopeOrder = [
  "process",
  "addon",
  "connections",
  "accounts",
  "strategies",
  "positions",
  "orders",
  "executions",
  "pnl",
] as const;
const insertBatchSize = 250;

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

interface SnapshotRow {
  id: string;
  agent_id: string;
  source_event_id: string;
  source_sequence: number | string;
  source_state_digest: string;
  source_as_of: Date;
  source_occurred_at: Date;
  source_received_at: Date;
  captured_at: Date;
  intended_local_date: Date | string;
  time_zone: string;
  completeness_overall: "complete" | "partial" | "unavailable";
  idempotency_key: string;
  request_hash: string;
  content_hash: string;
  created_by: string;
}

interface ScopeRow {
  scope: (typeof scopeOrder)[number];
  status: "complete" | "partial" | "unavailable";
  item_count: number;
  errors: unknown;
}

interface AccountRow {
  id: string;
  account_ordinal: number;
  masked_identifier: string;
  display_label: string;
  classification_environment: "simulation" | "live" | "unknown";
  classification_authority: "authoritative" | "unavailable";
  classification_source: "ninjatrader_simulation_account" | "ninjatrader_live_account" | null;
  classification_reason: "ADDON_OFFLINE" | "CLASSIFICATION_UNSUPPORTED" | "CLASSIFICATION_CONFLICT" | "CLASSIFICATION_UNAVAILABLE" | null;
  pnl_observed: boolean;
  pnl_session_date: Date | string | null;
}

interface PnlRow {
  snapshot_account_id: string;
  metric: "daily_realized" | "daily_unrealized" | "daily_total" | "native_lifetime" | "manager_observed_cumulative";
  availability: "available" | "unavailable";
  currency: "USD";
  amount_minor: number | string | null;
  source: EodMoneyValue["source"];
  reason: EodMoneyValue["reason"];
  observed_since: Date | null;
}

interface StrategyRow {
  snapshot_account_id: string;
  strategy_ordinal: number;
  display_label: string;
  strategy_type: string;
  instrument: string;
  enabled: boolean;
  runtime_state: "disabled" | "enabling" | "waiting_sync" | "running" | "disabling" | "error" | "unknown";
  synchronization_state: "synchronized" | "not_synchronized" | "pending" | "not_applicable" | "unknown";
}

export interface CapturedEodSnapshot {
  snapshot: EodSnapshot;
  duplicate: boolean;
}

export class EodSnapshotRepository {
  constructor(
    private readonly database: DatabaseClient = getDatabase(),
    private readonly clock: Clock = () => new Date(),
  ) {}

  async captureManualSnapshot(user: AuthenticatedUser, input: unknown): Promise<CapturedEodSnapshot> {
    this.requireEodAccess(user);
    const value = eodCaptureInputSchema.parse(input);
    const capturedAt = this.clock();
    if (!Number.isFinite(capturedAt.getTime())) throw new Error("Capture clock returned an invalid timestamp");
    const timeZone = EOD_DEFAULT_TIME_ZONE;
    const intendedLocalDate = this.resolveLocalDate(capturedAt, timeZone);
    const requestHash = eodCaptureRequestHash({
      agentId: value.agentId,
      sourceEventId: value.sourceEventId,
      intendedLocalDate,
      timeZone,
    });

    return this.database.transaction(async (transaction) => {
      await transaction.query("SELECT id FROM organizations WHERE id = $1 FOR UPDATE", [user.organizationId]);
      const existingRows = await transaction.query<SnapshotRow>(
        [
          "SELECT id, agent_id, source_event_id, source_sequence, source_state_digest, source_as_of, source_occurred_at,",
          "source_received_at, captured_at, intended_local_date, time_zone, completeness_overall,",
          "idempotency_key, request_hash, content_hash, created_by",
          "FROM eod_snapshots WHERE organization_id = $1 AND idempotency_key = $2",
        ].join(" "),
        [user.organizationId, value.idempotencyKey],
      );
      const existing = existingRows[0];
      if (existing) {
        if (existing.created_by !== user.id) {
          throw new RuntimeServiceError("FORBIDDEN", "EOD idempotency key belongs to a different operator");
        }
        if (existing.request_hash !== requestHash) {
          throw new RuntimeServiceError("CONFLICT", "EOD idempotency replay conflicts with the stored capture request");
        }
        return {
          snapshot: await this.readSnapshot(transaction, user.organizationId, existing.id),
          duplicate: true,
        };
      }

      await this.requireAgent(transaction, user, value.agentId);
      const sourceRows = await transaction.query<SourceEventRow>(
        [
          "SELECT event.id, event.protocol_version, event.event_id, event.agent_id, event.sequence, event.event_type,",
          "event.correlation_id, event.causation_id, event.occurred_at, event.received_at, event.payload_hash,",
          "event.envelope_hash, event.credential_id, event.legacy_unverified, event.payload,",
          "credential.agent_id AS credential_agent_id, credential.organization_id AS credential_organization_id",
          "FROM agent_events event",
          "LEFT JOIN agent_credentials credential ON credential.id = event.credential_id",
          "AND credential.organization_id = event.organization_id AND credential.agent_id = event.agent_id",
          "WHERE event.organization_id = $1 AND event.agent_id = $2 AND event.event_id = $3",
          "LIMIT 1",
        ].join(" "),
        [user.organizationId, value.agentId, value.sourceEventId],
      );
      const source = sourceRows[0];
      if (!source) {
        throw new RuntimeServiceError("CONFLICT", "Authorized runtime observation source was not found for this agent");
      }
      const event = this.parseAuthenticatedSource(source, user.organizationId);
      this.assertCaptureableObservation(event.payload, event.occurredAt, source.received_at, capturedAt);
      this.assertPnlLocalDate(event.payload, intendedLocalDate);

      const snapshotId = randomUUID();
      const snapshotContent = this.buildSnapshotContent({
        snapshotId,
        agentId: value.agentId,
        event,
        sourceReceivedAt: source.received_at,
        capturedAt,
        intendedLocalDate,
      });
      const contentHash = eodSnapshotContentHash(snapshotContent);
      await transaction.query(
        [
          "INSERT INTO eod_snapshots",
          "(id, organization_id, agent_id, source_agent_event_record_id, source_event_id, source_sequence,",
          "source_state_digest, source_as_of, source_occurred_at, source_received_at, captured_at, intended_local_date, time_zone,",
          "completeness_overall, idempotency_key, request_hash, content_hash, created_by)",
          "VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)",
        ].join(" "),
        [
          snapshotId,
          user.organizationId,
          value.agentId,
          source.id,
          event.eventId,
          event.sequence,
          event.payload.stateDigest,
          event.payload.asOf,
          event.occurredAt,
          source.received_at,
          capturedAt,
          intendedLocalDate,
          timeZone,
          event.payload.state.collection.overall,
          value.idempotencyKey,
          requestHash,
          contentHash,
          user.id,
        ],
      );

      const scopeRows = scopeOrder.map((scope) => {
        const evidence = event.payload.state.collection.scopes[scope];
        return [
          randomUUID(),
          user.organizationId,
          value.agentId,
          snapshotId,
          scope,
          evidence.status,
          evidence.itemCount,
          JSON.stringify(evidence.errors),
        ];
      });
      await this.insertRows(
        transaction,
        "INSERT INTO eod_snapshot_scopes (id, organization_id, agent_id, snapshot_id, scope, status, item_count, errors)",
        scopeRows,
      );

      const pnlByAccount = new Map(event.payload.state.pnl.map((pnl) => [pnl.accountRef, pnl]));
      const accountIdByRef = new Map<string, string>();
      const accountRows = event.payload.state.accounts.map((account, index) => {
        const accountSnapshotId = randomUUID();
        accountIdByRef.set(account.accountRef, accountSnapshotId);
        const pnl = pnlByAccount.get(account.accountRef);
        return [
          accountSnapshotId,
          user.organizationId,
          value.agentId,
          snapshotId,
          index + 1,
          account.maskedIdentifier,
          account.displayLabel,
          account.classification.environment,
          account.classification.authority,
          account.classification.source,
          account.classification.environment === "unknown" ? account.classification.reasonCode : null,
          pnl !== undefined,
          pnl?.sessionDate ?? null,
        ];
      });
      await this.insertRows(
        transaction,
        [
          "INSERT INTO eod_snapshot_accounts",
          "(id, organization_id, agent_id, snapshot_id, account_ordinal, masked_identifier, display_label,",
          "classification_environment, classification_authority, classification_source, classification_reason,",
          "pnl_observed, pnl_session_date)",
        ].join(" "),
        accountRows,
      );

      const pnlRows: unknown[][] = [];
      for (const pnl of event.payload.state.pnl) {
        const accountSnapshotId = accountIdByRef.get(pnl.accountRef);
        if (!accountSnapshotId) throw new Error("Validated P&L source account was not found");
        const metrics = [
          ["daily_realized", pnl.daily.realized],
          ["daily_unrealized", pnl.daily.unrealized],
          ["daily_total", pnl.daily.total],
          ["native_lifetime", pnl.nativeLifetime],
          ["manager_observed_cumulative", pnl.managerObservedCumulative.value],
        ] as const;
        for (const [metric, money] of metrics) {
          const value = this.toEodMoney(money);
          pnlRows.push([
            randomUUID(),
            user.organizationId,
            snapshotId,
            accountSnapshotId,
            metric,
            value.availability,
            value.currency,
            value.amountMinor,
            value.source,
            value.reason,
            metric === "manager_observed_cumulative" ? pnl.managerObservedCumulative.observedSince : null,
          ]);
        }
      }
      await this.insertRows(
        transaction,
        [
          "INSERT INTO eod_snapshot_pnl_values",
          "(id, organization_id, snapshot_id, snapshot_account_id, metric, availability, currency, amount_minor, source, reason, observed_since)",
        ].join(" "),
        pnlRows,
      );

      const strategyOrdinalByAccount = new Map<string, number>();
      const strategyRows = event.payload.state.strategies.map((strategy) => {
        const accountSnapshotId = accountIdByRef.get(strategy.accountRef);
        if (!accountSnapshotId) throw new Error("Validated strategy source account was not found");
        const ordinal = (strategyOrdinalByAccount.get(accountSnapshotId) ?? 0) + 1;
        strategyOrdinalByAccount.set(accountSnapshotId, ordinal);
        return [
          randomUUID(),
          user.organizationId,
          snapshotId,
          accountSnapshotId,
          ordinal,
          strategy.displayLabel,
          strategy.strategyTypeCode,
          strategy.instrumentCode,
          strategy.enabled,
          strategy.runtimeState,
          strategy.synchronizationState,
        ];
      });
      await this.insertRows(
        transaction,
        [
          "INSERT INTO eod_snapshot_strategies",
          "(id, organization_id, snapshot_id, snapshot_account_id, strategy_ordinal, display_label, strategy_type,",
          "instrument, enabled, runtime_state, synchronization_state)",
        ].join(" "),
        strategyRows,
      );

      await writeAuditEvent(transaction, {
        organizationId: user.organizationId,
        actorUserId: user.id,
        actorSubjectId: userAuditSubject(user.id),
        action: "eod_snapshot.captured",
        entityType: "eod_snapshot",
        entityId: snapshotId,
        metadata: {
          agentId: value.agentId,
          sourceEventId: event.eventId,
          sourceSequence: event.sequence,
          sourceStateDigest: event.payload.stateDigest,
          sourceAsOf: event.payload.asOf,
          capturedAt: capturedAt.toISOString(),
          intendedLocalDate,
          timeZone,
          completeness: event.payload.state.collection.overall,
          accountCount: event.payload.state.accounts.length,
          strategyCount: event.payload.state.strategies.length,
          pnlCount: event.payload.state.pnl.length,
          requestHash,
          contentHash,
        },
        occurredAt: capturedAt,
      });

      return {
        snapshot: await this.readSnapshot(transaction, user.organizationId, snapshotId),
        duplicate: false,
      };
    });
  }

  async getSnapshot(user: AuthenticatedUser, snapshotId: string): Promise<EodSnapshot | null> {
    this.requireEodAccess(user);
    const id = snapshotIdSchema.parse(snapshotId);
    const rows = await this.database.query<{ id: string }>(
      "SELECT id FROM eod_snapshots WHERE organization_id = $1 AND id = $2",
      [user.organizationId, id],
    );
    if (!rows[0]) return null;
    return this.readSnapshot(this.database, user.organizationId, id);
  }

  async listSnapshots(user: AuthenticatedUser, input: unknown = {}): Promise<EodSnapshotSummary[]> {
    this.requireEodAccess(user);
    const value = eodSnapshotListInputSchema.parse(input);
    const limit = value.limit ?? 50;
    const parameters: unknown[] = [user.organizationId];
    let agentFilter = "";
    if (value.agentId) {
      parameters.push(value.agentId);
      agentFilter = ` AND snapshot.agent_id = $${parameters.length}`;
    }
    parameters.push(limit);
    const rows = await this.database.query<{ id: string }>(
      [
        "SELECT snapshot.id FROM eod_snapshots snapshot",
        `WHERE snapshot.organization_id = $1${agentFilter}`,
        "ORDER BY snapshot.intended_local_date DESC, snapshot.captured_at DESC, snapshot.id DESC",
        `LIMIT $${parameters.length}`,
      ].join(" "),
      parameters,
    );
    const summaries: EodSnapshotSummary[] = [];
    for (const row of rows) {
      const snapshot = await this.readSnapshot(this.database, user.organizationId, row.id);
      summaries.push(eodSnapshotSummarySchema.parse({
        version: snapshot.version,
        snapshotId: snapshot.snapshotId,
        agentId: snapshot.agentId,
        source: snapshot.source,
        capturedAt: snapshot.capturedAt,
        intendedLocalDate: snapshot.intendedLocalDate,
        timeZone: snapshot.timeZone,
        contentHash: snapshot.contentHash,
        completeness: snapshot.completeness,
        accountCount: snapshot.accounts.length,
        strategyCount: snapshot.accounts.reduce((total, account) => total + account.strategies.length, 0),
      }));
    }
    return summaries;
  }

  private buildSnapshotContent(input: {
    snapshotId: string;
    agentId: string;
    event: RuntimeObservationV2Event;
    sourceReceivedAt: Date;
    capturedAt: Date;
    intendedLocalDate: string;
  }): EodSnapshotContent {
    const pnlByAccount = new Map(input.event.payload.state.pnl.map((pnl) => [pnl.accountRef, pnl]));
    const strategiesByAccount = new Map<string, RuntimeObservationV2["state"]["strategies"]>();
    for (const strategy of input.event.payload.state.strategies) {
      const rows = strategiesByAccount.get(strategy.accountRef) ?? [];
      rows.push(strategy);
      strategiesByAccount.set(strategy.accountRef, rows);
    }
    return eodSnapshotContentSchema.parse({
      version: EOD_SNAPSHOT_VERSION,
      snapshotId: input.snapshotId,
      agentId: input.agentId,
      source: {
        eventId: input.event.eventId,
        sequence: input.event.sequence,
        stateDigest: input.event.payload.stateDigest,
        asOf: input.event.payload.asOf,
        occurredAt: input.event.occurredAt,
        receivedAt: input.sourceReceivedAt.toISOString(),
      },
      capturedAt: input.capturedAt.toISOString(),
      intendedLocalDate: input.intendedLocalDate,
      timeZone: EOD_DEFAULT_TIME_ZONE,
      completeness: {
        overall: input.event.payload.state.collection.overall,
        scopes: input.event.payload.state.collection.scopes,
      },
      accounts: input.event.payload.state.accounts.map((account, accountIndex) => {
        const pnl = pnlByAccount.get(account.accountRef);
        return {
          ordinal: accountIndex + 1,
          maskedIdentifier: account.maskedIdentifier,
          displayLabel: account.displayLabel,
          classification: {
            environment: account.classification.environment,
            authority: account.classification.authority,
            source: account.classification.source,
            reason: account.classification.environment === "unknown"
              ? account.classification.reasonCode
              : null,
          },
          pnl: pnl ? {
            sessionDate: pnl.sessionDate,
            daily: {
              realized: this.toEodMoney(pnl.daily.realized),
              unrealized: this.toEodMoney(pnl.daily.unrealized),
              total: this.toEodMoney(pnl.daily.total),
            },
            nativeLifetime: this.toEodMoney(pnl.nativeLifetime),
            managerObservedCumulative: {
              value: this.toEodMoney(pnl.managerObservedCumulative.value),
              observedSince: pnl.managerObservedCumulative.observedSince,
            },
          } : null,
          strategies: (strategiesByAccount.get(account.accountRef) ?? []).map((strategy, strategyIndex) => ({
            ordinal: strategyIndex + 1,
            displayLabel: strategy.displayLabel,
            strategyType: strategy.strategyTypeCode,
            instrument: strategy.instrumentCode,
            enabled: strategy.enabled,
            runtimeState: strategy.runtimeState,
            synchronizationState: strategy.synchronizationState,
          })),
        };
      }),
    });
  }

  private parseAuthenticatedSource(source: SourceEventRow, organizationId: string) {
    if (
      source.legacy_unverified
      || source.credential_id === null
      || source.envelope_hash === null
      || source.credential_agent_id !== source.agent_id
      || source.credential_organization_id !== organizationId
    ) {
      throw new RuntimeServiceError("CONFLICT", "Runtime observation source is not authenticated evidence");
    }
    try {
      return parseRuntimeObservationV2Event({
        protocolVersion: source.protocol_version,
        eventId: source.event_id,
        agentId: source.agent_id,
        sequence: Number(source.sequence),
        eventType: source.event_type,
        correlationId: source.correlation_id,
        causationId: source.causation_id,
        occurredAt: new Date(source.occurred_at).toISOString(),
        payloadHash: source.payload_hash,
        envelopeHash: source.envelope_hash,
        payload: source.payload,
      });
    } catch {
      throw new RuntimeServiceError("CONFLICT", "Runtime observation source failed canonical integrity validation");
    }
  }

  private assertCaptureableObservation(
    observation: RuntimeObservationV2,
    occurredAt: string,
    receivedAt: Date,
    capturedAt: Date,
  ): void {
    const capturedMs = capturedAt.getTime();
    const asOfMs = Date.parse(observation.asOf);
    const occurredMs = Date.parse(occurredAt);
    const receivedMs = new Date(receivedAt).getTime();
    if (!(asOfMs <= occurredMs && occurredMs <= receivedMs && receivedMs <= capturedMs)) {
      throw new RuntimeServiceError("CONFLICT", "Runtime evidence chronology is invalid for EOD capture");
    }
    const actualCaptureAgeMs = capturedMs - asOfMs;
    const actualDeclaredAgeBasisMs = occurredMs - asOfMs;
    if (
      observation.freshness.status !== "fresh"
      || observation.freshness.ageMs === null
      || actualCaptureAgeMs > EOD_MAX_SOURCE_AGE_MS
      || Math.abs(observation.freshness.ageMs - actualDeclaredAgeBasisMs) > EOD_DECLARED_AGE_TOLERANCE_MS
    ) {
      throw new RuntimeServiceError("CONFLICT", "Runtime evidence exceeds the server-owned EOD freshness policy");
    }
  }

  private assertPnlLocalDate(observation: RuntimeObservationV2, intendedLocalDate: string): void {
    for (const pnl of observation.state.pnl) {
      const values = [
        pnl.daily.realized,
        pnl.daily.unrealized,
        pnl.daily.total,
        pnl.nativeLifetime,
        pnl.managerObservedCumulative.value,
      ];
      if (values.some((value) => value.availability === "available") && pnl.sessionDate !== intendedLocalDate) {
        throw new RuntimeServiceError("CONFLICT", "Available P&L session date does not match the intended EOD local date");
      }
    }
  }

  private async readSnapshot(
    database: Pick<DatabaseClient, "query">,
    organizationId: string,
    snapshotId: string,
  ): Promise<EodSnapshot> {
    const headers = await database.query<SnapshotRow>(
      [
        "SELECT id, agent_id, source_event_id, source_sequence, source_state_digest, source_as_of, source_occurred_at,",
        "source_received_at, captured_at, intended_local_date, time_zone, completeness_overall,",
        "idempotency_key, request_hash, content_hash, created_by",
        "FROM eod_snapshots WHERE organization_id = $1 AND id = $2",
      ].join(" "),
      [organizationId, snapshotId],
    );
    const header = headers[0];
    if (!header) throw new Error("Stored EOD snapshot disappeared");
    const scopes = await this.readScopes(database, organizationId, snapshotId);
    const accounts = await database.query<AccountRow>(
      [
        "SELECT id, account_ordinal, masked_identifier, display_label, classification_environment,",
        "classification_authority, classification_source, classification_reason, pnl_observed, pnl_session_date",
        "FROM eod_snapshot_accounts WHERE organization_id = $1 AND snapshot_id = $2",
        "ORDER BY account_ordinal",
      ].join(" "),
      [organizationId, snapshotId],
    );
    const pnlRows = await database.query<PnlRow>(
      [
        "SELECT value.snapshot_account_id, value.metric, value.availability, value.currency, value.amount_minor,",
        "value.source, value.reason, value.observed_since FROM eod_snapshot_pnl_values value",
        "JOIN eod_snapshot_accounts account ON account.id = value.snapshot_account_id",
        "AND account.organization_id = value.organization_id AND account.snapshot_id = value.snapshot_id",
        "WHERE value.organization_id = $1 AND value.snapshot_id = $2",
        "ORDER BY account.account_ordinal, value.metric",
      ].join(" "),
      [organizationId, snapshotId],
    );
    const strategyRows = await database.query<StrategyRow>(
      [
        "SELECT strategy.snapshot_account_id, strategy.strategy_ordinal, strategy.display_label, strategy.strategy_type,",
        "strategy.instrument, strategy.enabled, strategy.runtime_state, strategy.synchronization_state",
        "FROM eod_snapshot_strategies strategy",
        "JOIN eod_snapshot_accounts account ON account.id = strategy.snapshot_account_id",
        "AND account.organization_id = strategy.organization_id AND account.snapshot_id = strategy.snapshot_id",
        "WHERE strategy.organization_id = $1 AND strategy.snapshot_id = $2",
        "ORDER BY account.account_ordinal, strategy.strategy_ordinal",
      ].join(" "),
      [organizationId, snapshotId],
    );

    const pnlByAccount = new Map<string, Map<PnlRow["metric"], EodMoneyValue>>();
    const managerObservedSinceByAccount = new Map<string, string | null>();
    for (const row of pnlRows) {
      const byMetric = pnlByAccount.get(row.snapshot_account_id) ?? new Map();
      byMetric.set(row.metric, eodMoneyValueSchema.parse({
        availability: row.availability,
        currency: row.currency,
        amountMinor: row.amount_minor === null ? null : Number(row.amount_minor),
        source: row.source,
        reason: row.reason,
      }));
      pnlByAccount.set(row.snapshot_account_id, byMetric);
      if (row.metric === "manager_observed_cumulative") {
        managerObservedSinceByAccount.set(
          row.snapshot_account_id,
          row.observed_since ? new Date(row.observed_since).toISOString() : null,
        );
      }
    }
    const strategiesByAccount = new Map<string, StrategyRow[]>();
    for (const row of strategyRows) {
      const rows = strategiesByAccount.get(row.snapshot_account_id) ?? [];
      rows.push(row);
      strategiesByAccount.set(row.snapshot_account_id, rows);
    }

    return eodSnapshotSchema.parse({
      version: EOD_SNAPSHOT_VERSION,
      snapshotId: header.id,
      agentId: header.agent_id,
      source: {
        eventId: header.source_event_id,
        sequence: Number(header.source_sequence),
        stateDigest: header.source_state_digest,
        asOf: new Date(header.source_as_of).toISOString(),
        occurredAt: new Date(header.source_occurred_at).toISOString(),
        receivedAt: new Date(header.source_received_at).toISOString(),
      },
      capturedAt: new Date(header.captured_at).toISOString(),
      intendedLocalDate: this.toDateOnly(header.intended_local_date),
      timeZone: header.time_zone,
      contentHash: header.content_hash,
      completeness: { overall: header.completeness_overall, scopes },
      accounts: accounts.map((account) => {
        const metrics = pnlByAccount.get(account.id);
        if (account.pnl_observed && (!metrics || metrics.size !== 5)) {
          throw new Error("Stored EOD P&L evidence is incomplete");
        }
        if (!account.pnl_observed && metrics) throw new Error("Unobserved EOD P&L has stored values");
        return {
          ordinal: account.account_ordinal,
          maskedIdentifier: account.masked_identifier,
          displayLabel: account.display_label,
          classification: {
            environment: account.classification_environment,
            authority: account.classification_authority,
            source: account.classification_source,
            reason: account.classification_reason,
          },
          pnl: account.pnl_observed ? {
            sessionDate: this.toDateOnly(account.pnl_session_date as Date | string),
            daily: {
              realized: metrics?.get("daily_realized"),
              unrealized: metrics?.get("daily_unrealized"),
              total: metrics?.get("daily_total"),
            },
            nativeLifetime: metrics?.get("native_lifetime"),
            managerObservedCumulative: {
              value: metrics?.get("manager_observed_cumulative"),
              observedSince: managerObservedSinceByAccount.get(account.id) ?? null,
            },
          } : null,
          strategies: (strategiesByAccount.get(account.id) ?? []).map((strategy) => ({
            ordinal: strategy.strategy_ordinal,
            displayLabel: strategy.display_label,
            strategyType: strategy.strategy_type,
            instrument: strategy.instrument,
            enabled: strategy.enabled,
            runtimeState: strategy.runtime_state,
            synchronizationState: strategy.synchronization_state,
          })),
        };
      }),
    });
  }

  private async readScopes(
    database: Pick<DatabaseClient, "query">,
    organizationId: string,
    snapshotId: string,
  ) {
    const rows = await database.query<ScopeRow>(
      [
        "SELECT scope, status, item_count, errors FROM eod_snapshot_scopes",
        "WHERE organization_id = $1 AND snapshot_id = $2 ORDER BY scope",
      ].join(" "),
      [organizationId, snapshotId],
    );
    if (rows.length !== scopeOrder.length) throw new Error("Stored EOD completeness evidence is incomplete");
    const byScope = new Map(rows.map((row) => [row.scope, row]));
    return eodCollectionScopesSchema.parse(Object.fromEntries(scopeOrder.map((scope) => {
      const row = byScope.get(scope);
      if (!row) throw new Error("Stored EOD scope evidence is missing");
      return [scope, {
        status: row.status,
        itemCount: Number(row.item_count),
        errors: this.toJson(row.errors),
      }];
    })));
  }

  private toEodMoney(value: RuntimeMoneyObservationV2): EodMoneyValue {
    return eodMoneyValueSchema.parse(value.availability === "available" ? {
      availability: value.availability,
      currency: value.currency,
      amountMinor: value.amountMinor,
      source: value.source,
      reason: null,
    } : {
      availability: value.availability,
      currency: value.currency,
      amountMinor: null,
      source: null,
      reason: value.reasonCode,
    });
  }

  private async requireAgent(
    transaction: Pick<DatabaseTransaction, "query">,
    user: AuthenticatedUser,
    agentId: string,
  ): Promise<void> {
    const rows = user.role === "client"
      ? await transaction.query<{ id: string }>(
        [
          "SELECT agent.id FROM agent_installations agent",
          "JOIN environments environment ON environment.id = agent.environment_id AND environment.organization_id = agent.organization_id",
          "JOIN clients client ON client.id = environment.client_id AND client.organization_id = agent.organization_id",
          "WHERE agent.organization_id = $1 AND agent.id = $2 AND client.user_id = $3 FOR UPDATE OF agent",
        ].join(" "),
        [user.organizationId, agentId, user.id],
      )
      : await transaction.query<{ id: string }>(
        "SELECT id FROM agent_installations WHERE organization_id = $1 AND id = $2 FOR UPDATE",
        [user.organizationId, agentId],
      );
    if (!rows[0]) throw new RuntimeServiceError("AGENT_NOT_FOUND", "Authorized agent installation not found");
  }

  private requireEodAccess(user: AuthenticatedUser): void {
    if (user.role === "staff" || user.role === "client") {
      try {
        requireDeploymentCapability("transport.local");
        return;
      } catch {
        // Central EOD evidence remains private until a client-issued, scoped
        // support OTP grant is enforced at this repository boundary.
      }
    }
    throw new RuntimeServiceError("FORBIDDEN", "Forbidden");
  }

  private resolveLocalDate(at: Date, timeZone: string): string {
    try {
      return localDateInTimeZone(at, timeZone);
    } catch {
      throw new RuntimeServiceError("CONFLICT", "EOD time zone is not a valid IANA time zone");
    }
  }

  private toDateOnly(value: Date | string): string {
    if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
    return new Date(value).toISOString().slice(0, 10);
  }

  private toJson(value: unknown): unknown {
    return typeof value === "string" ? JSON.parse(value) as unknown : value;
  }

  private async insertRows(
    transaction: DatabaseTransaction,
    prefix: string,
    rows: unknown[][],
  ): Promise<void> {
    for (let offset = 0; offset < rows.length; offset += insertBatchSize) {
      const batch = rows.slice(offset, offset + insertBatchSize);
      if (!batch.length) continue;
      const columnCount = batch[0].length;
      if (!batch.every((row) => row.length === columnCount)) throw new Error("EOD bulk insert row shape mismatch");
      let parameter = 1;
      const placeholders = batch.map(() => {
        const values = Array.from({ length: columnCount }, () => `$${parameter++}`);
        return `(${values.join(", ")})`;
      });
      await transaction.query(`${prefix} VALUES ${placeholders.join(", ")}`, batch.flat());
    }
  }
}

export function getEodSnapshotRepository(): EodSnapshotRepository {
  return new EodSnapshotRepository();
}
