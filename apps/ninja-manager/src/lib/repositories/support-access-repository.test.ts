import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createDatabaseClient, type DatabaseClient, type DatabaseTransaction } from "@/lib/db/client";
import { migrateDatabase } from "@/lib/db/migrate";
import type { DeploymentMode } from "@/lib/deployment/contracts";
import { RuntimeServiceError } from "@/lib/domain/runtime-errors";
import type { AuthenticatedUser } from "@/lib/domain/types";
import { SupportAccessRepository } from "./support-access-repository";

const orgId = "10000000-0000-4000-8000-000000000001";
const otherOrgId = "10000000-0000-4000-8000-000000000002";
const clientId = "20000000-0000-4000-8000-000000000001";
const staffId = "20000000-0000-4000-8000-000000000002";
const secondStaffId = "20000000-0000-4000-8000-000000000003";
const otherClientId = "20000000-0000-4000-8000-000000000004";
const otherStaffId = "20000000-0000-4000-8000-000000000005";
const peerClientId = "20000000-0000-4000-8000-000000000006";
const agentId = "30000000-0000-4000-8000-000000000001";
const secondAgentId = "30000000-0000-4000-8000-000000000002";
const otherAgentId = "30000000-0000-4000-8000-000000000003";
const peerAgentId = "30000000-0000-4000-8000-000000000004";
const unboundAgentId = "30000000-0000-4000-8000-000000000005";
const accountRef = `acct_${"a".repeat(32)}`;
const secondAccountRef = `acct_${"b".repeat(32)}`;

const client: AuthenticatedUser = { id: clientId, organizationId: orgId, email: "client@test.local", name: "Client", role: "client" };
const staff: AuthenticatedUser = { id: staffId, organizationId: orgId, email: "staff@test.local", name: "Staff", role: "staff" };
const secondStaff: AuthenticatedUser = { id: secondStaffId, organizationId: orgId, email: "staff2@test.local", name: "Staff 2", role: "staff" };
const otherClient: AuthenticatedUser = { id: otherClientId, organizationId: otherOrgId, email: "other-client@test.local", name: "Other client", role: "client" };
const otherStaff: AuthenticatedUser = { id: otherStaffId, organizationId: otherOrgId, email: "other-staff@test.local", name: "Other staff", role: "staff" };
const peerClient: AuthenticatedUser = { id: peerClientId, organizationId: orgId, email: "peer-client@test.local", name: "Peer client", role: "client" };

let database: DatabaseClient;
let repository: SupportAccessRepository;
let now: Date;
let mode: DeploymentMode;
let randomCall: number;
let keySequence: number;

function randomSource(size: number): Buffer {
  randomCall += 1;
  const value = Buffer.alloc(size, randomCall % 255);
  if (size === 4) value.writeUInt32BE(42_424_242 + randomCall);
  return value;
}

function nextKey(label: string): string {
  keySequence += 1;
  return `support:${label}:${String(keySequence).padStart(6, "0")}`;
}

function challengeInput(options: {
  accounts?: string[];
  agent?: string;
  scopes?: Array<"eod.read" | "health.read" | "runtime.read">;
  duration?: number;
  key?: string;
} = {}) {
  return {
    scopes: options.scopes ?? ["eod.read", "runtime.read"],
    targets: [{ agentId: options.agent ?? agentId, accountRefs: options.accounts ?? [accountRef] }],
    requestedSessionMinutes: options.duration ?? 30,
    idempotencyKey: options.key ?? nextKey("create"),
  };
}

async function createChallenge(options: Parameters<typeof challengeInput>[0] = {}) {
  return repository.createChallenge(client, challengeInput(options));
}

async function redeem(challengeId: string, otp: string, key = nextKey("redeem"), actor = staff) {
  return repository.redeemChallenge(actor, { tenantId: actor.organizationId, challengeId, otp, idempotencyKey: key });
}

function repositoryFor(targetDatabase = database): SupportAccessRepository {
  return new SupportAccessRepository(targetDatabase, {
    secret: "test-support-pepper-is-at-least-32-bytes-long",
    clock: () => now,
    randomBytes: randomSource,
    mode: () => mode,
  });
}

