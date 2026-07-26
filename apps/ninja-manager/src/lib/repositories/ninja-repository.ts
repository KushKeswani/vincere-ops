import { randomUUID } from "node:crypto";

import bcrypt from "bcryptjs";

import type { DatabaseClient, DatabaseTransaction } from "@/lib/db/client";
import { getDatabase } from "@/lib/db/client";
import { userAuditSubject } from "@/lib/domain/audit-evidence";
import { hashCanonicalPayload } from "@/lib/domain/runtime-contracts";
import type { AuthenticatedUser, ConnectorHealthResult, StrategyQuestionnaire } from "@/lib/domain/types";
import { recommendStrategy } from "@/lib/domain/strategy-engine";
import { writeAuditEvent } from "@/lib/repositories/audit-writer";

type JsonValue = Record<string, unknown> | unknown[];
const REQUEST_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class IdempotencyConflictError extends Error {
  constructor(message = "This request key was already used for a different operation") {
    super(message);
    this.name = "IdempotencyConflictError";
  }
}

export class EmailIdentityConflictError extends Error {
  constructor() {
    super("This email is already assigned to a Ninja Manager identity");
    this.name = "EmailIdentityConflictError";
  }
}

export interface ClientRow {
  id: string;
  display_name: string;
  email: string;
  phone: string | null;
  timezone: string;
  onboarding_status: "invited" | "in_progress" | "complete";
  user_status: "active" | "disabled";
  created_at: Date;
}

export interface AccountRow {
  id: string;
  provider: string;
  label: string;
  account_identifier_masked: string;
  account_size: number;
  rule_profile: string;
  status: string;
}

export interface EnvironmentRow {
  id: string;
  vps_provider: string;
  vps_region: string;
  ninja_version: string;
  connection_status: string;
  last_check_at: Date | null;
}

export interface ConfigurationRow {
  id: string;
  version: number;
  status: string;
  strategy_name: string;
  strategy_description: string;
  questionnaire: JsonValue;
  configuration: JsonValue;
  validation: JsonValue;
  created_at: Date;
  approved_at: Date | null;
  deployed_at: Date | null;
}

export interface IncidentRow {
  id: string;
  client_id: string;
  client_name: string;
  severity: string;
  status: string;
  title: string;
  description: string;
  resolution_steps: string[];
  current_step: number;
  created_at: Date;
}

export interface ApprovalRow {
  id: string;
  configuration_id: string;
  client_name: string;
  strategy_name: string;
  version: number;
  configuration: JsonValue;
  validation: JsonValue;
  status: string;
  notes: string | null;
  created_at: Date;
}

export interface AuditRow {
  id: string;
  action: string;
  entity_type: string;
  entity_id: string;
  metadata: JsonValue;
  actor_name: string | null;
  actor_subject_id: string;
  origin_installation_id: string | null;
  event_version: number;
  evidence_hash: string | null;
  legacy_unverified: boolean;
  created_at: Date;
}

export class NinjaRepository {
  constructor(private readonly database: DatabaseClient = getDatabase()) {}

  async findUserByEmail(email: string): Promise<(AuthenticatedUser & { passwordHash: string; status: string }) | null> {
    const rows = await this.database.query<{
      id: string;
      organization_id: string;
      email: string;
      name: string;
      role: "staff" | "client";
      password_hash: string;
      status: string;
    }>("SELECT id, organization_id, email, name, role, password_hash, status FROM users WHERE lower(email) = lower($1) ORDER BY id LIMIT 2", [email]);
    // Migration 0015 makes this impossible in a current database. Keep the read
    // boundary fail-closed during rolling upgrades or manual schema drift.
    if (rows.length !== 1) return null;
    const row = rows[0];
    return row
      ? { id: row.id, organizationId: row.organization_id, email: row.email, name: row.name, role: row.role, passwordHash: row.password_hash, status: row.status }
      : null;
  }

