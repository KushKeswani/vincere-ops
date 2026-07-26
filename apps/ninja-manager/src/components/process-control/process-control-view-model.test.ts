import { describe, expect, it } from "vitest";

import type { AgentInstallation, LatestRuntimeObservationV2 } from "@/lib/repositories/runtime-repository";

import {
  buildProcessControlDashboardModel,
  evaluateProcessControlPreflight,
} from "./process-control-view-model";

const NOW = new Date("2026-07-21T19:00:20.000Z");
const AGENT_ID = "30000000-0000-4000-8000-000000000001";
const INSTALLATION_REF = `install_${"a".repeat(32)}`;
const PROCESS_REF = `process_${"b".repeat(64)}`;
const STATE_VERSION = `sha256:${"1".repeat(64)}`;

function agent(state: "running" | "not_running" | "ambiguous" | "unknown" = "running"): AgentInstallation {
  const common = {
    evidenceEventId: "40000000-0000-4000-8000-000000000001",
    evidenceSequence: 4,
    observedAt: new Date("2026-07-21T19:00:18.000Z"),
    receivedAt: new Date("2026-07-21T19:00:19.000Z"),
    installationRef: INSTALLATION_REF,
    freshness: { status: "fresh" as const, ageMs: 2_000, maxAgeMs: 45_000, expiresAt: new Date("2026-07-21T19:01:03.000Z") },
  };
  const processObservation = state === "running"
    ? { ...common, state, processStateVersion: STATE_VERSION, processRef: PROCESS_REF, matchedProcessCount: 1, unavailableReason: null }
    : state === "not_running"
      ? { ...common, state, processStateVersion: STATE_VERSION, processRef: null, matchedProcessCount: 0, unavailableReason: null }
      : state === "ambiguous"
        ? { ...common, state, processStateVersion: STATE_VERSION, processRef: null, matchedProcessCount: 2, unavailableReason: "MULTIPLE_ACTIVE_PROCESSES" as const }
        : { ...common, state, processStateVersion: null, processRef: null, matchedProcessCount: null, unavailableReason: "OBSERVATION_FAILED" as const };
  return {
    id: AGENT_ID,
    displayName: "Edith",
    configuredStatus: "online",
    effectiveStatus: "online",
    agentVersion: "2.0.0",
    protocolVersion: "1.0",
    capabilities: ["process.control", "process.observation"],
    lastHeartbeatAt: new Date("2026-07-21T19:00:19.000Z"),
    lastContactAt: new Date("2026-07-21T19:00:19.000Z"),
    addonConnected: true,
    addonVersion: "2.0.0",
    pendingEventCount: 0,
    lastEventSequence: 4,
    environmentId: null,
    processObservation,
  };
}

function runtime(): LatestRuntimeObservationV2 {
  const complete = (itemCount: number) => ({ status: "complete" as const, itemCount, errors: [] });
  const sequential = (itemCount: number) => ({
    status: "partial" as const,
    itemCount,
    errors: [{ code: "CAPABILITY_UNSUPPORTED" as const, retryable: false }],
  });
  return {
    protocolVersion: "1.0",
    eventType: "runtime.observation_v2",
    eventId: "50000000-0000-4000-8000-000000000001",
    agentId: AGENT_ID,
    sequence: 5,
    correlationId: null,
    causationId: null,
    occurredAt: new Date("2026-07-21T19:00:18.000Z"),
    receivedAt: new Date("2026-07-21T19:00:19.000Z"),
    payloadHash: `sha256:${"2".repeat(64)}`,
    envelopeHash: `sha256:${"3".repeat(64)}`,
    observation: {
      protocolVersion: "runtime-observation/2.0",
      observationId: "60000000-0000-4000-8000-000000000001",
      source: { collector: "vps_companion_agent", authority: "ninjatrader_runtime", installationRef: INSTALLATION_REF, collectionSessionRef: "session_abcdefghijklmnop" },
      asOf: "2026-07-21T19:00:18.000Z",
      freshness: { status: "fresh", ageMs: 0, maxAgeMs: 60_000 },
      stateDigest: `sha256:${"4".repeat(64)}`,
      state: {
        process: { processRef: PROCESS_REF, status: "running", health: "healthy", version: "8.1.7.2", startedAt: "2026-07-21T18:00:00.000Z" },
        addon: { addonRef: "addon_abcdefghijklmnop", status: "connected", health: "healthy", version: "2.0.0", ipcAuthenticated: true, capabilities: [] },
        connections: [],
        accounts: [{
          accountRef: "acct_abcdefghijklmnop",
          maskedIdentifier: "******M101",
          identifierFingerprint: `hmac-sha256:${"5".repeat(64)}`,
          displayLabel: "Simulation account 1",
          classification: { environment: "simulation", authority: "authoritative", source: "ninjatrader_simulation_account" },
          connectionRefs: [],
          status: "connected",
        }],
        strategies: [], positions: [], orders: [], executions: [], pnl: [],
        collection: {
          overall: "partial",
          scopes: {
            process: complete(1), addon: complete(1), connections: sequential(0), accounts: sequential(1),
            strategies: sequential(0), positions: sequential(0), orders: sequential(0), executions: sequential(0), pnl: sequential(0),
          },
        },
      },
    },
  } as LatestRuntimeObservationV2;
}

const noCommands = { inFlight: 0, indeterminate: 0 };

