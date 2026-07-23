import "server-only";

import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";

import type { DatabaseClient, DatabaseTransaction } from "@/lib/db/client";
import { getDatabase } from "@/lib/db/client";
import type { DeploymentMode } from "@/lib/deployment/contracts";
import { getDeploymentProfile } from "@/lib/deployment/server";
import { userAuditSubject } from "@/lib/domain/audit-evidence";
import {
  SUPPORT_CREATE_LIMIT,
  SUPPORT_CREATE_WINDOW_MS,
  SUPPORT_OTP_MAX_FAILED_ATTEMPTS,
  SUPPORT_OTP_TTL_MS,
  SUPPORT_STAFF_ATTEMPT_LIMIT,
  SUPPORT_STAFF_ATTEMPT_WINDOW_MS,
  createSupportChallengeInputSchema,
  redeemSupportChallengeInputSchema,
  revokeSupportAccessInputSchema,
  supportChallengeRequestHash,
  supportRedemptionRequestHash,
  supportRevocationRequestHash,
  validateSupportGrantInputSchema,
  type CreatedSupportChallenge,
  type RedeemedSupportGrant,
  type SupportAccessScope,
  type ValidatedSupportGrant,
} from "@/lib/domain/support-access-contracts";
import { RuntimeServiceError } from "@/lib/domain/runtime-errors";
import type { AuthenticatedUser, UserRole } from "@/lib/domain/types";
import { writeAuditEvent } from "@/lib/repositories/audit-writer";

export const SUPPORT_ACCESS_SECRET_ENV = "NINJA_MANAGER_SUPPORT_ACCESS_SECRET";

type Clock = () => Date;
type RandomBytes = (size: number) => Buffer;
type ModeProvider = () => DeploymentMode;

export interface SupportAccessRepositoryOptions {
  secret?: string | Uint8Array;
  clock?: Clock;
  randomBytes?: RandomBytes;
  mode?: ModeProvider;
}

interface ChallengeRow {
  id: string;
  organization_id: string;
  created_by: string;
  deployment_mode: DeploymentMode;
  requested_session_minutes: number;
  otp_salt: string;
  otp_verifier: string;
  idempotency_key: string;
  request_hash: string;
  created_at: Date;
  expires_at: Date;
}

interface SessionRow {
  id: string;
  organization_id: string;
  challenge_id: string;
  redemption_id: string;
  staff_user_id: string;
  client_user_id: string;
  bearer_hash: string;
  issued_at: Date;
  expires_at: Date;
}

interface RedemptionReplayRow extends SessionRow {
  request_hash: string;
  idempotency_key: string;
}

interface CountRow {
  count: number | string;
}

export interface SupportAccessRevocationResult {
  readonly revocationId: string;
  readonly targetType: "challenge" | "session" | "tenant_sessions";
  readonly targetId: string | null;
  readonly revokedAt: string;
  readonly duplicate: boolean;
}

function validDate(clock: Clock): Date {
  const value = clock();
  if (!Number.isFinite(value.getTime())) throw new Error("Support access clock returned an invalid timestamp");
  return value;
}

function loadSecret(value: string | Uint8Array | undefined): Buffer {
  const source = value ?? process.env[SUPPORT_ACCESS_SECRET_ENV];
  if (source === undefined) throw new Error(`${SUPPORT_ACCESS_SECRET_ENV} is required for support access`);
  const secret = typeof source === "string" ? Buffer.from(source, "utf8") : Buffer.from(source);
  if (secret.byteLength < 32) throw new Error("Support access secret must contain at least 32 bytes");
  return secret;
}

function keyedHash(secret: Buffer, purpose: string, ...values: string[]): string {
  const hmac = createHmac("sha256", secret);
  hmac.update(`v1:${purpose}`);
  for (const value of values) {
    hmac.update("\0");
    hmac.update(value, "utf8");
  }
  return `hmac-sha256:${hmac.digest("hex")}`;
}

function verifierBytes(verifier: string): Buffer {
  const match = verifier.match(/^hmac-sha256:([a-f0-9]{64})$/);
  return Buffer.from(match?.[1] ?? "0".repeat(64), "hex");
}