  async findLocalOperatorUser(): Promise<AuthenticatedUser | null> {
    const rows = await this.database.query<{
      id: string;
      organization_id: string;
      email: string;
      name: string;
      role: "client";
    }>(`
      SELECT u.id, u.organization_id, u.email, u.name, u.role
      FROM users u
      JOIN clients c ON c.user_id = u.id AND c.organization_id = u.organization_id
      WHERE u.role = 'client' AND u.status = 'active'
      ORDER BY CASE WHEN lower(u.email) = lower($1) THEN 0 ELSE 1 END, u.email
      LIMIT 2
    `, [process.env.DEMO_CLIENT_EMAIL ?? "client@vincere.local"]);
    // LOCAL_ONLY has no tenant selector. More than one active client identity is
    // therefore ambiguous and must fail closed rather than choosing a tenant.
    if (rows.length !== 1) return null;
    const row = rows[0];
    return row
      ? { id: row.id, organizationId: row.organization_id, email: row.email, name: row.name, role: row.role }
      : null;
  }

  async findUserBySessionHash(tokenHash: string): Promise<AuthenticatedUser | null> {
    const [row] = await this.database.query<{
      id: string;
      organization_id: string;
      email: string;
      name: string;
      role: "staff" | "client";
    }>(`
      SELECT u.id, u.organization_id, u.email, u.name, u.role
      FROM sessions s
      JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1 AND s.expires_at > now() AND u.status = 'active'
      LIMIT 1
    `, [tokenHash]);
    if (!row) return null;
    await this.database.query("UPDATE sessions SET last_seen_at = now() WHERE token_hash = $1", [tokenHash]);
    return { id: row.id, organizationId: row.organization_id, email: row.email, name: row.name, role: row.role };
  }

  async createSession(userId: string, tokenHash: string, expiresAt: Date): Promise<void> {
    await this.database.query(
      "INSERT INTO sessions (id, user_id, token_hash, expires_at) VALUES ($1, $2, $3, $4)",
      [randomUUID(), userId, tokenHash, expiresAt],
    );
  }

  async deleteSession(tokenHash: string): Promise<void> {
    await this.database.query("DELETE FROM sessions WHERE token_hash = $1", [tokenHash]);
  }

  async getClientForUser(user: AuthenticatedUser): Promise<ClientRow | null> {
    const [row] = await this.database.query<ClientRow>(`
      SELECT c.id, c.display_name, u.email, c.phone, c.timezone, c.onboarding_status, u.status AS user_status, c.created_at
      FROM clients c JOIN users u ON u.id = c.user_id
      WHERE c.organization_id = $1 AND c.user_id = $2 LIMIT 1
    `, [user.organizationId, user.id]);
    return row ?? null;
  }

  async listClients(user: AuthenticatedUser): Promise<ClientRow[]> {
    return this.database.query<ClientRow>(`
      SELECT c.id, c.display_name, COALESCE(u.email, '') AS email, c.phone, c.timezone, c.onboarding_status,
        COALESCE(u.status, 'disabled') AS user_status, c.created_at
      FROM clients c LEFT JOIN users u ON u.id = c.user_id
      WHERE c.organization_id = $1 ORDER BY c.created_at DESC
    `, [user.organizationId]);
  }

  async createClient(
    user: AuthenticatedUser,
    input: { name: string; email: string; phone?: string; timezone: string; temporaryPassword: string },
    requestId: string,
  ): Promise<string> {
    return this.idempotentMutation(user, "product.client.create.v1", requestId, {
      name: input.name,
      email: input.email,
      phone: input.phone ?? null,
      timezone: input.timezone,
    }, async (transaction) => {
      const existingIdentity = await transaction.query<{ id: string }>(
        "SELECT id FROM users WHERE lower(email) = lower($1) LIMIT 1",
        [input.email],
      );
      if (existingIdentity[0]) throw new EmailIdentityConflictError();
      const userId = randomUUID();
      const clientId = randomUUID();
      const passwordHash = await bcrypt.hash(input.temporaryPassword, 12);
      const created = await transaction.query<{ id: string }>(`
        WITH new_user AS (
          INSERT INTO users (id, organization_id, email, name, password_hash, role)
          VALUES ($1, $2, $3, $4, $5, 'client')
          RETURNING id
        )
        INSERT INTO clients (id, organization_id, user_id, display_name, phone, timezone, created_by)
        SELECT $6, $2, id, $4, $7, $8, $9 FROM new_user
        RETURNING id
      `, [userId, user.organizationId, input.email, input.name, passwordHash, clientId, input.phone ?? null, input.timezone, user.id]);
      if (!created.length) throw new Error("Client could not be created.");
      await this.audit(transaction, user, "client.created", "client", clientId, { email: input.email }, clientId);
      return clientId;
    }, async (transaction, clientId) => {
      const [created] = await transaction.query<{ password_hash: string }>(`
        SELECT u.password_hash FROM clients c JOIN users u ON u.id = c.user_id
        WHERE c.id = $1 AND c.organization_id = $2
      `, [clientId, user.organizationId]);
      if (!created || !(await bcrypt.compare(input.temporaryPassword, created.password_hash))) {
        throw new IdempotencyConflictError("This client request key was reused with different credentials");
      }
    });
  }