describe("process-control preflight", () => {
  it("permits launch only from a fresh exact not-running observation", () => {
    const preflight = evaluateProcessControlPreflight({ agent: agent("not_running"), latestRuntime: null, commandCounts: noCommands, now: NOW });
    expect(preflight.launch.ready).toBe(true);
    expect(preflight.launch.approvalInput).toMatchObject({
      commandType: "LAUNCH_NINJATRADER",
      expectedProcessStateVersion: STATE_VERSION,
      target: { installationRef: INSTALLATION_REF },
    });
    expect(preflight.quit.ready).toBe(false);
  });

  it.each([
    ["missing process evidence", { ...agent(), processObservation: null }],
    ["missing capability", { ...agent(), capabilities: ["process.observation"] }],
    ["stale process evidence", { ...agent(), processObservation: { ...agent().processObservation!, observedAt: new Date("2026-07-21T18:58:00.000Z") } }],
    ["ambiguous process evidence", agent("ambiguous")],
    ["unknown process evidence", agent("unknown")],
  ])("fails closed on %s", (_label, value) => {
    const preflight = evaluateProcessControlPreflight({ agent: value, latestRuntime: runtime(), commandCounts: noCommands, now: NOW });
    expect(preflight.launch.ready).toBe(false);
    expect(preflight.quit.ready).toBe(false);
  });

  it("builds a quit approval preview from fresh matched SIM-only sequential evidence", () => {
    const preflight = evaluateProcessControlPreflight({ agent: agent(), latestRuntime: runtime(), commandCounts: noCommands, now: NOW });
    expect(preflight.quit.ready).toBe(true);
    expect(preflight.quit.approvalInput).toMatchObject({
      commandType: "REQUEST_NINJATRADER_QUIT",
      expectedProcessStateVersion: STATE_VERSION,
      target: { installationRef: INSTALLATION_REF, processRef: PROCESS_REF },
      runtimeState: { summary: { armedScheduleCount: 0, commandCounts: noCommands } },
    });
    expect(preflight.launch.ready).toBe(false);
  });

  it.each([
    ["stale runtime", (value: LatestRuntimeObservationV2) => { value.observation.asOf = "2026-07-21T18:59:00.000Z"; }],
    ["runtime chronology", (value: LatestRuntimeObservationV2) => { value.occurredAt = new Date("2026-07-21T19:00:17.000Z"); }],
    ["future receipt", (value: LatestRuntimeObservationV2) => { value.receivedAt = new Date("2026-07-21T19:00:21.000Z"); }],
    ["runtime source error", (value: LatestRuntimeObservationV2) => {
      value.observation.state.collection.scopes.accounts = {
        status: "partial",
        itemCount: 1,
        errors: [{ code: "SOURCE_ERROR", retryable: true }],
      };
    }],
    ["mismatched process", (value: LatestRuntimeObservationV2) => { value.observation.state.process!.processRef = `process_${"c".repeat(64)}`; }],
    ["live account", (value: LatestRuntimeObservationV2) => { value.observation.state.accounts[0].classification = { environment: "live", authority: "authoritative", source: "ninjatrader_live_account" }; }],
    ["unknown account", (value: LatestRuntimeObservationV2) => { value.observation.state.accounts[0].classification = { environment: "unknown", authority: "unavailable", source: null, reasonCode: "CLASSIFICATION_UNAVAILABLE" }; }],
    ["enabled strategy", (value: LatestRuntimeObservationV2) => { value.observation.state.strategies = [{ enabled: true, runtimeState: "running", synchronizationState: "synchronized" }] as never; }],
    ["transitional strategy", (value: LatestRuntimeObservationV2) => { value.observation.state.strategies = [{ enabled: false, runtimeState: "disabling", synchronizationState: "synchronized" }] as never; }],
    ["pending strategy synchronization", (value: LatestRuntimeObservationV2) => { value.observation.state.strategies = [{ enabled: false, runtimeState: "disabled", synchronizationState: "pending" }] as never; }],
    ["open position", (value: LatestRuntimeObservationV2) => { value.observation.state.positions = [{}] as never; }],
    ["working order", (value: LatestRuntimeObservationV2) => { value.observation.state.orders = [{ lifecycle: "working", state: "working" }] as never; }],
  ])("blocks quit for %s", (_label, mutate) => {
    const value = structuredClone(runtime());
    mutate(value);
    const preflight = evaluateProcessControlPreflight({ agent: agent(), latestRuntime: value, commandCounts: noCommands, now: NOW });
    expect(preflight.quit.ready).toBe(false);
  });

  it.each([
    { inFlight: 1, indeterminate: 0 },
    { inFlight: 0, indeterminate: 1 },
  ])("blocks both controls when another command is unsafe: %j", (commandCounts) => {
    const preflight = evaluateProcessControlPreflight({ agent: agent(), latestRuntime: runtime(), commandCounts, now: NOW });
    expect(preflight.launch.ready).toBe(false);
    expect(preflight.quit.ready).toBe(false);
  });

  it("sanitizes the browser model while retaining concrete gate reasons", () => {
    const preflight = evaluateProcessControlPreflight({ agent: agent(), latestRuntime: runtime(), commandCounts: noCommands, now: NOW });
    const model = buildProcessControlDashboardModel(agent(), preflight);
    const serialized = JSON.stringify(model);
    expect(model.processStatus).toBe("running");
    expect(model.quit.reason).toContain("queued readiness check only");
    expect(model.quit.reason).toContain("actuation remains unavailable");
    expect(serialized).not.toContain(INSTALLATION_REF);
    expect(serialized).not.toContain(PROCESS_REF);
    expect(serialized).not.toContain(STATE_VERSION);
    expect(serialized).not.toContain("9232");
  });
});