function numericOtp(random: RandomBytes): string {
  const upperBound = 4_200_000_000;
  for (let attempt = 0; attempt < 128; attempt += 1) {
    const bytes = random(4);
    if (bytes.byteLength !== 4) throw new Error("Support random source returned an invalid byte count");
    const candidate = bytes.readUInt32BE();
    if (candidate < upperBound) return (candidate % 100_000_000).toString().padStart(8, "0");
  }
  throw new Error("Support random source could not generate an OTP");
}

function bearerSecret(random: RandomBytes): string {
  const bytes = random(32);
  if (bytes.byteLength !== 32) throw new Error("Support random source returned an invalid byte count");
  return bytes.toString("base64url");
}

function count(rows: CountRow[]): number {
  return Number(rows[0]?.count ?? 0);
}

function deny(): never {
  throw new RuntimeServiceError("UNAUTHORIZED", "Support access was denied");
}

export class SupportAccessRepository {
  private readonly secret: Buffer;
  private readonly clock: Clock;
  private readonly random: RandomBytes;
  private readonly mode: ModeProvider;

  constructor(
    private readonly database: DatabaseClient = getDatabase(),
    options: SupportAccessRepositoryOptions = {},
  ) {
    this.secret = loadSecret(options.secret);
    this.clock = options.clock ?? (() => new Date());
    this.random = options.randomBytes ?? randomBytes;
    this.mode = options.mode ?? (() => getDeploymentProfile().mode);
  }