  async completeOnboarding(user: AuthenticatedUser, phone: string, timezone: string, requestId: string): Promise<void> {
    await this.idempotentMutation(user, "product.onboarding.complete.v1", requestId, { phone, timezone }, async (transaction) => {
      const [client] = await transaction.query<{ id: string }>(`
        UPDATE clients SET phone = $1, timezone = $2, onboarding_status = 'complete', risk_acknowledged_at = now()
        WHERE organization_id = $3 AND user_id = $4
        RETURNING id
      `, [phone, timezone, user.organizationId, user.id]);
      if (!client) throw new Error("Client profile not found.");
      await this.audit(transaction, user, "onboarding.completed", "client", client.id, { timezone }, client.id);
      return null;
    });
  }

  async setClientAccess(user: AuthenticatedUser, clientId: string, enabled: boolean, requestId: string): Promise<void> {
    await this.idempotentMutation(user, "product.client-access.set.v1", requestId, { clientId, enabled }, async (transaction) => {
      const result = await transaction.query<{ id: string }>(`
        UPDATE users SET status = $1
        WHERE id = (
          SELECT user_id FROM clients WHERE id = $2 AND organization_id = $3
        ) RETURNING id
      `, [enabled ? "active" : "disabled", clientId, user.organizationId]);
      if (!result.length) throw new Error("Client not found.");
      await this.audit(transaction, user, enabled ? "client.access_enabled" : "client.access_disabled", "client", clientId, {}, clientId);
      return null;
    });
  }

  async addAccountAndEnvironment(
    user: AuthenticatedUser,
    input: { provider: string; label: string; accountIdentifier: string; accountSize: number; ruleProfile: string; vpsProvider: string; vpsRegion: string; ninjaVersion: string },
    requestId: string,
  ): Promise<void> {
    const masked = `••••${input.accountIdentifier.slice(-4)}`;
    await this.idempotentMutation(user, "product.account-environment.register.v1", requestId, {
      provider: input.provider,
      label: input.label,
      accountIdentifierMasked: masked,
      accountSize: input.accountSize,
      ruleProfile: input.ruleProfile,
      vpsProvider: input.vpsProvider,
      vpsRegion: input.vpsRegion,
      ninjaVersion: input.ninjaVersion,
    }, async (transaction) => {
      const client = await this.requireClient(user, transaction);
      const accountId = randomUUID();
      const environmentId = randomUUID();
      const created = await transaction.query<{ id: string }>(`
        WITH new_account AS (
          INSERT INTO trading_accounts (id, organization_id, client_id, provider, label, account_identifier_masked, account_size, rule_profile, status)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'healthy') RETURNING id
        )
        INSERT INTO environments (id, organization_id, client_id, vps_provider, vps_region, ninja_version, connection_status, last_check_at)
        SELECT $9, $2, $3, $10, $11, $12, 'healthy', now() FROM new_account
        RETURNING id
      `, [accountId, user.organizationId, client.id, input.provider, input.label, masked, input.accountSize, input.ruleProfile, environmentId, input.vpsProvider, input.vpsRegion, input.ninjaVersion]);
      if (!created.length) throw new Error("Account and environment could not be registered.");
      await this.audit(transaction, user, "environment.registered", "environment", environmentId, { accountId, provider: input.provider }, client.id);
      return null;
    });
  }

  async getAccounts(clientId: string, organizationId: string): Promise<AccountRow[]> {
    return this.database.query<AccountRow>("SELECT id, provider, label, account_identifier_masked, account_size, rule_profile, status FROM trading_accounts WHERE client_id = $1 AND organization_id = $2 ORDER BY created_at DESC", [clientId, organizationId]);
  }

  async getEnvironments(clientId: string, organizationId: string): Promise<EnvironmentRow[]> {
    return this.database.query<EnvironmentRow>("SELECT id, vps_provider, vps_region, ninja_version, connection_status, last_check_at FROM environments WHERE client_id = $1 AND organization_id = $2 ORDER BY created_at DESC", [clientId, organizationId]);
  }

