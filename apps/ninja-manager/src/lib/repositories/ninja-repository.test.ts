import { beforeEach, describe, expect, it } from "vitest";

import { createDatabaseClient, type DatabaseClient, type DatabaseTransaction } from "@/lib/db/client";
import { migrateDatabase } from "@/lib/db/migrate";
import { auditEvidenceHash } from "@/lib/domain/audit-evidence";
import type { AuthenticatedUser } from "@/lib/domain/types";
import {
  EmailIdentityConflictError,
  IdempotencyConflictError,
  NinjaRepository,
} from "./ninja-repository";

const ids = {
  org: "10000000-0000-4000-8000-000000000001",
  otherOrg: "10000000-0000-4000-8000-000000000002",
  staff: "20000000-0000-4000-8000-000000000001",
  clientUser: "30000000-0000-4000-8000-000000000001",
  client: "40000000-0000-4000-8000-000000000001",
  otherStaff: "20000000-0000-4000-8000-000000000002",
};

const staff: AuthenticatedUser = { id: ids.staff, organizationId: ids.org, email: "staff@test.local", name: "Staff User", role: "staff" };
const clientUser: AuthenticatedUser = { id: ids.clientUser, organizationId: ids.org, email: "client@test.local", name: "Client User", role: "client" };
const otherStaff: AuthenticatedUser = { id: ids.otherStaff, organizationId: ids.otherOrg, email: "other@test.local", name: "Other Staff", role: "staff" };

let database: DatabaseClient;
let repository: NinjaRepository;
let requestSequence: number;

function nextRequestId(): string {
  requestSequence += 1;
  return `90000000-0000-4000-8000-${String(requestSequence).padStart(12, "0")}`;
}

const accountInput = {
  provider: "Apex",
  label: "Evaluation",
  accountIdentifier: "ABC12345",
  accountSize: 50_000,
  ruleProfile: "Trailing drawdown",
  vpsProvider: "Vultr",
  vpsRegion: "New Jersey",
  ninjaVersion: "8.1",
};

const questionnaire = {
  objective: "preserve" as const,
  experience: "new" as const,
  drawdownComfort: "low" as const,
  automationLevel: "guided" as const,
  tradingWindow: "morning" as const,
};

function withFailingAuditWrites(client: DatabaseClient): DatabaseClient {
  return {
    query<T extends object>(sql: string, params?: unknown[]): Promise<T[]> {
      return client.query<T>(sql, params);
    },
    exec(sql: string): Promise<void> {
      return client.exec(sql);
    },
    transaction<T>(operation: (transaction: DatabaseTransaction) => Promise<T>): Promise<T> {
      return client.transaction((transaction) => operation({
        query<TRecord extends object>(sql: string, params?: unknown[]): Promise<TRecord[]> {
          if (/INSERT\s+INTO\s+audit_events/i.test(sql)) {
            throw new Error("injected audit write failure");
          }
          return transaction.query<TRecord>(sql, params);
        },
        exec(sql: string): Promise<void> {
          return transaction.exec(sql);
        },
      }));
    },
    close(): Promise<void> {
      return client.close();
    },
  };
}

async function seedTestData() {
  await database.query("INSERT INTO organizations (id, name, slug) VALUES ($1, 'Test Vincere', 'test-vincere'), ($2, 'Other Org', 'other-org')", [ids.org, ids.otherOrg]);
  await database.query(`
    INSERT INTO users (id, organization_id, email, name, password_hash, role) VALUES
      ($1, $4, 'staff@test.local', 'Staff User', 'hash', 'staff'),
      ($2, $4, 'client@test.local', 'Client User', 'hash', 'client'),
      ($3, $5, 'other@test.local', 'Other Staff', 'hash', 'staff')
  `, [ids.staff, ids.clientUser, ids.otherStaff, ids.org, ids.otherOrg]);
  await database.query("INSERT INTO clients (id, organization_id, user_id, display_name, timezone, created_by) VALUES ($1, $2, $3, 'Client User', 'America/New_York', $4)", [ids.client, ids.org, ids.clientUser, ids.staff]);
  await database.query(`
    INSERT INTO strategies (id, organization_id, slug, name, description, risk_level, approved) VALUES
      ('70000000-0000-4000-8000-000000000001', $1, 'vincere-steady', 'Vincere Steady', 'Controlled', 'conservative', true),
      ('70000000-0000-4000-8000-000000000002', $1, 'vincere-balanced', 'Vincere Balanced', 'Measured', 'balanced', true)
  `, [ids.org]);
}