function withFailingAuditWrites(client: DatabaseClient): DatabaseClient {
  return {
    query<T extends object>(sql: string, params?: unknown[]): Promise<T[]> { return client.query<T>(sql, params); },
    exec(sql: string): Promise<void> { return client.exec(sql); },
    close(): Promise<void> { return client.close(); },
    transaction<T>(operation: (transaction: DatabaseTransaction) => Promise<T>): Promise<T> {
      return client.transaction((transaction) => operation({
        query<TRecord extends object>(sql: string, params?: unknown[]): Promise<TRecord[]> {
          if (/INSERT\s+INTO\s+audit_events/i.test(sql)) throw new Error("injected audit failure");
          return transaction.query<TRecord>(sql, params);
        },
        exec(sql: string): Promise<void> { return transaction.exec(sql); },
      }));
    },
  };
}

beforeEach(async () => {
  now = new Date("2026-07-21T21:00:00.000Z");
  mode = "LOCAL_ONLY";
  randomCall = 0;
  keySequence = 0;
  database = createDatabaseClient(":memory:");
  await migrateDatabase(database);
  await database.query(
    "INSERT INTO organizations (id, name, slug) VALUES ($1, 'Tenant', 'tenant'), ($2, 'Other', 'other')",
    [orgId, otherOrgId],
  );
  await database.query(
    [
      "INSERT INTO users (id, organization_id, email, name, password_hash, role) VALUES",
      "($1, $6, 'client@test.local', 'Client', 'hash', 'client'),",
      "($2, $6, 'staff@test.local', 'Staff', 'hash', 'staff'),",
      "($3, $6, 'staff2@test.local', 'Staff 2', 'hash', 'staff'),",
      "($4, $7, 'other-client@test.local', 'Other client', 'hash', 'client'),",
      "($5, $7, 'other-staff@test.local', 'Other staff', 'hash', 'staff'),",
      "($8, $6, 'peer-client@test.local', 'Peer client', 'hash', 'client')",
    ].join(" "),
    [clientId, staffId, secondStaffId, otherClientId, otherStaffId, orgId, otherOrgId, peerClientId],
  );
  await database.query(
    [
      "INSERT INTO clients (id, organization_id, user_id, display_name, created_by) VALUES",
      "('client-record-1', $1, $2, 'Client', $2),",
      "('client-record-2', $1, $3, 'Peer client', $3),",
      "('client-record-3', $4, $5, 'Other client', $5)",
    ].join(" "),
    [orgId, clientId, peerClientId, otherOrgId, otherClientId],
  );
  await database.query(
    [
      "INSERT INTO environments (id, organization_id, client_id, vps_provider, vps_region, ninja_version) VALUES",
      "('environment-1', $1, 'client-record-1', 'VPS', 'east', '8.1.7.2'),",
      "('environment-2', $1, 'client-record-2', 'VPS', 'east', '8.1.7.2'),",
      "('environment-3', $2, 'client-record-3', 'VPS', 'east', '8.1.7.2')",
    ].join(" "),
    [orgId, otherOrgId],
  );
  await database.query(
    [
      "INSERT INTO agent_installations",
      "(id, organization_id, environment_id, display_name, status, agent_version, protocol_version, capabilities, created_by)",
      "VALUES ($1, $5, 'environment-1', 'Agent 1', 'online', '1.0.0', '1.0', '[]'::jsonb, $7),",
      "($2, $5, 'environment-1', 'Agent 2', 'online', '1.0.0', '1.0', '[]'::jsonb, $7),",
      "($3, $6, 'environment-3', 'Other agent', 'online', '1.0.0', '1.0', '[]'::jsonb, $8),",
      "($4, $5, 'environment-2', 'Peer agent', 'online', '1.0.0', '1.0', '[]'::jsonb, $9),",
      "($10, $5, NULL, 'Unbound agent', 'online', '1.0.0', '1.0', '[]'::jsonb, $7)",
    ].join(" "),
    [agentId, secondAgentId, otherAgentId, peerAgentId, orgId, otherOrgId, clientId, otherClientId, peerClientId, unboundAgentId],
  );
  await database.query(
    [
      "INSERT INTO runtime_account_identities",
      "(id, organization_id, agent_id, account_ref, identifier_fingerprint) VALUES",
      "('account-identity-1', $1, $2, $3, $5),",
      "('account-identity-2', $1, $2, $4, $6)",
    ].join(" "),
    [orgId, agentId, accountRef, secondAccountRef,
      `hmac-sha256:${"1".repeat(64)}`, `hmac-sha256:${"2".repeat(64)}`],
  );
  repository = repositoryFor();
});