  async createStrategyRecommendation(user: AuthenticatedUser, questionnaire: StrategyQuestionnaire, requestId: string): Promise<string> {
    return this.idempotentMutation(user, "product.strategy.recommend.v1", requestId, questionnaire, async (transaction) => {
      const client = await this.requireClient(user, transaction);
      const [account] = await transaction.query<AccountRow>(
        "SELECT id, provider, label, account_identifier_masked, account_size, rule_profile, status FROM trading_accounts WHERE client_id = $1 AND organization_id = $2 ORDER BY created_at DESC LIMIT 1",
        [client.id, user.organizationId],
      );
      if (!account) throw new Error("Register a trading account before requesting a strategy recommendation.");
      const recommendation = recommendStrategy(questionnaire, Number(account.account_size));
      const [strategy] = await transaction.query<{ id: string }>("SELECT id FROM strategies WHERE organization_id = $1 AND slug = $2 AND approved = true", [user.organizationId, recommendation.strategySlug]);
      if (!strategy) throw new Error("No approved strategy matches this request.");
      const configurationId = randomUUID();
      const approvalId = randomUUID();
      const lockedClient = await transaction.query<{ id: string }>(
        "SELECT id FROM clients WHERE id = $1 AND organization_id = $2 FOR UPDATE",
        [client.id, user.organizationId],
      );
      if (!lockedClient.length) throw new Error("Client profile not found.");
      const [versionRow] = await transaction.query<{ version: number }>(
        "SELECT COALESCE(MAX(version), 0) + 1 AS version FROM strategy_configurations WHERE client_id = $1 AND organization_id = $2",
        [client.id, user.organizationId],
      );
      const version = Number(versionRow?.version ?? 1);
      const created = await transaction.query<{ configuration_id: string }>(`
        WITH new_configuration AS (
          INSERT INTO strategy_configurations (id, organization_id, client_id, strategy_id, version, questionnaire, configuration, validation, status, created_by)
          VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::jsonb, 'pending_approval', $9)
          RETURNING id
        )
        INSERT INTO approvals (id, organization_id, configuration_id, requested_by)
        SELECT $10, $2, id, $9 FROM new_configuration
        RETURNING configuration_id
      `, [configurationId, user.organizationId, client.id, strategy.id, version, JSON.stringify(questionnaire), JSON.stringify({ ...recommendation.configuration, explanation: recommendation.explanation }), JSON.stringify(recommendation.validation), user.id, approvalId]);
      if (!created.length) throw new Error("Strategy recommendation could not be created.");
      await this.audit(transaction, user, "strategy.approval_requested", "strategy_configuration", configurationId, { version, strategySlug: recommendation.strategySlug }, client.id);
      return configurationId;
    });
  }

  async getConfigurations(clientId: string, organizationId: string): Promise<ConfigurationRow[]> {
    return this.database.query<ConfigurationRow>(`
      SELECT sc.id, sc.version, sc.status, s.name AS strategy_name, s.description AS strategy_description,
        sc.questionnaire, sc.configuration, sc.validation, sc.created_at, sc.approved_at, sc.deployed_at
      FROM strategy_configurations sc JOIN strategies s ON s.id = sc.strategy_id
      WHERE sc.client_id = $1 AND sc.organization_id = $2 ORDER BY sc.version DESC
    `, [clientId, organizationId]);
  }

  async listApprovals(user: AuthenticatedUser): Promise<ApprovalRow[]> {
    return this.database.query<ApprovalRow>(`
      SELECT a.id, a.configuration_id, c.display_name AS client_name, s.name AS strategy_name,
        sc.version, sc.configuration, sc.validation, a.status, a.notes, a.created_at
      FROM approvals a
      JOIN strategy_configurations sc ON sc.id = a.configuration_id
      JOIN strategies s ON s.id = sc.strategy_id
      JOIN clients c ON c.id = sc.client_id
      WHERE a.organization_id = $1 ORDER BY CASE WHEN a.status = 'pending' THEN 0 ELSE 1 END, a.created_at DESC
    `, [user.organizationId]);
  }

