import { createHash } from "node:crypto";

import bcrypt from "bcryptjs";

import { createDatabaseClient } from "../src/lib/db/client";
import { migrateDatabase } from "../src/lib/db/migrate";
import {
  hashCanonicalPayload,
  readOnlyCommandEnvelopeSchema,
  runtimeStateVersion,
} from "../src/lib/domain/runtime-contracts";
import { parseDeploymentMode } from "../src/lib/deployment/contracts";
import { NinjaRepository } from "../src/lib/repositories/ninja-repository";
import { RuntimeRepository } from "../src/lib/repositories/runtime-repository";

const ids = {
  organization: "11111111-1111-4111-8111-111111111111",
  staff: "22222222-2222-4222-8222-222222222222",
  clientUser: "33333333-3333-4333-8333-333333333333",
  client: "44444444-4444-4444-8444-444444444444",
  account: "55555555-5555-4555-8555-555555555555",
  environment: "66666666-6666-4666-8666-666666666666",
  steadyStrategy: "77777777-7777-4777-8777-777777777777",
  balancedStrategy: "88888888-8888-4888-8888-888888888888",
  health: "99999999-9999-4999-8999-999999999999",
  emptyOrganization: "11111111-1111-4111-8111-111111111112",
  emptyStaff: "22222222-2222-4222-8222-222222222223",
  onlineAgent: "a1111111-1111-4111-8111-111111111111",
  staleAgent: "a2222222-2222-4222-8222-222222222222",
  offlineAgent: "a3333333-3333-4333-8333-333333333333",
  onlineCredential: "b1111111-1111-4111-8111-111111111111",
  staleCredential: "b2222222-2222-4222-8222-222222222222",
  offlineCredential: "b3333333-3333-4333-8333-333333333333",
  onlineHeartbeat1: "c1111111-1111-4111-8111-111111111111",
  onlineSnapshot: "c2222222-2222-4222-8222-222222222222",
  onlineHeartbeat2: "c3333333-3333-4333-8333-333333333333",
  staleHeartbeat: "c4444444-4444-4444-8444-444444444444",
  snapshotRecord: "d1111111-1111-4111-8111-111111111111",
  accountIdentity: "d2222222-2222-4222-8222-222222222222",
  accountObservation: "d3333333-3333-4333-8333-333333333333",
  strategyIdentity: "d4444444-4444-4444-8444-444444444444",
  strategyObservation: "d5555555-5555-4555-8555-555555555555",
  partialCommandRecord: "e1111111-1111-4111-8111-111111111111",
  partialCommand: "e2222222-2222-4222-8222-222222222222",
  partialCorrelation: "e3333333-3333-4333-8333-333333333333",
  partialLease: "e4444444-4444-4444-8444-444444444444",
  partialDelivery: "e5555555-5555-4555-8555-555555555555",
  expiredCommandRecord: "f1111111-1111-4111-8111-111111111111",
  expiredCommand: "f2222222-2222-4222-8222-222222222222",
  expiredCorrelation: "f3333333-3333-4333-8333-333333333333",
  centralInstallation: "90111111-1111-4111-8111-111111111111",
  localInstallation: "90222222-2222-4222-8222-222222222222",
};

const database = createDatabaseClient();
const deploymentMode = parseDeploymentMode(process.env.NINJA_MANAGER_MODE, process.env.NODE_ENV);