  async createChallenge(user: AuthenticatedUser, input: unknown): Promise<CreatedSupportChallenge> {
    const value = createSupportChallengeInputSchema.parse(input);
    if (user.role !== "client") throw new RuntimeServiceError("FORBIDDEN", "Only the client may grant support access");
    const now = validDate(this.clock);
    const deploymentMode = this.mode();
    const requestHash = supportChallengeRequestHash(value);

    return this.database.transaction(async (transaction) => {
      await this.requireActor(transaction, user, "client", true);
      await transaction.query("SELECT id FROM organizations WHERE id = $1 FOR UPDATE", [user.organizationId]);
      const existing = (await transaction.query<ChallengeRow>(
        [
          "SELECT id, organization_id, created_by, deployment_mode, requested_session_minutes, otp_salt, otp_verifier,",
          "idempotency_key, request_hash, created_at, expires_at",
          "FROM support_access_challenges",
          "WHERE organization_id = $1 AND created_by = $2 AND idempotency_key = $3",
          "LIMIT 1",
        ].join(" "),
        [user.organizationId, user.id, value.idempotencyKey],
      ))[0];
      if (existing) {
        if (existing.request_hash !== requestHash) {
          throw new RuntimeServiceError("CONFLICT", "Support challenge idempotency key conflicts with an existing request");
        }
        return this.challengeResult(transaction, existing, null, true);
      }

      const recentCreates = count(await transaction.query<CountRow>(
        "SELECT COUNT(*)::integer AS count FROM support_access_challenges WHERE organization_id = $1 AND created_by = $2 AND created_at >= $3",
        [user.organizationId, user.id, new Date(now.getTime() - SUPPORT_CREATE_WINDOW_MS)],
      ));
      if (recentCreates >= SUPPORT_CREATE_LIMIT) {
        throw new RuntimeServiceError("CONFLICT", "Support challenge creation is temporarily limited");
      }

      for (const target of value.targets) {
        const agent = await transaction.query<{ id: string }>(
          [
            "SELECT agent.id FROM agent_installations agent",
            "JOIN environments environment ON environment.organization_id = agent.organization_id AND environment.id = agent.environment_id",
            "JOIN clients client ON client.organization_id = environment.organization_id AND client.id = environment.client_id",
            "WHERE agent.organization_id = $1 AND agent.id = $2 AND client.user_id = $3",
          ].join(" "),
          [user.organizationId, target.agentId, user.id],
        );
        if (agent.length !== 1) throw new RuntimeServiceError("CONFLICT", "A selected support target is not owned by this client");
        if (target.accountRefs.length > 0) {
          const identities = await transaction.query<{ account_ref: string }>(
            "SELECT account_ref FROM runtime_account_identities WHERE organization_id = $1 AND agent_id = $2 AND account_ref = ANY($3::text[])",
            [user.organizationId, target.agentId, target.accountRefs],
          );
          if (identities.length !== target.accountRefs.length) {
            throw new RuntimeServiceError("CONFLICT", "A selected support account target is not authoritative for its agent");
          }
        }
      }

      const challengeId = randomUUID();
      const otp = numericOtp(this.random);
      const saltBytes = this.random(32);
      if (saltBytes.byteLength !== 32) throw new Error("Support random source returned an invalid byte count");
      const salt = saltBytes.toString("hex");
      const verifier = keyedHash(this.secret, "otp", salt, otp);
      const expiresAt = new Date(now.getTime() + SUPPORT_OTP_TTL_MS);
      await transaction.query(
        [
          "INSERT INTO support_access_challenges",
          "(id, organization_id, created_by, deployment_mode, requested_session_minutes, otp_salt, otp_verifier,",
          "idempotency_key, request_hash, created_at, expires_at)",
          "VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)",
        ].join(" "),
        [challengeId, user.organizationId, user.id, deploymentMode, value.requestedSessionMinutes, salt, verifier,
          value.idempotencyKey, requestHash, now, expiresAt],
      );
      for (const scope of value.scopes) {
        await transaction.query(
          "INSERT INTO support_access_challenge_scopes (organization_id, challenge_id, scope) VALUES ($1, $2, $3)",
          [user.organizationId, challengeId, scope],
        );
      }
      for (const target of value.targets) {
        await transaction.query(
          "INSERT INTO support_access_challenge_agents (organization_id, challenge_id, agent_id) VALUES ($1, $2, $3)",
          [user.organizationId, challengeId, target.agentId],
        );
        for (const accountRef of target.accountRefs) {
          await transaction.query(
            "INSERT INTO support_access_challenge_accounts (organization_id, challenge_id, agent_id, account_ref_hash) VALUES ($1, $2, $3, $4)",
            [user.organizationId, challengeId, target.agentId, this.accountHash(accountRef)],
          );
        }
      }
      await writeAuditEvent(transaction, {
        organizationId: user.organizationId,
        actorUserId: user.id,
        actorSubjectId: userAuditSubject(user.id),
        action: "support.challenge_created",
        entityType: "support_access_challenge",
        entityId: challengeId,
        metadata: {
          deploymentMode,
          scopes: value.scopes,
          agentCount: value.targets.length,
          accountCount: value.targets.reduce((total, target) => total + target.accountRefs.length, 0),
          expiresAt: expiresAt.toISOString(),
          requestedSessionMinutes: value.requestedSessionMinutes,
        },
        occurredAt: now,
      });
      return this.challengeResult(transaction, {
        id: challengeId,
        organization_id: user.organizationId,
        created_by: user.id,
        deployment_mode: deploymentMode,
        requested_session_minutes: value.requestedSessionMinutes,
        otp_salt: salt,
        otp_verifier: verifier,
        idempotency_key: value.idempotencyKey,
        request_hash: requestHash,
        created_at: now,
        expires_at: expiresAt,
      }, otp, false);
    });
  }