  async reviewApproval(user: AuthenticatedUser, approvalId: string, decision: "approved" | "rejected", notes: string | undefined, requestId: string): Promise<void> {
    await this.idempotentMutation(user, "product.approval.review.v1", requestId, { approvalId, decision, notes: notes ?? null }, async (transaction) => {
      const [approval] = await transaction.query<{ configuration_id: string }>(`
        UPDATE approvals SET status = $1, notes = $2, reviewed_by = $3, reviewed_at = now()
        WHERE id = $4 AND organization_id = $5 AND status = 'pending'
        RETURNING configuration_id
      `, [decision, notes ?? null, user.id, approvalId, user.organizationId]);
      if (!approval) throw new Error("Pending approval not found.");

      const [configuration] = await transaction.query<{ id: string; client_id: string }>(`
        UPDATE strategy_configurations SET status = $1,
          approved_by = CASE WHEN $1 = 'approved' THEN $2 ELSE NULL END,
          approved_at = CASE WHEN $1 = 'approved' THEN now() ELSE NULL END
        WHERE id = $3 AND organization_id = $4 AND status = 'pending_approval'
        RETURNING id, client_id
      `, [decision, user.id, approval.configuration_id, user.organizationId]);
      if (!configuration) throw new Error("Pending strategy configuration not found.");

      await this.audit(transaction, user, `strategy.${decision}`, "strategy_configuration", configuration.id, { notes: notes ?? "" }, configuration.client_id);
      return null;
    });
  }

  async recordDeployment(user: AuthenticatedUser, configurationId: string, requestId: string): Promise<void> {
    await this.idempotentMutation(user, "product.deployment.record.v1", requestId, { configurationId }, async (transaction) => {
      const client = await this.requireClient(user, transaction);
      const result = await transaction.query<{ id: string; client_id: string }>(`
        UPDATE strategy_configurations SET status = 'deployment_recorded', deployed_at = now()
        WHERE id = $1 AND client_id = $2 AND organization_id = $3 AND status = 'approved'
        RETURNING id, client_id
      `, [configurationId, client.id, user.organizationId]);
      if (!result.length) throw new Error("Only an approved configuration can have deployment recorded.");
      await this.audit(transaction, user, "deployment.recorded", "strategy_configuration", configurationId, { autonomousTrading: false }, result[0].client_id);
      return null;
    });
  }

  async simulateHealthFailure(user: AuthenticatedUser, clientId: string | undefined, requestId: string): Promise<string> {
    return this.idempotentMutation(user, "product.health-failure.simulate.v1", requestId, { clientId: clientId ?? null }, async (transaction) => {
      const targetClientId = clientId ?? (await this.requireClient(user, transaction)).id;
      const [client] = await transaction.query<{ id: string }>("SELECT id FROM clients WHERE id = $1 AND organization_id = $2", [targetClientId, user.organizationId]);
      if (!client) throw new Error("Client not found.");
      const [environment] = await transaction.query<{ id: string }>("SELECT id FROM environments WHERE client_id = $1 AND organization_id = $2 ORDER BY created_at DESC LIMIT 1", [targetClientId, user.organizationId]);
      if (!environment) throw new Error("Register an environment before running a health simulation.");
      const healthId = randomUUID();
      const incidentId = randomUUID();
      const created = await transaction.query<{ id: string }>(`
        WITH failed_check AS (
          INSERT INTO health_checks (id, organization_id, client_id, environment_id, connector, status, summary, details)
          VALUES ($1, $2, $3, $4, 'vps', 'offline', 'Simulated VPS heartbeat missed', $5::jsonb) RETURNING id
        ), updated_environment AS (
          UPDATE environments SET connection_status = 'offline', last_check_at = now() WHERE id = $4 RETURNING id
        )
        INSERT INTO incidents (id, organization_id, client_id, environment_id, severity, title, description, resolution_steps)
        SELECT $6, $2, $3, $4, 'high', 'VPS connection offline',
          'The simulated health adapter stopped receiving the VPS heartbeat. No trading action was taken.', $7::jsonb
        FROM failed_check, updated_environment
        RETURNING id
      `, [healthId, user.organizationId, targetClientId, environment.id, JSON.stringify({ adapter: "simulated", safe: true }), incidentId, JSON.stringify(["Confirm the VPS is reachable.", "Restart the NinjaTrader service only after client approval.", "Run a fresh health check and verify account connectivity."])]);
      if (!created.length) throw new Error("Health simulation could not create an incident.");
      await this.audit(transaction, user, "incident.simulated", "incident", incidentId, { healthId }, targetClientId);
      return incidentId;
    });
  }