beforeEach(async () => {
  requestSequence = 0;
  database = createDatabaseClient(":memory:");
  await migrateDatabase(database);
  await seedTestData();
  repository = new NinjaRepository(database);
});

describe("NinjaRepository golden path", () => {
  it("fails LOCAL_ONLY operator selection closed when more than one client is active", async () => {
    await expect(repository.findLocalOperatorUser()).resolves.toMatchObject({ id: ids.clientUser });
    const peerUserId = "30000000-0000-4000-8000-000000000002";
    const peerClientId = "40000000-0000-4000-8000-000000000002";
    await database.query(
      "INSERT INTO users (id, organization_id, email, name, password_hash, role) VALUES ($1, $2, 'peer@test.local', 'Peer', 'hash', 'client')",
      [peerUserId, ids.org],
    );
    await database.query(
      "INSERT INTO clients (id, organization_id, user_id, display_name, created_by) VALUES ($1, $2, $3, 'Peer', $4)",
      [peerClientId, ids.org, peerUserId, ids.staff],
    );
    await expect(repository.findLocalOperatorUser()).resolves.toBeNull();
  });

  it("completes setup, approval, deployment, incident resolution, and audit", async () => {
    await repository.completeOnboarding(clientUser, "555-0100", "America/Chicago", nextRequestId());
    await repository.addAccountAndEnvironment(clientUser, {
      provider: "Apex", label: "Evaluation", accountIdentifier: "ABC12345", accountSize: 50_000,
      ruleProfile: "Trailing drawdown", vpsProvider: "Vultr", vpsRegion: "New Jersey", ninjaVersion: "8.1",
    }, nextRequestId());
    await repository.createStrategyRecommendation(clientUser, {
      objective: "consistent", experience: "new", drawdownComfort: "low", automationLevel: "guided", tradingWindow: "morning",
    }, nextRequestId());

    const [approval] = await repository.listApprovals(staff);
    expect(approval.status).toBe("pending");
    await repository.reviewApproval(staff, approval.id, "approved", "Sizing and kill switch verified", nextRequestId());

    const [approved] = await repository.getConfigurations(ids.client, ids.org);
    expect(approved.status).toBe("approved");
    await repository.recordDeployment(clientUser, approved.id, nextRequestId());
    expect((await repository.getConfigurations(ids.client, ids.org))[0].status).toBe("deployment_recorded");

    const incidentId = await repository.simulateHealthFailure(clientUser, undefined, nextRequestId());
    let [incident] = await repository.listIncidents(clientUser, ids.client);
    expect(incident.id).toBe(incidentId);
    expect(incident.status).toBe("open");
    await repository.updateIncident(staff, incidentId, "advance", nextRequestId());
    await repository.updateIncident(staff, incidentId, "resolve", nextRequestId());
    [incident] = await repository.listIncidents(clientUser, ids.client);
    expect(incident.status).toBe("resolved");

    const audit = await repository.listAudit(staff);
    expect(audit.map((event) => event.action)).toEqual(expect.arrayContaining([
      "onboarding.completed", "environment.registered", "strategy.approval_requested", "strategy.approved",
      "deployment.recorded", "incident.simulated", "incident.resolved",
    ]));

    const clientAudit = await repository.listAudit(clientUser, ids.client);
    expect(clientAudit.map((event) => event.action)).toEqual(expect.arrayContaining([
      "onboarding.completed", "environment.registered", "strategy.approval_requested", "strategy.approved",
      "deployment.recorded", "incident.simulated", "incident.resolved",
    ]));

    const evidenceRows = await database.query<{
      id: string;
      organization_id: string;
      actor_user_id: string;
      actor_subject_id: string;
      action: string;
      entity_type: string;
      entity_id: string;
      metadata: Record<string, unknown>;
      event_version: number;
      evidence_hash: string;
      origin_installation_id: string | null;
      legacy_unverified: boolean;
      created_at: Date;
    }>("SELECT id, organization_id, actor_user_id, actor_subject_id, action, entity_type, entity_id, metadata, event_version, evidence_hash, origin_installation_id, legacy_unverified, created_at FROM audit_events");
    expect(evidenceRows.length).toBeGreaterThan(0);
    for (const event of evidenceRows) {
      expect(event.legacy_unverified).toBe(false);
      expect(event.evidence_hash).toBe(auditEvidenceHash({
        action: event.action,
        actorSubjectId: event.actor_subject_id,
        entityId: event.entity_id,
        entityType: event.entity_type,
        eventId: event.id,
        eventVersion: event.event_version,
        metadata: event.metadata,
        occurredAt: new Date(event.created_at).toISOString(),
        organizationId: event.organization_id,
        originInstallationId: event.origin_installation_id,
      }));
    }
  });

  it("enforces organization isolation on client listings and approvals", async () => {
    expect(await repository.listClients(otherStaff)).toHaveLength(0);
    await repository.addAccountAndEnvironment(clientUser, {
      provider: "Apex", label: "Evaluation", accountIdentifier: "ABC12345", accountSize: 50_000,
      ruleProfile: "Trailing drawdown", vpsProvider: "Vultr", vpsRegion: "New Jersey", ninjaVersion: "8.1",
    }, nextRequestId());
    await repository.createStrategyRecommendation(clientUser, {
      objective: "preserve", experience: "new", drawdownComfort: "low", automationLevel: "guided", tradingWindow: "morning",
    }, nextRequestId());
    const [approval] = await repository.listApprovals(staff);
    await expect(repository.reviewApproval(otherStaff, approval.id, "approved", undefined, nextRequestId())).rejects.toThrow("Pending approval not found");
  });

  it("creates clients, manages sessions, and audits the global kill switch", async () => {
    const createdId = await repository.createClient(staff, {
      name: "New Client", email: "new@example.com", phone: "555-0199",
      timezone: "America/New_York", temporaryPassword: "StrongPassword!2026",
    }, nextRequestId());
    expect((await repository.listClients(staff)).some((client) => client.id === createdId)).toBe(true);
    await repository.setClientAccess(staff, createdId, false, nextRequestId());
    expect((await repository.listClients(staff)).find((client) => client.id === createdId)?.user_status).toBe("disabled");
    await expect(repository.setClientAccess(otherStaff, createdId, false, nextRequestId())).rejects.toThrow("Client not found");
    const found = await repository.findUserByEmail("NEW@example.com");
    expect(found?.role).toBe("client");
    await repository.createSession(ids.staff, "token-hash", new Date(Date.now() + 60_000));
    expect((await repository.findUserBySessionHash("token-hash"))?.id).toBe(ids.staff);
    await repository.deleteSession("token-hash");
    expect(await repository.findUserBySessionHash("token-hash")).toBeNull();

    expect(await repository.getKillSwitch(ids.org)).toBe(false);
    await repository.setKillSwitch(staff, true, nextRequestId());
    expect(await repository.getKillSwitch(ids.org)).toBe(true);
    await repository.setKillSwitch(staff, false, nextRequestId());
    expect(await repository.getKillSwitch(ids.org)).toBe(false);
    expect((await repository.listAudit(staff)).map((event) => event.action)).toEqual(expect.arrayContaining([
      "kill_switch.enabled",
      "kill_switch.disabled",
    ]));
  });

  it("keeps email identity globally unique across organizations", async () => {
    const before = await database.query("SELECT id FROM users");
    await expect(repository.createClient(otherStaff, {
      name: "Conflicting Client",
      email: "CLIENT@TEST.LOCAL",
      timezone: "America/New_York",
      temporaryPassword: "StrongPassword!2026",
    }, nextRequestId())).rejects.toBeInstanceOf(EmailIdentityConflictError);
    expect(await database.query("SELECT id FROM users")).toHaveLength(before.length);
    expect(await repository.findUserByEmail("client@test.local")).toMatchObject({ id: ids.clientUser });
  });

  it("rolls back a kill-switch change when audit evidence cannot be recorded", async () => {
    const missingActor = { ...staff, id: "20000000-0000-4000-8000-000000000099" };

    await expect(repository.setKillSwitch(missingActor, true, nextRequestId())).rejects.toThrow();

    expect(await repository.getKillSwitch(ids.org)).toBe(false);
    expect((await repository.listAudit(staff)).some((event) => event.action === "kill_switch.enabled")).toBe(false);
  });

  it("rolls back every business mutation when its audit evidence cannot be recorded", async () => {
    const failingRepository = new NinjaRepository(withFailingAuditWrites(database));
    const auditCount = async () => Number((await database.query<{ count: number }>("SELECT COUNT(*)::int AS count FROM audit_events"))[0].count);
    const expectAtomicRollback = async (operation: () => Promise<unknown>, verify: () => Promise<void>) => {
      const before = await auditCount();
      const beforeKeys = Number((await database.query<{ count: number }>("SELECT COUNT(*)::int AS count FROM idempotency_keys"))[0].count);
      await expect(operation()).rejects.toThrow("injected audit write failure");
      await verify();
      expect(await auditCount()).toBe(before);
      expect(Number((await database.query<{ count: number }>("SELECT COUNT(*)::int AS count FROM idempotency_keys"))[0].count)).toBe(beforeKeys);
    };

    await expectAtomicRollback(
      () => failingRepository.createClient(staff, {
        name: "Atomic Client",
        email: "atomic@example.com",
        timezone: "America/New_York",
        temporaryPassword: "StrongPassword!2026",
      }, nextRequestId()),
      async () => {
        expect(await database.query("SELECT id FROM users WHERE email = 'atomic@example.com'")).toHaveLength(0);
        expect(await database.query("SELECT id FROM clients WHERE display_name = 'Atomic Client'")).toHaveLength(0);
      },
    );

    await expectAtomicRollback(
      () => failingRepository.completeOnboarding(clientUser, "555-0100", "America/Chicago", nextRequestId()),
      async () => {
        const [client] = await database.query<{ phone: string | null; timezone: string; onboarding_status: string }>("SELECT phone, timezone, onboarding_status FROM clients WHERE id = $1", [ids.client]);
        expect(client).toMatchObject({ phone: null, timezone: "America/New_York", onboarding_status: "invited" });
      },
    );

    await expectAtomicRollback(
      () => failingRepository.setClientAccess(staff, ids.client, false, nextRequestId()),
      async () => {
        expect((await database.query<{ status: string }>("SELECT status FROM users WHERE id = $1", [ids.clientUser]))[0].status).toBe("active");
      },
    );

    await expectAtomicRollback(
      () => failingRepository.addAccountAndEnvironment(clientUser, accountInput, nextRequestId()),
      async () => {
        expect(await database.query("SELECT id FROM trading_accounts")).toHaveLength(0);
        expect(await database.query("SELECT id FROM environments")).toHaveLength(0);
      },
    );

    await repository.addAccountAndEnvironment(clientUser, accountInput, nextRequestId());
    await expectAtomicRollback(
      () => failingRepository.createStrategyRecommendation(clientUser, questionnaire, nextRequestId()),
      async () => {
        expect(await database.query("SELECT id FROM strategy_configurations")).toHaveLength(0);
        expect(await database.query("SELECT id FROM approvals")).toHaveLength(0);
      },
    );

    const configurationId = await repository.createStrategyRecommendation(clientUser, questionnaire, nextRequestId());
    const [approval] = await repository.listApprovals(staff);
    await expectAtomicRollback(
      () => failingRepository.reviewApproval(staff, approval.id, "approved", "atomic review", nextRequestId()),
      async () => {
        expect((await database.query<{ status: string }>("SELECT status FROM approvals WHERE id = $1", [approval.id]))[0].status).toBe("pending");
        expect((await database.query<{ status: string }>("SELECT status FROM strategy_configurations WHERE id = $1", [configurationId]))[0].status).toBe("pending_approval");
      },
    );

    await repository.reviewApproval(staff, approval.id, "approved", "normal review", nextRequestId());
    await expectAtomicRollback(
      () => failingRepository.recordDeployment(clientUser, configurationId, nextRequestId()),
      async () => {
        expect((await database.query<{ status: string }>("SELECT status FROM strategy_configurations WHERE id = $1", [configurationId]))[0].status).toBe("approved");
      },
    );

    await expectAtomicRollback(
      () => failingRepository.simulateHealthFailure(clientUser, undefined, nextRequestId()),
      async () => {
        expect((await database.query<{ connection_status: string }>("SELECT connection_status FROM environments"))[0].connection_status).toBe("healthy");
        expect(await database.query("SELECT id FROM health_checks")).toHaveLength(0);
        expect(await database.query("SELECT id FROM incidents")).toHaveLength(0);
      },
    );

    const incidentId = await repository.simulateHealthFailure(clientUser, undefined, nextRequestId());
    await expectAtomicRollback(
      () => failingRepository.updateIncident(staff, incidentId, "advance", nextRequestId()),
      async () => {
        const [incident] = await database.query<{ current_step: number; status: string }>("SELECT current_step, status FROM incidents WHERE id = $1", [incidentId]);
        expect(incident).toMatchObject({ current_step: 0, status: "open" });
      },
    );
  });

  it("replays identical product requests once and conflicts on changed input", async () => {
    const accountRequestId = nextRequestId();
    await repository.addAccountAndEnvironment(clientUser, accountInput, accountRequestId);
    await repository.addAccountAndEnvironment(clientUser, accountInput, accountRequestId);
    expect(await database.query("SELECT id FROM trading_accounts")).toHaveLength(1);
    expect(await database.query("SELECT id FROM environments")).toHaveLength(1);
    expect(await database.query("SELECT id FROM audit_events WHERE action = 'environment.registered'")).toHaveLength(1);
    await expect(repository.addAccountAndEnvironment(
      clientUser,
      { ...accountInput, label: "Changed evaluation" },
      accountRequestId,
    )).rejects.toBeInstanceOf(IdempotencyConflictError);

    const simulationRequestId = nextRequestId();
    const firstIncident = await repository.simulateHealthFailure(clientUser, undefined, simulationRequestId);
    const replayedIncident = await repository.simulateHealthFailure(clientUser, undefined, simulationRequestId);
    expect(replayedIncident).toBe(firstIncident);
    expect(await database.query("SELECT id FROM incidents")).toHaveLength(1);

    const advanceRequestId = nextRequestId();
    await repository.updateIncident(staff, firstIncident, "advance", advanceRequestId);
    await repository.updateIncident(staff, firstIncident, "advance", advanceRequestId);
    const [incident] = await database.query<{ current_step: number }>("SELECT current_step FROM incidents WHERE id = $1", [firstIncident]);
    expect(incident.current_step).toBe(1);
    expect(await database.query("SELECT id FROM audit_events WHERE entity_id = $1 AND action = 'incident.investigating'", [firstIncident])).toHaveLength(1);
  });

  it("replays sensitive client creation only when the submitted password still matches", async () => {
    const requestId = nextRequestId();
    const input = {
      name: "Replay Client",
      email: "replay@example.com",
      timezone: "America/New_York",
      temporaryPassword: "StrongPassword!2026",
    };
    const first = await repository.createClient(staff, input, requestId);
    const replay = await repository.createClient(staff, input, requestId);
    expect(replay).toBe(first);
    expect(await database.query("SELECT id FROM clients WHERE id = $1", [first])).toHaveLength(1);
    await expect(repository.createClient(
      staff,
      { ...input, temporaryPassword: "DifferentPassword!2026" },
      requestId,
    )).rejects.toBeInstanceOf(IdempotencyConflictError);
  });

  it("coalesces concurrent identical recommendations into one cached result", async () => {
    await repository.addAccountAndEnvironment(clientUser, accountInput, nextRequestId());
    const requestId = nextRequestId();
    const [first, replay] = await Promise.all([
      repository.createStrategyRecommendation(clientUser, questionnaire, requestId),
      repository.createStrategyRecommendation(clientUser, questionnaire, requestId),
    ]);
    expect(replay).toBe(first);
    expect(await database.query("SELECT id FROM strategy_configurations")).toHaveLength(1);
    expect(await database.query("SELECT id FROM approvals")).toHaveLength(1);
    expect(await database.query("SELECT id FROM audit_events WHERE action = 'strategy.approval_requested'")).toHaveLength(1);
  });

  it("allows exactly one concurrent approval decision and one matching audit event", async () => {
    await repository.addAccountAndEnvironment(clientUser, accountInput, nextRequestId());
    const configurationId = await repository.createStrategyRecommendation(clientUser, questionnaire, nextRequestId());
    const [approval] = await repository.listApprovals(staff);

    const decisions = await Promise.allSettled([
      repository.reviewApproval(staff, approval.id, "approved", "approve race", nextRequestId()),
      repository.reviewApproval(staff, approval.id, "rejected", "reject race", nextRequestId()),
    ]);
    expect(decisions.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(decisions.filter((result) => result.status === "rejected")).toHaveLength(1);

    const [configuration] = await database.query<{ status: string }>("SELECT status FROM strategy_configurations WHERE id = $1", [configurationId]);
    const decisionEvents = await database.query<{ action: string }>(
      "SELECT action FROM audit_events WHERE entity_id = $1 AND action IN ('strategy.approved', 'strategy.rejected')",
      [configurationId],
    );
    expect(decisionEvents).toHaveLength(1);
    expect(decisionEvents[0].action).toBe(`strategy.${configuration.status}`);
  });

  it("allocates monotonic recommendation versions and incident steps under concurrent calls", async () => {
    await repository.addAccountAndEnvironment(clientUser, accountInput, nextRequestId());
    await Promise.all([
      repository.createStrategyRecommendation(clientUser, questionnaire, nextRequestId()),
      repository.createStrategyRecommendation(clientUser, { ...questionnaire, objective: "consistent" }, nextRequestId()),
    ]);
    const configurations = await repository.getConfigurations(ids.client, ids.org);
    expect(configurations.map((configuration) => configuration.version).sort()).toEqual([1, 2]);

    const incidentId = await repository.simulateHealthFailure(clientUser, undefined, nextRequestId());
    await Promise.all([
      repository.updateIncident(staff, incidentId, "advance", nextRequestId()),
      repository.updateIncident(staff, incidentId, "advance", nextRequestId()),
    ]);
    const [advanced] = await database.query<{ current_step: number; status: string }>("SELECT current_step, status FROM incidents WHERE id = $1", [incidentId]);
    expect(advanced).toMatchObject({ current_step: 2, status: "investigating" });
    const stepEvents = await database.query<{ metadata: { currentStep: number } }>(
      "SELECT metadata FROM audit_events WHERE entity_id = $1 AND action = 'incident.investigating' ORDER BY created_at",
      [incidentId],
    );
    expect(stepEvents.map((event) => event.metadata.currentStep).sort()).toEqual([1, 2]);

    const resolutions = await Promise.allSettled([
      repository.updateIncident(staff, incidentId, "resolve", nextRequestId()),
      repository.updateIncident(staff, incidentId, "resolve", nextRequestId()),
    ]);
    expect(resolutions.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(resolutions.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(await database.query("SELECT id FROM audit_events WHERE entity_id = $1 AND action = 'incident.resolved'", [incidentId])).toHaveLength(1);
  });

  it("refuses deployment before staff approval", async () => {
    await repository.addAccountAndEnvironment(clientUser, {
      provider: "Apex", label: "Evaluation", accountIdentifier: "ABC12345", accountSize: 50_000,
      ruleProfile: "Trailing drawdown", vpsProvider: "Vultr", vpsRegion: "New Jersey", ninjaVersion: "8.1",
    }, nextRequestId());
    const configurationId = await repository.createStrategyRecommendation(clientUser, {
      objective: "preserve", experience: "new", drawdownComfort: "low", automationLevel: "guided", tradingWindow: "morning",
    }, nextRequestId());
    await expect(repository.recordDeployment(clientUser, configurationId, nextRequestId())).rejects.toThrow("Only an approved configuration");
  });
});
