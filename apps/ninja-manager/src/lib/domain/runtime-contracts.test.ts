import { describe, expect, it } from "vitest";

import {
  agentEventSchema,
  canonicalizeJsonForHash,
  commandAcknowledgementSchema,
  commandSemanticHash,
  createDeliveredReadOnlyCommandEnvelope,
  hashCanonicalPayload,
  isAcknowledgementTransitionAllowed,
  parseAgentEvent,
  parseCommandAcknowledgement,
  parseDeliveredReadOnlyCommandEnvelope,
  parseRuntimeObservationV2Event,
  parseRuntimeSnapshotEvent,
  processObservationSchema,
  readOnlyCommandEnvelopeSchema,
  runtimeSnapshotPayloadSchema,
  runtimeStateVersion,
  type AgentEvent,
  type ReadOnlyCommandEnvelope,
} from "./runtime-contracts";
import { runtimeObservationV2StateDigest, type RuntimeObservationV2State } from "./runtime-observation-v2";

const runtimeState = {
  accounts: [{
    accountRef: "acct_1234567890abcdef",
    maskedIdentifier: "****1234",
    identifierFingerprint: "hmac-sha256:" + "a".repeat(64),
    displayLabel: "Evaluation account 1",
    accountType: "evaluation" as const,
    connectionKind: "brokerage" as const,
    connectionStatus: "connected" as const,
  }],
  strategies: [{
    strategyRef: "strat_1234567890abcdef",
    accountRef: "acct_1234567890abcdef",
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

const payload = {
  source: "ninjatrader_addon" as const,
  collectionMode: "authoritative_read_only" as const,
  complete: true as const,
  observedAt: "2026-07-13T15:00:00.000-04:00",
  addonVersion: "1.0.0",
  stateVersion: runtimeStateVersion(runtimeState),
  ...runtimeState,
};

function snapshotEvent(overrides: Record<string, unknown> = {}) {
  const unsigned = {
    protocolVersion: "1.0" as const,
    eventId: "10000000-0000-4000-8000-000000000001",
    agentId: "20000000-0000-4000-8000-000000000001",
    sequence: 1,
    eventType: "runtime.snapshot" as const,
    correlationId: null,
    causationId: null,
    occurredAt: "2026-07-13T15:00:01.000-04:00",
    payloadHash: hashCanonicalPayload(payload),
    payload,
    ...overrides,
  };
  return { ...unsigned, envelopeHash: hashCanonicalPayload(unsigned) };
}

function unavailableV2State(): RuntimeObservationV2State {
  const unavailable = {
    status: "unavailable" as const,
    itemCount: 0,
    errors: [{ code: "ADDON_OFFLINE" as const, retryable: true }],
  };
  return {
    process: null,
    addon: null,
    connections: [],
    accounts: [],
    strategies: [],
    positions: [],
    orders: [],
    executions: [],
    pnl: [],
    collection: {
      overall: "unavailable",
      scopes: {
        process: unavailable,
        addon: unavailable,
        connections: unavailable,
        accounts: unavailable,
        strategies: unavailable,
        positions: unavailable,
        orders: unavailable,
        executions: unavailable,
        pnl: unavailable,
      },
    },
  };
}

function observationV2Event() {
  const state = unavailableV2State();
  const observation = {
    protocolVersion: "runtime-observation/2.0" as const,
    observationId: "70000000-0000-4000-8000-000000000001",
    source: {
      collector: "vps_companion_agent" as const,
      authority: "ninjatrader_runtime" as const,
      installationRef: "install_1234567890abcdef",
      collectionSessionRef: "session_1234567890abcdef",
    },
    asOf: "2026-07-21T15:00:00.000-04:00",
    freshness: { status: "unknown" as const, ageMs: null, maxAgeMs: 30_000 },
    stateDigest: runtimeObservationV2StateDigest(state),
    state,
  };
  const unsigned = {
    protocolVersion: "1.0" as const,
    eventId: "70000000-0000-4000-8000-000000000002",
    agentId: "20000000-0000-4000-8000-000000000001",
    sequence: 3,
    eventType: "runtime.observation_v2" as const,
    correlationId: "70000000-0000-4000-8000-000000000003",
    causationId: "70000000-0000-4000-8000-000000000004",
    occurredAt: "2026-07-21T15:00:01.000-04:00",
    payloadHash: hashCanonicalPayload(observation),
    payload: observation,
  };
  return { ...unsigned, envelopeHash: hashCanonicalPayload(unsigned) };
}

function discoveryCommand(overrides: Partial<ReadOnlyCommandEnvelope> = {}): ReadOnlyCommandEnvelope {
  return readOnlyCommandEnvelopeSchema.parse({
    protocolVersion: "1.0",
    commandId: "30000000-0000-4000-8000-000000000001",
    correlationId: "40000000-0000-4000-8000-000000000001",
    agentId: "20000000-0000-4000-8000-000000000001",
    idempotencyKey: "discover:agent:version:1",
    commandType: "DISCOVER_RUNTIME_STATE",
    issuedAt: "2026-07-13T15:00:00.000-04:00",
    expiresAt: "2026-07-13T15:05:00.000-04:00",
    expectedStateVersion: null,
    approvalId: null,
    dryRun: true,
    payload: {
      include: ["accounts", "strategies"],
      forceFullSnapshot: true,
      reasonCode: "STAFF_RUNTIME_REFRESH",
    },
    ...overrides,
  });
}

function acknowledgementEvidence() {
  return {
    resultEventIds: ["10000000-0000-4000-8000-000000000001"],
    completedScopes: ["accounts"] as const,
    failedScopes: [] as const,
    retrySafe: false,
    errorCode: "NONE" as const,
    observedStateVersion: payload.stateVersion,
    counts: { accounts: 1, strategies: 1, executions: 0 },
  };
}

describe("runtime orchestration contracts", () => {
  it("creates and parses a strict runtime observation v2 through the generic agent envelope", () => {
    const generic: AgentEvent = agentEventSchema.parse(observationV2Event());
    expect(generic.eventType).toBe("runtime.observation_v2");
    const parsed = parseRuntimeObservationV2Event(generic);
    expect(parsed.payload.state.collection.overall).toBe("unavailable");
    expect(parsed.correlationId).toBe("70000000-0000-4000-8000-000000000003");
    expect(parsed.causationId).toBe("70000000-0000-4000-8000-000000000004");
  });

  it("rejects v2 payload, envelope, and strict-schema tampering", () => {
    const event = observationV2Event();
    expect(() => parseAgentEvent({
      ...event,
      payload: { ...event.payload, observationId: "70000000-0000-4000-8000-000000000099" },
    })).toThrow("payload hash");
    expect(() => parseAgentEvent({
      ...event,
      occurredAt: "2026-07-21T15:00:02.000-04:00",
    })).toThrow("envelope hash");

    const payloadWithUnknownField = { ...event.payload, rawAccountNumber: "Sim101" };
    const unsigned = {
      ...event,
      payload: payloadWithUnknownField,
      payloadHash: hashCanonicalPayload(payloadWithUnknownField),
    };
    const { envelopeHash: _oldEnvelopeHash, ...unsignedWithoutEnvelopeHash } = unsigned;
    expect(_oldEnvelopeHash).toBe(event.envelopeHash);
    expect(() => parseAgentEvent({
      ...unsignedWithoutEnvelopeHash,
      envelopeHash: hashCanonicalPayload(unsignedWithoutEnvelopeHash),
    })).toThrow();
  });

  it("keeps runtime snapshot v1 parsing compatible after adding the v2 event", () => {
    expect(parseAgentEvent(snapshotEvent()).eventType).toBe("runtime.snapshot");
    expect(parseRuntimeSnapshotEvent(snapshotEvent()).payload.addonVersion).toBe("1.0.0");
  });

  it("accepts a complete authoritative snapshot with masked, allowlisted identity fields", () => {
    const event = parseRuntimeSnapshotEvent(snapshotEvent());
    expect(event.payload.strategies[0].runtimeState).toBe("running");
    expect(event.payload.accounts[0].accountType).toBe("evaluation");
    expect(event.payload.stateVersion).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it("rejects identity ambiguity, contradictory state, raw labels, secrets, and state-digest reuse", () => {
    expect(runtimeSnapshotPayloadSchema.safeParse({ ...payload, accounts: [] }).success).toBe(false);
    expect(runtimeSnapshotPayloadSchema.safeParse({
      ...payload,
      strategies: [{ ...payload.strategies[0], enabled: false }],
    }).success).toBe(false);
    expect(runtimeSnapshotPayloadSchema.safeParse({
      ...payload,
      accounts: [{ ...payload.accounts[0], maskedIdentifier: "LFE0506703503010" }],
    }).success).toBe(false);
    expect(runtimeSnapshotPayloadSchema.safeParse({
      ...payload,
      accounts: [{ ...payload.accounts[0], displayLabel: "Bearer secret-account-token" }],
    }).success).toBe(false);
    expect(runtimeSnapshotPayloadSchema.safeParse({
      ...payload,
      strategies: [{ ...payload.strategies[0], stateCode: "C:\\Users\\secret\\token.txt" }],
    }).success).toBe(false);
    expect(runtimeSnapshotPayloadSchema.safeParse({
      ...payload,
      accounts: [
        payload.accounts[0],
        {
          ...payload.accounts[0],
          accountRef: "acct_fedcba0987654321",
          displayLabel: "Evaluation account 2",
        },
      ],
    }).success).toBe(false);
    expect(() => parseAgentEvent({
      ...snapshotEvent(),
      payloadHash: "sha256:" + "0".repeat(64),
    })).toThrow("payload hash");
    expect(() => parseAgentEvent({
      ...snapshotEvent(),
      envelopeHash: "sha256:" + "0".repeat(64),
    })).toThrow("envelope hash");
  });

  it("accepts a strict companion heartbeat and rejects transformed or unknown wire fields", () => {
    const heartbeatPayload = {
      source: "vps_companion_agent" as const,
      observedAt: "2026-07-13T15:00:00.000-04:00",
      agentVersion: "1.0.0",
      health: "online" as const,
      addonConnected: true,
      addonVersion: "1.0.0",
      pendingEventCount: 0,
    };
    const unsigned = {
      protocolVersion: "1.0" as const,
      eventId: "10000000-0000-4000-8000-000000000002",
      agentId: "20000000-0000-4000-8000-000000000001",
      sequence: 2,
      eventType: "agent.heartbeat" as const,
      correlationId: null,
      causationId: null,
      occurredAt: "2026-07-13T15:00:01.000-04:00",
      payloadHash: hashCanonicalPayload(heartbeatPayload),
      payload: heartbeatPayload,
    };
    expect(parseAgentEvent({ ...unsigned, envelopeHash: hashCanonicalPayload(unsigned) }).eventType).toBe("agent.heartbeat");
    expect(() => parseAgentEvent({ ...snapshotEvent(), eventType: "agent.unknown" })).toThrow();
    expect(() => parseAgentEvent({
      ...unsigned,
      payload: { ...heartbeatPayload, agentVersion: " 1.0.0 " },
      payloadHash: hashCanonicalPayload({ ...heartbeatPayload, agentVersion: " 1.0.0 " }),
    })).toThrow();
  });

  it("adds strict process-only evidence without breaking legacy heartbeats", () => {
    const base = {
      observedAt: "2026-07-13T15:00:00.000-04:00",
      installationRef: "install_1234567890abcdef",
    };
    expect(processObservationSchema.parse({
      ...base,
      state: "running",
      processStateVersion: "sha256:" + "a".repeat(64),
      processRef: "process_" + "b".repeat(64),
      matchedProcessCount: 1,
      unavailableReason: null,
    }).state).toBe("running");
    expect(processObservationSchema.parse({
      ...base,
      state: "not_running",
      processStateVersion: "sha256:" + "c".repeat(64),
      processRef: null,
      matchedProcessCount: 0,
      unavailableReason: null,
    }).state).toBe("not_running");

    const forbidden = [
      {
        ...base,
        state: "running",
        processStateVersion: "sha256:" + "a".repeat(64),
        processRef: null,
        matchedProcessCount: 1,
        unavailableReason: null,
      },
      {
        ...base,
        state: "ambiguous",
        processStateVersion: "sha256:" + "a".repeat(64),
        processRef: "process_" + "b".repeat(64),
        matchedProcessCount: 2,
        unavailableReason: "MULTIPLE_ACTIVE_PROCESSES",
      },
      {
        ...base,
        state: "unknown",
        processStateVersion: "sha256:" + "a".repeat(64),
        processRef: null,
        matchedProcessCount: null,
        unavailableReason: "OBSERVATION_FAILED",
      },
      {
        ...base,
        state: "running",
        processStateVersion: "sha256:" + "a".repeat(64),
        processRef: "process_" + "b".repeat(64),
        matchedProcessCount: 1,
        unavailableReason: null,
        executablePath: "C:\\Program Files\\NinjaTrader 8\\bin\\NinjaTrader.exe",
      },
    ];
    for (const value of forbidden) expect(processObservationSchema.safeParse(value).success).toBe(false);
  });

  it("permits only bounded, explicit, typed dry-run read commands", () => {
    const command = discoveryCommand();
    expect(command.dryRun).toBe(true);
    expect(readOnlyCommandEnvelopeSchema.safeParse({ ...command, commandType: "FLATTEN_ACCOUNT" }).success).toBe(false);
    expect(readOnlyCommandEnvelopeSchema.safeParse({ ...command, dryRun: false }).success).toBe(false);
    expect(readOnlyCommandEnvelopeSchema.safeParse({
      ...command,
      expiresAt: "2026-07-13T16:00:00.000-04:00",
    }).success).toBe(false);
    expect(readOnlyCommandEnvelopeSchema.safeParse({
      ...command,
      payload: {},
    }).success).toBe(false);
    const withoutExplicitNull: Partial<ReadOnlyCommandEnvelope> = { ...command };
    delete withoutExplicitNull.expectedStateVersion;
    expect(readOnlyCommandEnvelopeSchema.safeParse(withoutExplicitNull).success).toBe(false);
  });

  it("validates typed acknowledgement evidence, codes, hashes, and transitions", () => {
    const evidence = acknowledgementEvidence();
    const acknowledgement = commandAcknowledgementSchema.parse({
      protocolVersion: "1.0",
      acknowledgementId: "50000000-0000-4000-8000-000000000001",
      commandId: "30000000-0000-4000-8000-000000000001",
      correlationId: "40000000-0000-4000-8000-000000000001",
      agentId: "20000000-0000-4000-8000-000000000001",
      leaseId: "60000000-0000-4000-8000-000000000001",
      sequence: 1,
      status: "accepted",
      messageCode: "COMMAND_PERSISTED",
      evidence,
      evidenceHash: hashCanonicalPayload(evidence),
      occurredAt: "2026-07-13T15:00:10.000-04:00",
    });
    expect(parseCommandAcknowledgement(acknowledgement).status).toBe("accepted");
    expect(() => parseCommandAcknowledgement({
      ...acknowledgement,
      evidence: { ...evidence, token: "vnm_secret" },
    })).toThrow();
    expect(commandAcknowledgementSchema.safeParse({
      ...acknowledgement,
      messageCode: "COMMAND_FAILED",
    }).success).toBe(false);
    expect(isAcknowledgementTransitionAllowed("queued", "accepted")).toBe(true);
    expect(isAcknowledgementTransitionAllowed("accepted", "partial")).toBe(true);
    expect(isAcknowledgementTransitionAllowed("completed", "progress")).toBe(false);
  });

  it("publishes an RFC 8785 UTF-8 vector covering Unicode, exponent form, negative zero, and key order", () => {
    const value = { "€": "€", z: -0, a: [1e30, 0.002, 4.5], "\r": "\n" };
    const canonical = canonicalizeJsonForHash(value);
    expect(canonical).toBe('{"\\r":"\\n","a":[1e+30,0.002,4.5],"z":0,"€":"€"}');
    expect(hashCanonicalPayload(value)).toBe(
      "sha256:d53bbaa9ce3ccb23e92358cbf619c6893d8a36957e4908846d30818fd9aea857",
    );
    expect(() => canonicalizeJsonForHash(Number.POSITIVE_INFINITY)).toThrow("non-finite number");
    expect(() => canonicalizeJsonForHash(undefined)).toThrow("unsupported value");
    expect(() => canonicalizeJsonForHash("\ud800")).toThrow("lone Unicode surrogate");
  });

  it("uses stable semantic hashes and rejects delivered-envelope tampering", () => {
    const first = discoveryCommand();
    const retry = discoveryCommand({
      commandId: "30000000-0000-4000-8000-000000000002",
      correlationId: "40000000-0000-4000-8000-000000000002",
      issuedAt: "2026-07-13T15:01:00.000-04:00",
      expiresAt: "2026-07-13T15:06:00.000-04:00",
    });
    expect(commandSemanticHash(retry)).toBe(commandSemanticHash(first));
    const changed = discoveryCommand({
      payload: {
        include: ["accounts"],
        forceFullSnapshot: true,
        reasonCode: "STAFF_RUNTIME_REFRESH",
      },
    });
    expect(commandSemanticHash(changed)).not.toBe(commandSemanticHash(first));

    const delivered = createDeliveredReadOnlyCommandEnvelope(first);
    expect(parseDeliveredReadOnlyCommandEnvelope(delivered).command.commandId).toBe(first.commandId);
    expect(() => parseDeliveredReadOnlyCommandEnvelope({
      ...delivered,
      command: { ...delivered.command, correlationId: "40000000-0000-4000-8000-000000000099" },
    })).toThrow("envelope");
  });
});