try {
  await migrateDatabase(database);
  const staffPassword = process.env.DEMO_STAFF_PASSWORD ?? "VincereStaff!2026";
  const clientPassword = process.env.DEMO_CLIENT_PASSWORD ?? "VincereClient!2026";
  const [staffHash, clientHash] = await Promise.all([
    bcrypt.hash(staffPassword, 12),
    bcrypt.hash(clientPassword, 12),
  ]);

  await database.query(
    "INSERT INTO organizations (id, name, slug) VALUES ($1, 'Vincere Trading', 'vincere') ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name",
    [ids.organization],
  );
  await database.query(
    "INSERT INTO organizations (id, name, slug) VALUES ($1, 'Vincere Empty Fixture', 'vincere-empty') ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name",
    [ids.emptyOrganization],
  );
  await database.query(`
    INSERT INTO users (id, organization_id, email, name, password_hash, role)
    VALUES ($1, $2, $3, 'Morgan Lee', $4, 'staff')
    ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, password_hash = EXCLUDED.password_hash, status = 'active'
  `, [ids.staff, ids.organization, process.env.DEMO_STAFF_EMAIL ?? "staff@vincere.local", staffHash]);
  await database.query(`
    INSERT INTO users (id, organization_id, email, name, password_hash, role)
    VALUES ($1, $2, $3, 'Jamie Rivera', $4, 'client')
    ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, password_hash = EXCLUDED.password_hash, status = 'active'
  `, [ids.clientUser, ids.organization, process.env.DEMO_CLIENT_EMAIL ?? "client@vincere.local", clientHash]);
  await database.query(`
    INSERT INTO users (id, organization_id, email, name, password_hash, role)
    VALUES ($1, $2, $3, 'Empty Fixture Staff', $4, 'staff')
    ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, password_hash = EXCLUDED.password_hash, status = 'active'
  `, [
    ids.emptyStaff,
    ids.emptyOrganization,
    process.env.DEMO_EMPTY_STAFF_EMAIL ?? "empty-staff@vincere.local",
    staffHash,
  ]);
  await database.query(`
    INSERT INTO clients (id, organization_id, user_id, display_name, phone, timezone, onboarding_status, risk_acknowledged_at, created_by)
    VALUES ($1, $2, $3, 'Jamie Rivera', '(555) 010-2026', 'America/New_York', 'complete', now(), $4)
    ON CONFLICT (id) DO UPDATE SET display_name = EXCLUDED.display_name
  `, [ids.client, ids.organization, ids.clientUser, ids.staff]);
  await database.query(
    "DELETE FROM product_installations WHERE id IN ($1, $2)",
    [ids.centralInstallation, ids.localInstallation],
  );
  if (deploymentMode === "CENTRAL_CONNECTED") {
    await database.query(
      [
        "INSERT INTO product_installations",
        "(id, organization_id, installation_kind, deployment_mode, enrollment_state, created_by)",
        "VALUES ($1, $2, 'central_hub', 'CENTRAL_CONNECTED', 'active', $3)",
      ].join(" "),
      [ids.centralInstallation, ids.organization, ids.staff],
    );
  } else {
    await database.query(
      [
        "INSERT INTO product_installations",
        "(id, organization_id, local_client_id, installation_kind, deployment_mode, enrollment_state, created_by)",
        "VALUES ($1, $2, $3, 'local_node', 'LOCAL_ONLY', 'standalone', $4)",
      ].join(" "),
      [ids.localInstallation, ids.organization, ids.client, ids.clientUser],
    );
  }
  await database.query(`
    INSERT INTO trading_accounts (id, organization_id, client_id, provider, label, account_identifier_masked, account_size, rule_profile, status)
    VALUES ($1, $2, $3, 'Apex', 'Primary evaluation', '••••4821', 50000, 'Standard trailing drawdown', 'healthy')
    ON CONFLICT (id) DO UPDATE SET status = 'healthy'
  `, [ids.account, ids.organization, ids.client]);
  await database.query(`
    INSERT INTO environments (id, organization_id, client_id, vps_provider, vps_region, ninja_version, connection_status, last_check_at)
    VALUES ($1, $2, $3, 'Vultr', 'New Jersey', '8.1', 'healthy', now())
    ON CONFLICT (id) DO UPDATE SET connection_status = 'healthy', last_check_at = now()
  `, [ids.environment, ids.organization, ids.client]);
  await database.query(`
    INSERT INTO strategies (id, organization_id, slug, name, description, risk_level, approved, configuration_schema)
    VALUES
      ($1, $3, 'vincere-steady', 'Vincere Steady', 'A controlled starting configuration focused on operational simplicity and tighter daily limits.', 'conservative', true, $4::jsonb),
      ($2, $3, 'vincere-balanced', 'Vincere Balanced', 'A measured configuration for experienced clients balancing consistency with controlled scaling.', 'balanced', true, $4::jsonb)
    ON CONFLICT (id) DO UPDATE SET approved = true, description = EXCLUDED.description
  `, [ids.steadyStrategy, ids.balancedStrategy, ids.organization, JSON.stringify({ contracts: { min: 1, max: 3 }, approvalRequired: true })]);
  await database.query(`
    INSERT INTO health_checks (id, organization_id, client_id, environment_id, connector, status, summary, details)
    VALUES ($1, $2, $3, $4, 'vps', 'healthy', 'VPS heartbeat received', $5::jsonb)
    ON CONFLICT (id) DO UPDATE SET status = 'healthy', summary = EXCLUDED.summary, checked_at = now()
  `, [ids.health, ids.organization, ids.client, ids.environment, JSON.stringify({ adapter: "simulated", latencyMs: 42 })]);

  // Seed two pending strategy approvals for the demo client. These were previously
  // created by the client-facing strategy questionnaire, which is not currently wired
  // into the UI (see docs / E2E reconciliation). createStrategyRecommendation emits
  // strategy.approval_requested and leaves each configuration pending_approval, which
  // the CENTRAL_CONNECTED E2E relies on for staff approve/reject + client deployment
  // coverage. Idempotent on requestId, so the repeat-run db:verify seed stays stable.
  // The strategy-request capability is CENTRAL_CONNECTED-only, so gate the fixtures.
  if (deploymentMode === "CENTRAL_CONNECTED") {
    const clientUser = {
      id: ids.clientUser,
      organizationId: ids.organization,
      email: process.env.DEMO_CLIENT_EMAIL ?? "client@vincere.local",
      name: "Jamie Rivera",
      role: "client" as const,
    };
    const ninjaRepository = new NinjaRepository(database);
    await ninjaRepository.createStrategyRecommendation(
      clientUser,
      { objective: "consistent", experience: "intermediate", drawdownComfort: "moderate", automationLevel: "assisted", tradingWindow: "morning" },
      "b0000000-0000-4000-8000-0000000000c1",
    );
    await ninjaRepository.createStrategyRecommendation(
      clientUser,
      { objective: "preserve", experience: "new", drawdownComfort: "low", automationLevel: "guided", tradingWindow: "morning" },
      "b0000000-0000-4000-8000-0000000000c2",
    );
  }

  const staffUser = {
    id: ids.staff,
    organizationId: ids.organization,
    email: process.env.DEMO_STAFF_EMAIL ?? "staff@vincere.local",
    name: "Morgan Lee",
    role: "staff" as const,
  };
  const seededAt = new Date();
  let runtimeNow = new Date(seededAt.getTime() - 4 * 60 * 1000);
  const runtimeRepository = new RuntimeRepository(database, () => runtimeNow);

  await database.transaction(async (transaction) => {
    await transaction.query(
      [
        "DELETE FROM audit_events WHERE entity_id IN (",
        "SELECT id FROM agent_commands WHERE agent_id IN ($1, $2, $3)",
        ") OR entity_id IN (",
        "SELECT id FROM agent_events WHERE agent_id IN ($1, $2, $3)",
        ") OR entity_id IN ($1, $2, $3)",
      ].join(" "),
      [ids.onlineAgent, ids.staleAgent, ids.offlineAgent],
    );
    await transaction.query(
      "DELETE FROM agent_installations WHERE id IN ($1, $2, $3)",
      [ids.onlineAgent, ids.staleAgent, ids.offlineAgent],
    );
  });

  const onlineEnrollment = await runtimeRepository.enrollAgent(staffUser, {
    id: ids.onlineAgent,
    displayName: "Primary SIM companion",
    agentVersion: "fixture-1.0.0",
    protocolVersion: "1.0",
    capabilities: ["command.acknowledgements", "runtime.discovery"],
  });
  const onlineIdentity = await runtimeRepository.authenticateAgentToken(onlineEnrollment.token);
  if (!onlineIdentity) throw new Error("Unable to authenticate the online runtime fixture");

  const buildEvent = (input: {
    eventId: string;
    agentId: string;
    sequence: number;
    eventType: "agent.heartbeat" | "runtime.snapshot";
    occurredAt: string;
    payload: Record<string, unknown>;
  }) => {
    const unsigned = {
      protocolVersion: "1.0" as const,
      eventId: input.eventId,
      agentId: input.agentId,
      sequence: input.sequence,
      eventType: input.eventType,
      correlationId: null,
      causationId: null,
      occurredAt: input.occurredAt,
      payloadHash: hashCanonicalPayload(input.payload),
      payload: input.payload,
    };
    return { ...unsigned, envelopeHash: hashCanonicalPayload(unsigned) };
  };

  const firstHeartbeatTime = runtimeNow.toISOString();
  await runtimeRepository.recordAgentEvent(onlineIdentity, buildEvent({
    eventId: ids.onlineHeartbeat1,
    agentId: ids.onlineAgent,
    sequence: 1,
    eventType: "agent.heartbeat",
    occurredAt: firstHeartbeatTime,
    payload: {
      source: "vps_companion_agent",
      observedAt: firstHeartbeatTime,
      agentVersion: "fixture-1.0.0",
      health: "online",
      addonConnected: true,
      addonVersion: "fixture-1.0.0",
      pendingEventCount: 0,
    },
  }));

  runtimeNow = new Date(runtimeNow.getTime() + 5_000);
  const runtimeState = {
    accounts: [{
      accountRef: "acct_demo000000000001",
      maskedIdentifier: "****4821",
      identifierFingerprint: "hmac-sha256:" + "a".repeat(64),
      displayLabel: "Simulation account 1",
      accountType: "simulation" as const,
      connectionKind: "simulation" as const,
      connectionStatus: "connected" as const,
    }],
    strategies: [{
      strategyRef: "strat_demo000000000001",
      accountRef: "acct_demo000000000001",
      displayLabel: "Strategy 1",
      strategyType: "VincereSteady",
      instrumentCode: "MNQ SEP26",
      timeframeCode: "1 Minute",
      enabled: true,
      sync: true,
      runtimeState: "running" as const,
      stateCode: "SYNCHRONIZED" as const,
    }],
  };
  const snapshotPayload = {
    source: "ninjatrader_addon" as const,
    collectionMode: "supervised_simulation" as const,
    complete: true as const,
    observedAt: runtimeNow.toISOString(),
    addonVersion: "fixture-1.0.0",
    stateVersion: runtimeStateVersion(runtimeState),
    ...runtimeState,
  };
  const snapshotEvent = buildEvent({
    eventId: ids.onlineSnapshot,
    agentId: ids.onlineAgent,
    sequence: 2,
    eventType: "runtime.snapshot",
    occurredAt: runtimeNow.toISOString(),
    payload: snapshotPayload,
  });
  await runtimeRepository.recordRuntimeSnapshot(onlineIdentity, snapshotEvent);

  runtimeNow = new Date(runtimeNow.getTime() + 5_000);
  const partialCommand = readOnlyCommandEnvelopeSchema.parse({
    protocolVersion: "1.0",
    commandId: ids.partialCommand,
    correlationId: ids.partialCorrelation,
    agentId: ids.onlineAgent,
    idempotencyKey: "seed-partial-runtime-command-0001",
    commandType: "DISCOVER_RUNTIME_STATE",
    issuedAt: runtimeNow.toISOString(),
    expiresAt: new Date(runtimeNow.getTime() + 10 * 60 * 1000).toISOString(),
    expectedStateVersion: snapshotPayload.stateVersion,
    approvalId: null,
    dryRun: true,
    payload: {
      include: ["accounts", "strategies"],
      forceFullSnapshot: true,
      reasonCode: "STAFF_RUNTIME_REFRESH",
    },
  });
  await runtimeRepository.enqueueReadOnlyCommand(staffUser, partialCommand);
  const [partialDelivery] = await runtimeRepository.leaseCommands(onlineIdentity);
  if (!partialDelivery) throw new Error("Unable to lease the partial runtime fixture");

  const acknowledgementStages = [
    {
      status: "accepted" as const,
      messageCode: "COMMAND_PERSISTED" as const,
      completedScopes: [] as Array<"accounts" | "strategies" | "executions">,
      failedScopes: [] as Array<"accounts" | "strategies" | "executions">,
      retrySafe: false,
      errorCode: "NONE" as const,
      counts: { accounts: 0, strategies: 0, executions: 0 },
      resultEventIds: [] as string[],
    },
    {
      status: "started" as const,
      messageCode: "COMMAND_STARTED" as const,
      completedScopes: [] as Array<"accounts" | "strategies" | "executions">,
      failedScopes: [] as Array<"accounts" | "strategies" | "executions">,
      retrySafe: false,
      errorCode: "NONE" as const,
      counts: { accounts: 0, strategies: 0, executions: 0 },
      resultEventIds: [] as string[],
    },
    {
      status: "partial" as const,
      messageCode: "COMMAND_PARTIAL" as const,
      completedScopes: ["accounts"] as Array<"accounts" | "strategies" | "executions">,
      failedScopes: ["strategies"] as Array<"accounts" | "strategies" | "executions">,
      retrySafe: true,
      errorCode: "ADDON_OFFLINE" as const,
      counts: { accounts: 1, strategies: 0, executions: 0 },
      resultEventIds: [ids.onlineSnapshot],
    },
  ];
  for (let index = 0; index < acknowledgementStages.length; index += 1) {
    runtimeNow = new Date(runtimeNow.getTime() + 5_000);
    const stage = acknowledgementStages[index];
    const evidence = {
      resultEventIds: stage.resultEventIds,
      completedScopes: stage.completedScopes,
      failedScopes: stage.failedScopes,
      retrySafe: stage.retrySafe,
      errorCode: stage.errorCode,
      observedStateVersion: snapshotPayload.stateVersion,
      counts: stage.counts,
    };
    await runtimeRepository.recordAcknowledgement(onlineIdentity, {
      protocolVersion: "1.0",
      acknowledgementId: [
        "a0000000-0000-4000-8000-000000000001",
        "a0000000-0000-4000-8000-000000000002",
        "a0000000-0000-4000-8000-000000000003",
      ][index],
      commandId: partialDelivery.envelope.command.commandId,
      correlationId: partialDelivery.envelope.command.correlationId,
      agentId: ids.onlineAgent,
      leaseId: partialDelivery.leaseId,
      sequence: index + 1,
      status: stage.status,
      messageCode: stage.messageCode,
      evidence,
      evidenceHash: hashCanonicalPayload(evidence),
      occurredAt: runtimeNow.toISOString(),
    });
  }

  runtimeNow = new Date(runtimeNow.getTime() + 5_000);
  const expiringCommand = readOnlyCommandEnvelopeSchema.parse({
    protocolVersion: "1.0",
    commandId: ids.expiredCommand,
    correlationId: ids.expiredCorrelation,
    agentId: ids.onlineAgent,
    idempotencyKey: "seed-expired-runtime-command-0001",
    commandType: "DISCOVER_RUNTIME_STATE",
    issuedAt: runtimeNow.toISOString(),
    expiresAt: new Date(runtimeNow.getTime() + 60_000).toISOString(),
    expectedStateVersion: snapshotPayload.stateVersion,
    approvalId: null,
    dryRun: true,
    payload: {
      include: ["accounts", "strategies"],
      forceFullSnapshot: true,
      reasonCode: "STAFF_RUNTIME_REFRESH",
    },
  });
  await runtimeRepository.enqueueReadOnlyCommand(staffUser, expiringCommand);
  runtimeNow = new Date(runtimeNow.getTime() + 61_000);
  await runtimeRepository.listCommands(staffUser, ids.onlineAgent);

  runtimeNow = seededAt;
  const finalHeartbeatTime = runtimeNow.toISOString();
  await runtimeRepository.recordAgentEvent(onlineIdentity, buildEvent({
    eventId: ids.onlineHeartbeat2,
    agentId: ids.onlineAgent,
    sequence: 3,
    eventType: "agent.heartbeat",
    occurredAt: finalHeartbeatTime,
    payload: {
      source: "vps_companion_agent",
      observedAt: finalHeartbeatTime,
      agentVersion: "fixture-1.0.0",
      health: "online",
      addonConnected: true,
      addonVersion: "fixture-1.0.0",
      pendingEventCount: 0,
    },
  }));

  runtimeNow = new Date(seededAt.getTime() - 10 * 60 * 1000);
  const staleEnrollment = await runtimeRepository.enrollAgent(staffUser, {
    id: ids.staleAgent,
    displayName: "Stale companion",
    agentVersion: "fixture-1.0.0",
    protocolVersion: "1.0",
    capabilities: ["runtime.discovery"],
  });
  const staleIdentity = await runtimeRepository.authenticateAgentToken(staleEnrollment.token);
  if (!staleIdentity) throw new Error("Unable to authenticate the stale runtime fixture");
  const staleHeartbeatTime = runtimeNow.toISOString();
  await runtimeRepository.recordAgentEvent(staleIdentity, buildEvent({
    eventId: ids.staleHeartbeat,
    agentId: ids.staleAgent,
    sequence: 1,
    eventType: "agent.heartbeat",
    occurredAt: staleHeartbeatTime,
    payload: {
      source: "vps_companion_agent",
      observedAt: staleHeartbeatTime,
      agentVersion: "fixture-1.0.0",
      health: "online",
      addonConnected: true,
      addonVersion: "fixture-1.0.0",
      pendingEventCount: 2,
    },
  }));

  runtimeNow = seededAt;
  await runtimeRepository.enrollAgent(staffUser, {
    id: ids.offlineAgent,
    displayName: "Offline companion",
    agentVersion: "fixture-1.0.0",
    protocolVersion: "1.0",
    capabilities: ["runtime.discovery"],
  });

  const demoAgentToken = process.env.DEMO_AGENT_TOKEN;
  if (demoAgentToken) {
    if (!/^vnm_[A-Za-z0-9_-]{28,196}$/.test(demoAgentToken)) {
      throw new Error("DEMO_AGENT_TOKEN must use the vnm_ token format");
    }
    await database.query(
      [
        "UPDATE agent_credentials SET token_hash = $1, token_last_four = $2",
        "WHERE agent_id = $3 AND organization_id = $4 AND revoked_at IS NULL",
      ].join(" "),
      [
        createHash("sha256").update(demoAgentToken).digest("hex"),
        demoAgentToken.slice(-4),
        ids.onlineAgent,
        ids.organization,
      ],
    );
  }


  console.log("Demo data seeded.");
  console.log(`Staff: ${process.env.DEMO_STAFF_EMAIL ?? "staff@vincere.local"}`);
  console.log(`Client: ${process.env.DEMO_CLIENT_EMAIL ?? "client@vincere.local"}`);
} finally {
  await database.close();
}