  async redeemChallenge(user: AuthenticatedUser, input: unknown): Promise<RedeemedSupportGrant> {
    const value = redeemSupportChallengeInputSchema.parse(input);
    if (user.role !== "staff" || this.mode() !== "CENTRAL_CONNECTED" || value.tenantId !== user.organizationId) deny();
    const now = validDate(this.clock);
    const requestHash = supportRedemptionRequestHash(value);

    const result = await this.database.transaction<RedeemedSupportGrant | { denied: true }>(async (transaction) => {
      await this.requireActor(transaction, user, "staff", true);
      const replay = (await transaction.query<RedemptionReplayRow>(
        [
          "SELECT session.id, session.organization_id, session.challenge_id, session.redemption_id, session.staff_user_id,",
          "session.client_user_id, session.bearer_hash, session.issued_at, session.expires_at, redemption.request_hash, redemption.idempotency_key",
          "FROM support_access_redemptions redemption",
          "JOIN support_access_sessions session ON session.organization_id = redemption.organization_id AND session.redemption_id = redemption.id",
          "WHERE redemption.organization_id = $1 AND redemption.staff_user_id = $2 AND redemption.idempotency_key = $3",
          "LIMIT 1",
        ].join(" "),
        [value.tenantId, user.id, value.idempotencyKey],
      ))[0];
      if (replay) {
        if (replay.request_hash !== requestHash) {
          throw new RuntimeServiceError("CONFLICT", "Support redemption idempotency key conflicts with an existing request");
        }
        return this.sessionResult(transaction, replay, null, true);
      }

      const challenge = (await transaction.query<ChallengeRow>(
        [
          "SELECT id, organization_id, created_by, deployment_mode, requested_session_minutes, otp_salt, otp_verifier,",
          "idempotency_key, request_hash, created_at, expires_at",
          "FROM support_access_challenges WHERE organization_id = $1 AND id = $2 FOR UPDATE",
        ].join(" "),
        [value.tenantId, value.challengeId],
      ))[0];
      const candidate = keyedHash(this.secret, "otp", challenge?.otp_salt ?? "0".repeat(64), value.otp);
      const otpMatches = timingSafeEqual(
        verifierBytes(challenge?.otp_verifier ?? keyedHash(this.secret, "otp", "0".repeat(64), "00000000")),
        verifierBytes(candidate),
      );
      if (!challenge) return { denied: true };

      const failedAttempts = count(await transaction.query<CountRow>(
        "SELECT COUNT(*)::integer AS count FROM support_access_attempts WHERE challenge_id = $1 AND outcome = 'invalid'",
        [challenge.id],
      ));
      const staffFailures = count(await transaction.query<CountRow>(
        "SELECT COUNT(*)::integer AS count FROM support_access_attempts WHERE organization_id = $1 AND staff_user_id = $2 AND outcome = 'invalid' AND occurred_at >= $3",
        [value.tenantId, user.id, new Date(now.getTime() - SUPPORT_STAFF_ATTEMPT_WINDOW_MS)],
      ));
      const existingRedemption = await transaction.query<{ id: string }>(
        "SELECT id FROM support_access_redemptions WHERE challenge_id = $1 LIMIT 1",
        [challenge.id],
      );
      const challengeRevocation = await transaction.query<{ id: string }>(
        "SELECT id FROM support_access_revocations WHERE organization_id = $1 AND target_type = 'challenge' AND challenge_id = $2 AND revoked_at <= $3 LIMIT 1",
        [value.tenantId, challenge.id, now],
      );
      const usable = challenge.expires_at.getTime() > now.getTime()
        && failedAttempts < SUPPORT_OTP_MAX_FAILED_ATTEMPTS
        && staffFailures < SUPPORT_STAFF_ATTEMPT_LIMIT
        && existingRedemption.length === 0
        && challengeRevocation.length === 0;
      if (!otpMatches || !usable) {
        if (!otpMatches && usable) {
          await transaction.query(
            "INSERT INTO support_access_attempts (id, organization_id, challenge_id, staff_user_id, outcome, failed_attempt_number, occurred_at) VALUES ($1, $2, $3, $4, 'invalid', $5, $6)",
            [randomUUID(), value.tenantId, challenge.id, user.id, failedAttempts + 1, now],
          );
        }
        return { denied: true };
      }

      const redemptionId = randomUUID();
      const sessionId = randomUUID();
      const secret = bearerSecret(this.random);
      const issuedAt = now;
      const expiresAt = new Date(issuedAt.getTime() + challenge.requested_session_minutes * 60_000);
      await transaction.query(
        "INSERT INTO support_access_attempts (id, organization_id, challenge_id, staff_user_id, outcome, failed_attempt_number, occurred_at) VALUES ($1, $2, $3, $4, 'accepted', NULL, $5)",
        [randomUUID(), value.tenantId, challenge.id, user.id, now],
      );
      await transaction.query(
        [
          "INSERT INTO support_access_redemptions",
          "(id, organization_id, challenge_id, staff_user_id, idempotency_key, request_hash, redeemed_at)",
          "VALUES ($1, $2, $3, $4, $5, $6, $7)",
        ].join(" "),
        [redemptionId, value.tenantId, challenge.id, user.id, value.idempotencyKey, requestHash, now],
      );
      await transaction.query(
        [
          "INSERT INTO support_access_sessions",
          "(id, organization_id, challenge_id, redemption_id, staff_user_id, client_user_id, bearer_hash, issued_at, expires_at)",
          "VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)",
        ].join(" "),
        [sessionId, value.tenantId, challenge.id, redemptionId, user.id, challenge.created_by,
          this.bearerHash(secret), issuedAt, expiresAt],
      );
      await transaction.query(
        "INSERT INTO support_access_session_scopes (organization_id, session_id, scope) SELECT organization_id, $1, scope FROM support_access_challenge_scopes WHERE challenge_id = $2",
        [sessionId, challenge.id],
      );
      await transaction.query(
        "INSERT INTO support_access_session_agents (organization_id, session_id, agent_id) SELECT organization_id, $1, agent_id FROM support_access_challenge_agents WHERE challenge_id = $2",
        [sessionId, challenge.id],
      );
      await transaction.query(
        "INSERT INTO support_access_session_accounts (organization_id, session_id, agent_id, account_ref_hash) SELECT organization_id, $1, agent_id, account_ref_hash FROM support_access_challenge_accounts WHERE challenge_id = $2",
        [sessionId, challenge.id],
      );
      const safeCounts = await this.targetCounts(transaction, challenge.id, "challenge");
      const scopes = await this.scopes(transaction, challenge.id, "challenge");
      await writeAuditEvent(transaction, {
        organizationId: value.tenantId,
        actorUserId: user.id,
        actorSubjectId: userAuditSubject(user.id),
        action: "support.challenge_redeemed",
        entityType: "support_access_session",
        entityId: sessionId,
        metadata: { challengeId: challenge.id, scopes, ...safeCounts, expiresAt: expiresAt.toISOString() },
        occurredAt: now,
      });
      return {
        sessionId,
        challengeId: challenge.id,
        scopes,
        ...safeCounts,
        staffUserId: user.id,
        issuedAt: issuedAt.toISOString(),
        expiresAt: expiresAt.toISOString(),
        bearerSecret: secret,
        duplicate: false,
      };
    });
    if ("denied" in result) deny();
    return result;
  }