afterEach(async () => {
  await database.close();
});

describe("SupportAccessRepository", () => {
  it("returns the OTP once while persisting only salted/keyed evidence and safe audit metadata", async () => {
    const key = nextKey("create-once");
    const created = await createChallenge({ key });
    expect(created.otp).toMatch(/^\d{8}$/);
    const replay = await repository.createChallenge(client, challengeInput({ key }));
    expect(replay).toMatchObject({ challengeId: created.challengeId, otp: null, duplicate: true });

    const persisted = JSON.stringify({
      challenges: await database.query("SELECT * FROM support_access_challenges"),
      accounts: await database.query("SELECT * FROM support_access_challenge_accounts"),
      audits: await database.query("SELECT action, metadata FROM audit_events WHERE action LIKE 'support.%'"),
    });
    expect(persisted).not.toContain(created.otp!);
    expect(persisted).not.toContain(accountRef);
    expect(persisted).toContain("hmac-sha256:");
    expect(persisted).not.toContain("bearerSecret");
  });

  it("allows client creation in both modes, rejects staff creation, and enforces enrolled authoritative targets", async () => {
    await expect(createChallenge()).resolves.toMatchObject({ duplicate: false });
    mode = "CENTRAL_CONNECTED";
    await expect(createChallenge()).resolves.toMatchObject({ duplicate: false });
    await expect(repository.createChallenge(staff, challengeInput())).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(repository.createChallenge(otherClient, challengeInput({ agent: agentId }))).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(repository.createChallenge(client, challengeInput({ agent: peerAgentId, accounts: [] }))).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(repository.createChallenge(client, challengeInput({ agent: unboundAgentId, accounts: [] }))).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(repository.createChallenge(peerClient, challengeInput({ agent: peerAgentId, accounts: [] }))).resolves.toMatchObject({ agentCount: 1 });
    await expect(createChallenge({ accounts: [`acct_${"c".repeat(32)}`] })).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("redeems only once for CENTRAL authenticated staff and returns the bearer once", async () => {
    const challenge = await createChallenge();
    await expect(redeem(challenge.challengeId, challenge.otp!)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    mode = "CENTRAL_CONNECTED";
    await expect(repository.redeemChallenge(client, {
      tenantId: orgId, challengeId: challenge.challengeId, otp: challenge.otp, idempotencyKey: nextKey("client-redeem"),
    })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    const key = nextKey("once");
    const redeemed = await redeem(challenge.challengeId, challenge.otp!, key);
    expect(redeemed.bearerSecret).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const replay = await redeem(challenge.challengeId, challenge.otp!, key);
    expect(replay).toMatchObject({ sessionId: redeemed.sessionId, bearerSecret: null, duplicate: true });
    await expect(redeem(challenge.challengeId, challenge.otp!)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    const stored = JSON.stringify(await database.query("SELECT * FROM support_access_sessions"));
    expect(stored).not.toContain(redeemed.bearerSecret!);
    expect(stored).toContain("hmac-sha256:");
  });

  it("uses one generic denial for unknown and wrong OTP paths and locks after five failures", async () => {
    mode = "CENTRAL_CONNECTED";
    const challenge = await createChallenge();
    const unknown = redeem("50000000-0000-4000-8000-000000000099", "11111111").catch((error: unknown) => error);
    const wrong = redeem(challenge.challengeId, "11111111").catch((error: unknown) => error);
    const [unknownError, wrongError] = await Promise.all([unknown, wrong]);
    expect(unknownError).toBeInstanceOf(RuntimeServiceError);
    expect(wrongError).toBeInstanceOf(RuntimeServiceError);
    const unknownSupportError = unknownError as RuntimeServiceError;
    const wrongSupportError = wrongError as RuntimeServiceError;
    expect({ code: unknownSupportError.code, message: unknownSupportError.message })
      .toEqual({ code: wrongSupportError.code, message: wrongSupportError.message });
    for (let attempt = 2; attempt <= 5; attempt += 1) {
      await expect(redeem(challenge.challengeId, String(attempt).padStart(8, "1"))).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    }
    expect(await database.query("SELECT id FROM support_access_attempts WHERE challenge_id = $1 AND outcome = 'invalid'", [challenge.challengeId])).toHaveLength(5);
    await expect(redeem(challenge.challengeId, challenge.otp!)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("rejects expired OTPs and expired sessions using the injected server clock", async () => {
    mode = "CENTRAL_CONNECTED";
    const expiredChallenge = await createChallenge();
    now = new Date(now.getTime() + 10 * 60_000 + 1);
    await expect(redeem(expiredChallenge.challengeId, expiredChallenge.otp!)).rejects.toMatchObject({ code: "UNAUTHORIZED" });

    now = new Date("2026-07-21T22:00:00.000Z");
    const challenge = await createChallenge({ duration: 5 });
    const session = await redeem(challenge.challengeId, challenge.otp!);
    now = new Date(now.getTime() + 5 * 60_000 + 1);
    await expect(repository.validateGrant(staff, {
      tenantId: orgId, bearerSecret: session.bearerSecret, scope: "runtime.read", agentId, accountRef,
    })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("binds validation to the exact staff, tenant, read scope, agent, account, and token", async () => {
    mode = "CENTRAL_CONNECTED";
    const challenge = await createChallenge();
    const session = await redeem(challenge.challengeId, challenge.otp!);
    const valid = { tenantId: orgId, bearerSecret: session.bearerSecret!, scope: "runtime.read" as const, agentId, accountRef };
    await expect(repository.validateGrant(staff, valid)).resolves.toMatchObject({ sessionId: session.sessionId, accountRestricted: true });
    for (const [actor, input] of [
      [secondStaff, valid],
      [staff, { ...valid, tenantId: otherOrgId }],
      [staff, { ...valid, scope: "health.read" }],
      [staff, { ...valid, agentId: secondAgentId }],
      [staff, { ...valid, accountRef: secondAccountRef }],
      [staff, { ...valid, accountRef: undefined }],
      [staff, { ...valid, bearerSecret: "x".repeat(43) }],
      [otherStaff, { ...valid, tenantId: otherOrgId }],
    ] as const) {
      await expect(repository.validateGrant(actor, input)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    }
    expect(await database.query("SELECT id FROM support_access_events WHERE session_id = $1", [session.sessionId])).toHaveLength(1);
  });

  it("treats an omitted account list as exact agent-level access, never an account wildcard", async () => {
    mode = "CENTRAL_CONNECTED";
    const challenge = await createChallenge({ accounts: [], scopes: ["health.read"] });
    const session = await redeem(challenge.challengeId, challenge.otp!);
    const base = { tenantId: orgId, bearerSecret: session.bearerSecret!, scope: "health.read" as const, agentId };
    await expect(repository.validateGrant(staff, base)).resolves.toMatchObject({ accountRestricted: false });
    await expect(repository.validateGrant(staff, { ...base, accountRef })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("lets only the client revoke a challenge, a session, or all existing tenant sessions", async () => {
    mode = "CENTRAL_CONNECTED";
    const pending = await createChallenge();
    await expect(repository.revoke(staff, {
      targetType: "challenge", challengeId: pending.challengeId, idempotencyKey: nextKey("staff-revoke"),
    })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await repository.revoke(client, { targetType: "challenge", challengeId: pending.challengeId, idempotencyKey: nextKey("challenge-revoke") });
    await expect(redeem(pending.challengeId, pending.otp!)).rejects.toMatchObject({ code: "UNAUTHORIZED" });

    const challenge = await createChallenge();
    const session = await redeem(challenge.challengeId, challenge.otp!);
    const validate = { tenantId: orgId, bearerSecret: session.bearerSecret!, scope: "runtime.read" as const, agentId, accountRef };
    await repository.revoke(client, { targetType: "session", sessionId: session.sessionId, idempotencyKey: nextKey("session-revoke") });
    await expect(repository.validateGrant(staff, validate)).rejects.toMatchObject({ code: "UNAUTHORIZED" });

    const challenge2 = await createChallenge();
    const session2 = await redeem(challenge2.challengeId, challenge2.otp!);
    await repository.revoke(client, { targetType: "tenant_sessions", idempotencyKey: nextKey("all-revoke") });
    await expect(repository.validateGrant(staff, { ...validate, bearerSecret: session2.bearerSecret! })).rejects.toMatchObject({ code: "UNAUTHORIZED" });

    now = new Date(now.getTime() + 1);
    const challenge3 = await createChallenge();
    const session3 = await redeem(challenge3.challengeId, challenge3.otp!);
    await expect(repository.validateGrant(staff, { ...validate, bearerSecret: session3.bearerSecret! })).resolves.toBeDefined();

    const peerChallenge = await repository.createChallenge(peerClient, challengeInput({ agent: peerAgentId, accounts: [], scopes: ["health.read"] }));
    const peerSession = await redeem(peerChallenge.challengeId, peerChallenge.otp!);
    await expect(repository.revoke(peerClient, {
      targetType: "session", sessionId: session3.sessionId, idempotencyKey: nextKey("peer-cross-revoke"),
    })).rejects.toMatchObject({ code: "CONFLICT" });
    await repository.revoke(peerClient, { targetType: "tenant_sessions", idempotencyKey: nextKey("peer-all-revoke") });
    await expect(repository.validateGrant(staff, {
      tenantId: orgId, bearerSecret: peerSession.bearerSecret, scope: "health.read", agentId: peerAgentId,
    })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(repository.validateGrant(staff, { ...validate, bearerSecret: session3.bearerSecret! })).resolves.toBeDefined();
  });

  it("rolls back create, redeem, validation, and revocation if canonical audit persistence fails", async () => {
    const failing = repositoryFor(withFailingAuditWrites(database));
    await expect(failing.createChallenge(client, challengeInput())).rejects.toThrow("injected audit failure");
    expect(await database.query("SELECT id FROM support_access_challenges")).toHaveLength(0);

    const challenge = await createChallenge();
    mode = "CENTRAL_CONNECTED";
    await expect(failing.redeemChallenge(staff, {
      tenantId: orgId, challengeId: challenge.challengeId, otp: challenge.otp, idempotencyKey: nextKey("failing-redeem"),
    })).rejects.toThrow("injected audit failure");
    expect(await database.query("SELECT id FROM support_access_sessions")).toHaveLength(0);
    expect(await database.query("SELECT id FROM support_access_redemptions")).toHaveLength(0);

    const session = await redeem(challenge.challengeId, challenge.otp!);
    await expect(failing.validateGrant(staff, {
      tenantId: orgId, bearerSecret: session.bearerSecret, scope: "runtime.read", agentId, accountRef,
    })).rejects.toThrow("injected audit failure");
    expect(await database.query("SELECT id FROM support_access_events")).toHaveLength(0);
    await expect(failing.revoke(client, {
      targetType: "session", sessionId: session.sessionId, idempotencyKey: nextKey("failing-revoke"),
    })).rejects.toThrow("injected audit failure");
    expect(await database.query("SELECT id FROM support_access_revocations")).toHaveLength(0);
  });

  it("enforces append-only evidence, tenant foreign keys, rate limits, and the fresh migration chain", async () => {
    const challenge = await createChallenge();
    await expect(database.query("UPDATE support_access_challenges SET expires_at = expires_at + interval '1 minute' WHERE id = $1", [challenge.challengeId])).rejects.toThrow(/append-only/);
    await expect(database.query("DELETE FROM support_access_challenges WHERE id = $1", [challenge.challengeId])).rejects.toThrow(/append-only/);
    await expect(database.query(
      "INSERT INTO support_access_challenge_agents (organization_id, challenge_id, agent_id) VALUES ($1, $2, $3)",
      [orgId, challenge.challengeId, otherAgentId],
    )).rejects.toThrow();
    for (let index = 0; index < 4; index += 1) await createChallenge();
    await expect(createChallenge()).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await database.query("SELECT filename FROM schema_migrations WHERE filename = '0013_support_otp_grants.sql'")).toHaveLength(1);
  });

  it("database-binds sessions and access events to the exact redeemed grant evidence", async () => {
    mode = "CENTRAL_CONNECTED";
    const firstChallenge = await createChallenge();
    const firstSession = await redeem(firstChallenge.challengeId, firstChallenge.otp!);
    const secondChallenge = await createChallenge();
    const secondSession = await redeem(secondChallenge.challengeId, secondChallenge.otp!);
    const [secondRedemption] = await database.query<{ redemption_id: string }>(
      "SELECT redemption_id FROM support_access_sessions WHERE id = $1",
      [secondSession.sessionId],
    );

    await expect(database.query(
      [
        "INSERT INTO support_access_sessions",
        "(id, organization_id, challenge_id, redemption_id, staff_user_id, client_user_id, bearer_hash, issued_at, expires_at)",
        "VALUES ('50000000-0000-4000-8000-000000000099', $1, $2, $3, $4, $5, $6, $7, $8)",
      ].join(" "),
      [orgId, firstChallenge.challengeId, secondRedemption.redemption_id, staffId, clientId,
        `hmac-sha256:${"f".repeat(64)}`, now, new Date(now.getTime() + 5 * 60_000)],
    )).rejects.toThrow();

    await expect(database.query(
      "INSERT INTO support_access_events (id, organization_id, session_id, staff_user_id, scope, agent_id, account_ref_hash, accessed_at) VALUES ('event-wrong-scope', $1, $2, $3, 'health.read', $4, NULL, $5)",
      [orgId, firstSession.sessionId, staffId, agentId, now],
    )).rejects.toThrow();
    await expect(database.query(
      "INSERT INTO support_access_events (id, organization_id, session_id, staff_user_id, scope, agent_id, account_ref_hash, accessed_at) VALUES ('event-wrong-agent', $1, $2, $3, 'runtime.read', $4, NULL, $5)",
      [orgId, firstSession.sessionId, staffId, secondAgentId, now],
    )).rejects.toThrow();
    await expect(database.query(
      "INSERT INTO support_access_events (id, organization_id, session_id, staff_user_id, scope, agent_id, account_ref_hash, accessed_at) VALUES ('event-wrong-staff', $1, $2, $3, 'runtime.read', $4, NULL, $5)",
      [orgId, firstSession.sessionId, secondStaffId, agentId, now],
    )).rejects.toThrow();
    await expect(database.query(
      "INSERT INTO support_access_events (id, organization_id, session_id, staff_user_id, scope, agent_id, account_ref_hash, accessed_at) VALUES ('event-wrong-account', $1, $2, $3, 'runtime.read', $4, $5, $6)",
      [orgId, firstSession.sessionId, staffId, agentId, `hmac-sha256:${"e".repeat(64)}`, now],
    )).rejects.toThrow();

    await expect(database.query(
      "INSERT INTO support_access_attempts (id, organization_id, challenge_id, staff_user_id, outcome, failed_attempt_number, occurred_at) VALUES ('second-accepted-attempt', $1, $2, $3, 'accepted', NULL, $4)",
      [orgId, firstChallenge.challengeId, secondStaffId, now],
    )).rejects.toThrow();
    expect(await database.query(
      "SELECT id FROM support_access_attempts WHERE challenge_id = $1 AND outcome = 'accepted'",
      [firstChallenge.challengeId],
    )).toHaveLength(1);
  });

  it("fails construction for a missing or short cryptographic pepper", () => {
    expect(() => new SupportAccessRepository(database, { secret: "short", mode: () => mode })).toThrow(/at least 32 bytes/);
  });
});