  async listIncidents(user: AuthenticatedUser, clientId?: string): Promise<IncidentRow[]> {
    const params: unknown[] = [user.organizationId];
    const filter = clientId ? " AND i.client_id = $2" : "";
    if (clientId) params.push(clientId);
    return this.database.query<IncidentRow>(`
      SELECT i.id, i.client_id, c.display_name AS client_name, i.severity, i.status, i.title, i.description,
        i.resolution_steps, i.current_step, i.created_at
      FROM incidents i JOIN clients c ON c.id = i.client_id
      WHERE i.organization_id = $1${filter} ORDER BY i.created_at DESC
    `, params);
  }

  async updateIncident(user: AuthenticatedUser, incidentId: string, action: "advance" | "resolve", requestId: string): Promise<void> {
    await this.idempotentMutation(user, "product.incident.update.v1", requestId, { incidentId, action }, async (transaction) => {
      const [incident] = await transaction.query<{ client_id: string; current_step: number; status: string }>(`
        UPDATE incidents SET
          current_step = CASE
            WHEN $1 = 'resolve' THEN jsonb_array_length(resolution_steps)
            ELSE LEAST(current_step + 1, jsonb_array_length(resolution_steps))
          END,
          status = CASE WHEN $1 = 'resolve' THEN 'resolved' ELSE 'investigating' END,
          resolved_at = CASE WHEN $1 = 'resolve' THEN now() ELSE NULL END
        WHERE id = $2 AND organization_id = $3 AND status <> 'resolved'
          AND ($1 = 'resolve' OR current_step < jsonb_array_length(resolution_steps))
        RETURNING client_id, current_step, status
      `, [action, incidentId, user.organizationId]);
      if (!incident) throw new Error("Incident not found or transition already completed.");
      await this.audit(transaction, user, `incident.${incident.status}`, "incident", incidentId, { currentStep: incident.current_step }, incident.client_id);
      return null;
    });
  }

  async latestHealth(clientId: string, organizationId: string): Promise<ConnectorHealthResult[]> {
    return this.database.query<ConnectorHealthResult>(`
      SELECT DISTINCT ON (connector) connector, status, summary, details
      FROM health_checks WHERE client_id = $1 AND organization_id = $2
      ORDER BY connector, checked_at DESC
    `, [clientId, organizationId]);
  }

  async listAudit(user: AuthenticatedUser, clientId?: string): Promise<AuditRow[]> {
    const entityFilter = clientId ? ` AND (
      ae.entity_id = $2
      OR ae.metadata->>'clientId' = $2
      OR ae.actor_user_id = (SELECT user_id FROM clients WHERE id = $2 AND organization_id = $1)
    )` : "";
    return this.database.query<AuditRow>(`
      SELECT ae.id, ae.action, ae.entity_type, ae.entity_id, ae.metadata, u.name AS actor_name,
        ae.actor_subject_id, ae.origin_installation_id, ae.event_version, ae.evidence_hash,
        ae.legacy_unverified, ae.created_at
      FROM audit_events ae LEFT JOIN users u ON u.id = ae.actor_user_id
      WHERE ae.organization_id = $1${entityFilter} ORDER BY ae.created_at DESC LIMIT 100
    `, clientId ? [user.organizationId, clientId] : [user.organizationId]);
  }

  async getKillSwitch(organizationId: string): Promise<boolean> {
    const [row] = await this.database.query<{ kill_switch_enabled: boolean }>("SELECT kill_switch_enabled FROM organizations WHERE id = $1", [organizationId]);
    return Boolean(row?.kill_switch_enabled);
  }

  async setKillSwitch(user: AuthenticatedUser, enabled: boolean, requestId: string): Promise<void> {
    await this.idempotentMutation(user, "product.kill-switch.set.v1", requestId, { enabled }, async (transaction) => {
      const updated = await transaction.query<{ id: string }>(
        "UPDATE organizations SET kill_switch_enabled = $1 WHERE id = $2 RETURNING id",
        [enabled, user.organizationId],
      );
      if (!updated.length) throw new Error("Organization not found.");
      await this.audit(transaction, user, enabled ? "kill_switch.enabled" : "kill_switch.disabled", "organization", user.organizationId, {});
      return null;
    });
  }