  async validateGrant(user: AuthenticatedUser, input: unknown): Promise<ValidatedSupportGrant> {
    const value = validateSupportGrantInputSchema.parse(input);
    if (user.role !== "staff" || this.mode() !== "CENTRAL_CONNECTED" || value.tenantId !== user.organizationId) deny();
    const now = validDate(this.clock);

    return this.database.transaction(async (transaction) => {
      await this.requireActor(transaction, user, "staff", false);
      const session = (await transaction.query<SessionRow>(
        [
          "SELECT id, organization_id, challenge_id, redemption_id, staff_user_id, client_user_id, bearer_hash, issued_at, expires_at",
          "FROM support_access_sessions WHERE organization_id = $1 AND bearer_hash = $2 LIMIT 1",
        ].join(" "),
        [value.tenantId, this.bearerHash(value.bearerSecret)],
      ))[0];
      if (!session || session.staff_user_id !== user.id || session.expires_at.getTime() <= now.getTime()) deny();
      const revoked = await transaction.query<{ id: string }>(
        [
          "SELECT id FROM support_access_revocations WHERE organization_id = $1 AND revoked_at <= $2 AND (",
          "(target_type = 'session' AND session_id = $3)",
          "OR (target_type = 'challenge' AND challenge_id = $4)",
          "OR (target_type = 'tenant_sessions' AND created_by = $6 AND revoked_at >= $5)",
          ") LIMIT 1",
        ].join(" "),
        [value.tenantId, now, session.id, session.challenge_id, session.issued_at, session.client_user_id],
      );
      if (revoked[0]) deny();
      const scope = await transaction.query<{ scope: string }>(
        "SELECT scope FROM support_access_session_scopes WHERE organization_id = $1 AND session_id = $2 AND scope = $3",
        [value.tenantId, session.id, value.scope],
      );
      const agent = await transaction.query<{ agent_id: string }>(
        "SELECT agent_id FROM support_access_session_agents WHERE organization_id = $1 AND session_id = $2 AND agent_id = $3",
        [value.tenantId, session.id, value.agentId],
      );
      if (!scope[0] || !agent[0]) deny();
      const accountTargets = count(await transaction.query<CountRow>(
        "SELECT COUNT(*)::integer AS count FROM support_access_session_accounts WHERE organization_id = $1 AND session_id = $2 AND agent_id = $3",
        [value.tenantId, session.id, value.agentId],
      ));
      const accountHash = value.accountRef === undefined ? null : this.accountHash(value.accountRef);
      if (accountTargets === 0 ? accountHash !== null : accountHash === null) deny();
      if (accountHash !== null) {
        const account = await transaction.query<{ account_ref_hash: string }>(
          "SELECT account_ref_hash FROM support_access_session_accounts WHERE organization_id = $1 AND session_id = $2 AND agent_id = $3 AND account_ref_hash = $4",
          [value.tenantId, session.id, value.agentId, accountHash],
        );
        if (!account[0]) deny();
      }

      const eventId = randomUUID();
      await transaction.query(
        "INSERT INTO support_access_events (id, organization_id, session_id, staff_user_id, scope, agent_id, account_ref_hash, accessed_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
        [eventId, value.tenantId, session.id, user.id, value.scope, value.agentId, accountHash, now],
      );
      await writeAuditEvent(transaction, {
        organizationId: value.tenantId,
        actorUserId: user.id,
        actorSubjectId: userAuditSubject(user.id),
        action: "support.access_used",
        entityType: "support_access_event",
        entityId: eventId,
        metadata: { sessionId: session.id, scope: value.scope, agentId: value.agentId, accountRestricted: accountHash !== null },
        occurredAt: now,
      });
      return {
        sessionId: session.id,
        challengeId: session.challenge_id,
        tenantId: value.tenantId,
        staffUserId: user.id,
        scope: value.scope,
        agentId: value.agentId,
        accountRestricted: accountHash !== null,
        expiresAt: session.expires_at.toISOString(),
      };
    });
  }

  async revoke(user: AuthenticatedUser, input: unknown): Promise<SupportAccessRevocationResult> {
    const value = revokeSupportAccessInputSchema.parse(input);
    if (user.role !== "client") throw new RuntimeServiceError("FORBIDDEN", "Only the client may revoke support access");
    const now = validDate(this.clock);
    const requestHash = supportRevocationRequestHash(value);
    const targetId = value.targetType === "challenge"
      ? value.challengeId
      : value.targetType === "session"
        ? value.sessionId
        : null;

    return this.database.transaction(async (transaction) => {
      await this.requireActor(transaction, user, "client", true);
      await transaction.query("SELECT id FROM organizations WHERE id = $1 FOR UPDATE", [user.organizationId]);
      const existing = (await transaction.query<{
        id: string; target_type: SupportAccessRevocationResult["targetType"]; challenge_id: string | null;
        session_id: string | null; request_hash: string; revoked_at: Date;
      }>(
        "SELECT id, target_type, challenge_id, session_id, request_hash, revoked_at FROM support_access_revocations WHERE organization_id = $1 AND created_by = $2 AND idempotency_key = $3 LIMIT 1",
        [user.organizationId, user.id, value.idempotencyKey],
      ))[0];
      if (existing) {
        if (existing.request_hash !== requestHash) {
          throw new RuntimeServiceError("CONFLICT", "Support revocation idempotency key conflicts with an existing request");
        }
        return {
          revocationId: existing.id,
          targetType: existing.target_type,
          targetId: existing.challenge_id ?? existing.session_id,
          revokedAt: existing.revoked_at.toISOString(),
          duplicate: true,
        };
      }
      if (value.targetType === "challenge") {
        if (!(await transaction.query("SELECT id FROM support_access_challenges WHERE organization_id = $1 AND id = $2 AND created_by = $3", [user.organizationId, value.challengeId, user.id]))[0]) {
          throw new RuntimeServiceError("CONFLICT", "Support challenge was not found for this tenant");
        }
      } else if (value.targetType === "session") {
        if (!(await transaction.query("SELECT id FROM support_access_sessions WHERE organization_id = $1 AND id = $2 AND client_user_id = $3", [user.organizationId, value.sessionId, user.id]))[0]) {
          throw new RuntimeServiceError("CONFLICT", "Support session was not found for this tenant");
        }
      }
      const revocationId = randomUUID();
      await transaction.query(
        [
          "INSERT INTO support_access_revocations",
          "(id, organization_id, created_by, target_type, challenge_id, session_id, idempotency_key, request_hash, revoked_at)",
          "VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)",
        ].join(" "),
        [revocationId, user.organizationId, user.id, value.targetType,
          value.targetType === "challenge" ? value.challengeId : null,
          value.targetType === "session" ? value.sessionId : null,
          value.idempotencyKey, requestHash, now],
      );
      await writeAuditEvent(transaction, {
        organizationId: user.organizationId,
        actorUserId: user.id,
        actorSubjectId: userAuditSubject(user.id),
        action: "support.access_revoked",
        entityType: "support_access_revocation",
        entityId: revocationId,
        metadata: { targetType: value.targetType, targetId },
        occurredAt: now,
      });
      return { revocationId, targetType: value.targetType, targetId, revokedAt: now.toISOString(), duplicate: false };
    });
  }