  private async requireClient(
    user: AuthenticatedUser,
    executor: Pick<DatabaseClient, "query"> = this.database,
  ): Promise<ClientRow> {
    const [client] = await executor.query<ClientRow>(`
      SELECT c.id, c.display_name, u.email, c.phone, c.timezone, c.onboarding_status, u.status AS user_status, c.created_at
      FROM clients c JOIN users u ON u.id = c.user_id
      WHERE c.organization_id = $1 AND c.user_id = $2 LIMIT 1
    `, [user.organizationId, user.id]);
    if (!client) throw new Error("Client profile not found.");
    return client;
  }

  private async idempotentMutation<T>(
    user: AuthenticatedUser,
    scope: string,
    requestId: string,
    semanticInput: unknown,
    operation: (transaction: DatabaseTransaction) => Promise<T>,
    validateReplay?: (transaction: DatabaseTransaction, value: T) => Promise<void>,
  ): Promise<T> {
    if (!REQUEST_ID_PATTERN.test(requestId)) throw new Error("A valid request ID is required");

    const actorSubjectId = userAuditSubject(user.id);
    const requestHash = hashCanonicalPayload({
      schemaVersion: 1,
      scope,
      organizationId: user.organizationId,
      actorSubjectId,
      input: semanticInput,
    });

    return this.database.transaction(async (transaction) => {
      const idempotencyId = randomUUID();
      const inserted = await transaction.query<{ id: string }>(`
        INSERT INTO idempotency_keys
          (id, organization_id, scope, idempotency_key, actor_subject_id, request_hash, result)
        VALUES ($1, $2, $3, $4, $5, $6, '{}'::jsonb)
        ON CONFLICT (organization_id, scope, idempotency_key) DO NOTHING
        RETURNING id
      `, [idempotencyId, user.organizationId, scope, requestId, actorSubjectId, requestHash]);

      if (inserted[0]) {
        const value = await operation(transaction);
        const cachedResult = { schemaVersion: 1, value };
        const completed = await transaction.query<{ id: string }>(`
          UPDATE idempotency_keys SET result = $1::jsonb, completed_at = now()
          WHERE id = $2 AND organization_id = $3 AND completed_at IS NULL
          RETURNING id
        `, [JSON.stringify(cachedResult), idempotencyId, user.organizationId]);
        if (!completed[0]) throw new Error("Idempotency result could not be recorded");
        return value;
      }

      const [existing] = await transaction.query<{
        actor_subject_id: string;
        request_hash: string | null;
        result: unknown;
        completed_at: Date | null;
      }>(`
        SELECT actor_subject_id, request_hash, result, completed_at
        FROM idempotency_keys
        WHERE organization_id = $1 AND scope = $2 AND idempotency_key = $3
      `, [user.organizationId, scope, requestId]);
      if (
        !existing
        || existing.actor_subject_id !== actorSubjectId
        || existing.request_hash !== requestHash
      ) {
        throw new IdempotencyConflictError();
      }
      if (!existing.completed_at) {
        throw new IdempotencyConflictError("The prior request has no completed result and cannot be replayed");
      }
      const cached = existing.result;
      if (
        typeof cached !== "object"
        || cached === null
        || !("schemaVersion" in cached)
        || cached.schemaVersion !== 1
        || !("value" in cached)
      ) {
        throw new IdempotencyConflictError("The prior request result is not replayable");
      }
      const value = cached.value as T;
      if (validateReplay) await validateReplay(transaction, value);
      return value;
    });
  }

  private async audit(
    executor: Pick<DatabaseClient, "query">,
    user: AuthenticatedUser,
    action: string,
    entityType: string,
    entityId: string,
    metadata: JsonValue,
    clientId?: string,
  ): Promise<void> {
    const scopedMetadata = clientId && typeof metadata === "object" && metadata !== null && !Array.isArray(metadata)
      ? { ...metadata, clientId }
      : metadata;
    await writeAuditEvent(executor, {
      organizationId: user.organizationId,
      actorUserId: user.id,
      actorSubjectId: userAuditSubject(user.id),
      action,
      entityType,
      entityId,
      metadata: scopedMetadata,
    });
  }
}

export function getNinjaRepository(): NinjaRepository {
  return new NinjaRepository();
}