  private accountHash(accountRef: string): string {
    return keyedHash(this.secret, "account-ref", accountRef);
  }

  private bearerHash(secret: string): string {
    return keyedHash(this.secret, "bearer", secret);
  }

  private async requireActor(
    transaction: DatabaseTransaction,
    user: AuthenticatedUser,
    role: UserRole,
    lock: boolean,
  ): Promise<void> {
    const rows = await transaction.query<{ id: string }>(
      `SELECT id FROM users WHERE id = $1 AND organization_id = $2 AND role = $3 AND status = 'active'${lock ? " FOR UPDATE" : ""}`,
      [user.id, user.organizationId, role],
    );
    if (!rows[0]) deny();
  }

  private async scopes(
    transaction: DatabaseTransaction,
    id: string,
    owner: "challenge" | "session",
  ): Promise<SupportAccessScope[]> {
    const rows = await transaction.query<{ scope: SupportAccessScope }>(
      `SELECT scope FROM support_access_${owner}_scopes WHERE ${owner}_id = $1 ORDER BY scope`,
      [id],
    );
    return rows.map((row) => row.scope);
  }

  private async targetCounts(
    transaction: DatabaseTransaction,
    id: string,
    owner: "challenge" | "session",
  ): Promise<{ agentCount: number; accountCount: number }> {
    const [agents, accounts] = await Promise.all([
      transaction.query<CountRow>(`SELECT COUNT(*)::integer AS count FROM support_access_${owner}_agents WHERE ${owner}_id = $1`, [id]),
      transaction.query<CountRow>(`SELECT COUNT(*)::integer AS count FROM support_access_${owner}_accounts WHERE ${owner}_id = $1`, [id]),
    ]);
    return { agentCount: count(agents), accountCount: count(accounts) };
  }

  private async challengeResult(
    transaction: DatabaseTransaction,
    challenge: ChallengeRow,
    otp: string | null,
    duplicate: boolean,
  ): Promise<CreatedSupportChallenge> {
    return {
      challengeId: challenge.id,
      scopes: await this.scopes(transaction, challenge.id, "challenge"),
      ...await this.targetCounts(transaction, challenge.id, "challenge"),
      requestedSessionMinutes: challenge.requested_session_minutes,
      createdAt: challenge.created_at.toISOString(),
      expiresAt: challenge.expires_at.toISOString(),
      otp,
      duplicate,
    };
  }

  private async sessionResult(
    transaction: DatabaseTransaction,
    session: SessionRow,
    secret: string | null,
    duplicate: boolean,
  ): Promise<RedeemedSupportGrant> {
    return {
      sessionId: session.id,
      challengeId: session.challenge_id,
      scopes: await this.scopes(transaction, session.id, "session"),
      ...await this.targetCounts(transaction, session.id, "session"),
      staffUserId: session.staff_user_id,
      issuedAt: session.issued_at.toISOString(),
      expiresAt: session.expires_at.toISOString(),
      bearerSecret: secret,
      duplicate,
    };
  }
}

let singleton: SupportAccessRepository | undefined;

export function getSupportAccessRepository(): SupportAccessRepository {
  singleton ??= new SupportAccessRepository();
  return singleton;
}
