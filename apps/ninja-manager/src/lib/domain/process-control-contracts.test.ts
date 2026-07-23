import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { hashCanonicalPayload } from "@/lib/domain/runtime-contracts";
import {
  createDeliveredProcessControlCommand,
  MAX_PROCESS_CONTROL_TTL_MS,
  parseDeliveredProcessControlCommand,
  parseProcessControlAcknowledgement,
  PROCESS_CONTROL_PROTOCOL_VERSION,
  processControlApprovalIntentHash,
  processControlCommandSchema,
  processQuitBlockers,
  processQuitRuntimeStateDigest,
  type ProcessControlCommand,
  type ProcessQuitSafetySummary,
} from "@/lib/domain/process-control-contracts";

const ISSUED_AT = "2026-07-21T15:00:00.000Z";
const INSTALLATION_REF = `install_${"a".repeat(32)}`;
const PROCESS_REF = `process_${"b".repeat(32)}`;
const STATE_VERSION = `sha256:${"1".repeat(64)}`;

type LaunchCommand = Extract<ProcessControlCommand, { commandType: "LAUNCH_NINJATRADER" }>;
type QuitCommand = Extract<ProcessControlCommand, { commandType: "REQUEST_NINJATRADER_QUIT" }>;

function safeSummary(): ProcessQuitSafetySummary {
  return {
    armedScheduleCount: 0,
    accountCounts: { simulation: 1, evaluation: 0, funded: 0, live: 0, unknown: 0 },
    strategyCounts: { enabled: 0, unknown: 0 },
    positionCounts: { open: 0, unknown: 0 },
    orderCounts: { working: 0, transitional: 0, unknown: 0 },
    commandCounts: { inFlight: 0, indeterminate: 0 },
  };
}

function withApprovalIntent<T extends ProcessControlCommand>(command: T): T {
  command.approval.intentHash = processControlApprovalIntentHash(command);
  return command;
}

function launchCommand(): LaunchCommand {
  return withApprovalIntent({
    protocolVersion: PROCESS_CONTROL_PROTOCOL_VERSION,
    commandType: "LAUNCH_NINJATRADER",
    commandId: randomUUID(),
    correlationId: randomUUID(),
    agentId: randomUUID(),
    idempotencyKey: `process-control:${randomUUID()}`,
    issuedAt: ISSUED_AT,
    expiresAt: "2026-07-21T15:00:45.000Z",
    expectedProcessStateVersion: STATE_VERSION,
    dryRun: false,
    safetyPhase: "local_supervised_process_control",
    approval: {
      approvalId: randomUUID(),
      interactiveConfirmationId: randomUUID(),
      approvedCommandType: "LAUNCH_NINJATRADER",
      issuedAt: "2026-07-21T14:59:50.000Z",
      expiresAt: "2026-07-21T15:00:50.000Z",
      intentHash: `sha256:${"0".repeat(64)}`,
    },
    payload: {
      target: { installationRef: INSTALLATION_REF },
      reasonCode: "MANUAL_OPERATOR_LAUNCH",
    },
  });
}

function quitCommand(summary = safeSummary()): QuitCommand {
  const observedAt = "2026-07-21T14:59:45.000Z";
  return withApprovalIntent({
    protocolVersion: PROCESS_CONTROL_PROTOCOL_VERSION,
    commandType: "REQUEST_NINJATRADER_QUIT",
    commandId: randomUUID(),
    correlationId: randomUUID(),
    agentId: randomUUID(),
    idempotencyKey: `process-control:${randomUUID()}`,
    issuedAt: ISSUED_AT,
    expiresAt: "2026-07-21T15:00:45.000Z",
    expectedProcessStateVersion: STATE_VERSION,
    dryRun: false,
    safetyPhase: "local_supervised_process_control",
    approval: {
      approvalId: randomUUID(),
      interactiveConfirmationId: randomUUID(),
      approvedCommandType: "REQUEST_NINJATRADER_QUIT",
      issuedAt: "2026-07-21T14:59:50.000Z",
      expiresAt: "2026-07-21T15:00:50.000Z",
      intentHash: `sha256:${"0".repeat(64)}`,
    },
    payload: {
      target: { installationRef: INSTALLATION_REF, processRef: PROCESS_REF },
      reasonCode: "MANUAL_OPERATOR_QUIT",
      runtimeState: {
        observedAt,
        digest: processQuitRuntimeStateDigest(observedAt, summary),
        summary,
      },
    },
  });
}

function acknowledgementEnvelope() {
  return {
    protocolVersion: PROCESS_CONTROL_PROTOCOL_VERSION,
    acknowledgementId: randomUUID(),
    commandId: randomUUID(),
    correlationId: randomUUID(),
    agentId: randomUUID(),
    leaseId: randomUUID(),
    sequence: 2,
    occurredAt: "2026-07-21T15:00:20.000Z",
  };
}

function readyLaunchReadiness(observedAt = "2026-07-21T15:00:19.000Z") {
  return {
    state: "ready" as const,
    observedAt,
    source: "authenticated_runtime_v2_addon_ipc" as const,
    authenticated: true as const,
    reasonCode: null,
  };
}

function completedQuitAcknowledgement() {
  const preflight = safeSummary();
  const runtimeObservedAt = "2026-07-21T14:59:58.000Z";
  const evidence = {
    target: { installationRef: INSTALLATION_REF, processRef: PROCESS_REF },
    runtimeStateDigest: processQuitRuntimeStateDigest(runtimeObservedAt, preflight),
    runtimeObservedAt,
    preflight,
    blockers: [] as ReturnType<typeof processQuitBlockers>,
    preProcessStateVersion: STATE_VERSION,
    postProcessStateVersion: `sha256:${"2".repeat(64)}`,
    postObservedAt: "2026-07-21T15:00:18.000Z",
    preProcessState: "running" as const,
    postProcessState: "stopped" as const,
    matchedProcessCount: 1,
    gracefulQuitRequested: true,
    forceKillUsed: false as const,
    cancelOrdersUsed: false as const,
    flattenPositionsUsed: false as const,
    disconnectConnectionsUsed: false as const,
    mutationMayHaveOccurred: true,
    retrySafe: false,
  };
  return {
    ...acknowledgementEnvelope(),
    commandType: "REQUEST_NINJATRADER_QUIT" as const,
    status: "completed" as const,
    outcomeCode: "GRACEFUL_QUIT_VERIFIED" as const,
    evidence,
    evidenceHash: hashCanonicalPayload(evidence),
  };
}

describe("process-control/1.0 commands", () => {
  it("round-trips exact allowlisted launch and quit targets with canonical integrity", () => {
    for (const command of [launchCommand(), quitCommand()]) {
      const delivered = createDeliveredProcessControlCommand(command);
      expect(parseDeliveredProcessControlCommand(delivered)).toEqual(delivered);
    }
  });

  it("accepts authoritative discovery refs and rejects legacy nt-prefixed refs", () => {
    expect(processControlCommandSchema.parse(launchCommand()).payload.target.installationRef).toBe(INSTALLATION_REF);
    expect(processControlCommandSchema.parse(quitCommand()).payload.target).toEqual({
      installationRef: INSTALLATION_REF,
      processRef: PROCESS_REF,
    });

    const oldLaunch = launchCommand();
    oldLaunch.payload.target.installationRef = `nt_install_${"a".repeat(32)}`;
    expect(() => processControlCommandSchema.parse(oldLaunch)).toThrow();

    const oldQuit = quitCommand();
    oldQuit.payload.target.processRef = `nt_process_${"b".repeat(32)}`;
    expect(() => processControlCommandSchema.parse(oldQuit)).toThrow();
  });

  it("rejects browser-supplied paths, arguments, and broad targets", () => {
    const launch = launchCommand() as unknown as Record<string, unknown>;
    launch.payload = {
      ...launch.payload as object,
      target: {
        installationRef: INSTALLATION_REF,
        executablePath: "C:\\untrusted\\NinjaTrader.exe",
        arguments: ["--connect"],
        allInstallations: true,
      },
    };
    expect(() => processControlCommandSchema.parse(launch)).toThrow();

    const quit = quitCommand() as unknown as Record<string, unknown>;
    quit.payload = {
      ...quit.payload as object,
      target: { installationRef: INSTALLATION_REF, allProcesses: true },
    };
    expect(() => processControlCommandSchema.parse(quit)).toThrow();
  });

  it("limits commands and approvals to 60 seconds", () => {
    const command = launchCommand();
    command.expiresAt = new Date(Date.parse(command.issuedAt) + MAX_PROCESS_CONTROL_TTL_MS + 1).toISOString();
    command.approval.expiresAt = command.expiresAt;
    expect(() => processControlCommandSchema.parse(command)).toThrow(/lifetime exceeds 60 seconds/);

    const approval = launchCommand();
    approval.approval.issuedAt = "2026-07-21T14:59:49.999Z";
    expect(() => processControlCommandSchema.parse(approval)).toThrow(/approval lifetime exceeds 60 seconds/i);
  });

  it("requires a fresh quit runtime digest", () => {
    const stale = quitCommand();
    stale.payload.runtimeState.observedAt = "2026-07-21T14:59:29.999Z";
    stale.payload.runtimeState.digest = processQuitRuntimeStateDigest(
      stale.payload.runtimeState.observedAt,
      stale.payload.runtimeState.summary,
    );
    stale.approval.intentHash = processControlApprovalIntentHash(stale);
    expect(() => processControlCommandSchema.parse(stale)).toThrow(/older than 30 seconds/);
  });

  it.each([
    ["armed schedule", (value: ProcessQuitSafetySummary) => { value.armedScheduleCount = 1; }, "SCHEDULES_ARMED"],
    ["evaluation account", (value: ProcessQuitSafetySummary) => { value.accountCounts.evaluation = 1; }, "NON_SIMULATION_ACCOUNT_PRESENT"],
    ["funded account", (value: ProcessQuitSafetySummary) => { value.accountCounts.funded = 1; }, "NON_SIMULATION_ACCOUNT_PRESENT"],
    ["live account", (value: ProcessQuitSafetySummary) => { value.accountCounts.live = 1; }, "NON_SIMULATION_ACCOUNT_PRESENT"],
    ["unknown account", (value: ProcessQuitSafetySummary) => { value.accountCounts.unknown = 1; }, "NON_SIMULATION_ACCOUNT_PRESENT"],
    ["enabled strategy", (value: ProcessQuitSafetySummary) => { value.strategyCounts.enabled = 1; }, "STRATEGY_ENABLED_OR_UNKNOWN"],
    ["unknown strategy", (value: ProcessQuitSafetySummary) => { value.strategyCounts.unknown = 1; }, "STRATEGY_ENABLED_OR_UNKNOWN"],
    ["open position", (value: ProcessQuitSafetySummary) => { value.positionCounts.open = 1; }, "POSITION_OPEN_OR_UNKNOWN"],
    ["unknown position", (value: ProcessQuitSafetySummary) => { value.positionCounts.unknown = 1; }, "POSITION_OPEN_OR_UNKNOWN"],
    ["working order", (value: ProcessQuitSafetySummary) => { value.orderCounts.working = 1; }, "ORDER_WORKING_TRANSITIONAL_OR_UNKNOWN"],
    ["transitional order", (value: ProcessQuitSafetySummary) => { value.orderCounts.transitional = 1; }, "ORDER_WORKING_TRANSITIONAL_OR_UNKNOWN"],
    ["unknown order", (value: ProcessQuitSafetySummary) => { value.orderCounts.unknown = 1; }, "ORDER_WORKING_TRANSITIONAL_OR_UNKNOWN"],
    ["in-flight command", (value: ProcessQuitSafetySummary) => { value.commandCounts.inFlight = 1; }, "COMMAND_IN_FLIGHT_OR_INDETERMINATE"],
    ["indeterminate command", (value: ProcessQuitSafetySummary) => { value.commandCounts.indeterminate = 1; }, "COMMAND_IN_FLIGHT_OR_INDETERMINATE"],
  ])("blocks quit for %s", (_label, mutate, expectedBlocker) => {
    const summary = safeSummary();
    mutate(summary);
    expect(processQuitBlockers(summary)).toContain(expectedBlocker);
    expect(() => processControlCommandSchema.parse(quitCommand(summary))).toThrow(/Quit preflight is blocked/);
  });

  it("rejects tampered command payload and approval intent", () => {
    const delivered = createDeliveredProcessControlCommand(launchCommand());
    const tampered = structuredClone(delivered);
    tampered.command.payload.target.installationRef = `install_${"c".repeat(32)}`;
    expect(() => parseDeliveredProcessControlCommand(tampered)).toThrow();
  });
});

describe("process-control/1.0 outcomes", () => {
  it("accepts a launch only with a new authoritative post-state observation", () => {
    const evidence = {
      target: { installationRef: INSTALLATION_REF },
      preProcessStateVersion: STATE_VERSION,
      postProcessStateVersion: `sha256:${"2".repeat(64)}`,
      postObservedAt: "2026-07-21T15:00:18.000Z",
      preProcessState: "stopped" as const,
      postProcessState: "running" as const,
      processRef: PROCESS_REF,
      matchedInstallationCount: 1,
      actuatorInvoked: true,
      mutationMayHaveOccurred: true,
      retrySafe: false,
      launchReadiness: readyLaunchReadiness(),
    };
    const acknowledgement = {
      ...acknowledgementEnvelope(),
      commandType: "LAUNCH_NINJATRADER" as const,
      status: "completed" as const,
      outcomeCode: "LAUNCHED" as const,
      evidence,
      evidenceHash: hashCanonicalPayload(evidence),
    };
    expect(parseProcessControlAcknowledgement(acknowledgement).outcomeCode).toBe("LAUNCHED");

    const staleEvidence = { ...evidence, postObservedAt: null };
    expect(() => parseProcessControlAcknowledgement({
      ...acknowledgement,
      evidence: staleEvidence,
      evidenceHash: hashCanonicalPayload(staleEvidence),
    })).toThrow(/present together|verified running post-state/);

    const equalVersionEvidence = { ...evidence, postProcessStateVersion: STATE_VERSION };
    expect(() => parseProcessControlAcknowledgement({
      ...acknowledgement,
      evidence: equalVersionEvidence,
      evidenceHash: hashCanonicalPayload(equalVersionEvidence),
    })).toThrow(/verified running post-state/);

    const futureEvidence = { ...evidence, postObservedAt: "2026-07-21T15:00:20.001Z" };
    expect(() => parseProcessControlAcknowledgement({
      ...acknowledgement,
      evidence: futureEvidence,
      evidenceHash: hashCanonicalPayload(futureEvidence),
    })).toThrow(/cannot follow acknowledgement time/);

    const tampered = structuredClone(acknowledgement);
    tampered.evidence.postObservedAt = "2026-07-21T15:00:17.000Z";
    expect(() => parseProcessControlAcknowledgement(tampered)).toThrow(/evidence hash/);
  });

  it("accepts a verified already-running launch no-op", () => {
    const evidence = {
      target: { installationRef: INSTALLATION_REF },
      preProcessStateVersion: STATE_VERSION,
      postProcessStateVersion: STATE_VERSION,
      postObservedAt: "2026-07-21T15:00:18.000Z",
      preProcessState: "running" as const,
      postProcessState: "running" as const,
      processRef: PROCESS_REF,
      matchedInstallationCount: 1,
      actuatorInvoked: false,
      mutationMayHaveOccurred: false,
      retrySafe: true,
      launchReadiness: readyLaunchReadiness(),
    };
    const acknowledgement = {
      ...acknowledgementEnvelope(),
      commandType: "LAUNCH_NINJATRADER" as const,
      status: "completed" as const,
      outcomeCode: "ALREADY_RUNNING" as const,
      evidence,
      evidenceHash: hashCanonicalPayload(evidence),
    };
    expect(parseProcessControlAcknowledgement(acknowledgement).outcomeCode).toBe("ALREADY_RUNNING");

    const changedEvidence = { ...evidence, postProcessStateVersion: `sha256:${"2".repeat(64)}` };
    expect(() => parseProcessControlAcknowledgement({
      ...acknowledgement,
      evidence: changedEvidence,
      evidenceHash: hashCanonicalPayload(changedEvidence),
    })).toThrow(/verified no-op/);
  });

  it("accepts waiting for manual login only as attention required", () => {
    const evidence = {
      target: { installationRef: INSTALLATION_REF },
      preProcessStateVersion: STATE_VERSION,
      postProcessStateVersion: `sha256:${"2".repeat(64)}`,
      postObservedAt: "2026-07-21T15:00:18.000Z",
      preProcessState: "stopped" as const,
      postProcessState: "waiting_for_login" as const,
      processRef: PROCESS_REF,
      matchedInstallationCount: 1,
      actuatorInvoked: true,
      mutationMayHaveOccurred: true,
      retrySafe: false,
      launchReadiness: {
        state: "not_ready" as const,
        observedAt: "2026-07-21T15:00:19.000Z",
        source: "authenticated_runtime_v2_addon_ipc" as const,
        authenticated: true as const,
        reasonCode: "LOGIN_REQUIRED" as const,
      },
    };
    const acknowledgement = {
      ...acknowledgementEnvelope(),
      commandType: "LAUNCH_NINJATRADER" as const,
      status: "attention_required" as const,
      outcomeCode: "WAITING_FOR_LOGIN" as const,
      evidence,
      evidenceHash: hashCanonicalPayload(evidence),
    };
    expect(parseProcessControlAcknowledgement(acknowledgement).status).toBe("attention_required");
    expect(() => parseProcessControlAcknowledgement({ ...acknowledgement, status: "completed" })).toThrow();

    const equalVersionEvidence = { ...evidence, postProcessStateVersion: STATE_VERSION };
    expect(() => parseProcessControlAcknowledgement({
      ...acknowledgement,
      evidence: equalVersionEvidence,
      evidenceHash: hashCanonicalPayload(equalVersionEvidence),
    })).toThrow(/waiting-for-login outcome lacks verified process evidence/i);
  });

  it("rejects PID-only or stale readiness evidence as launch completion", () => {
    const baseEvidence = {
      target: { installationRef: INSTALLATION_REF },
      preProcessStateVersion: STATE_VERSION,
      postProcessStateVersion: `sha256:${"2".repeat(64)}`,
      postObservedAt: "2026-07-21T15:00:18.000Z",
      preProcessState: "stopped" as const,
      postProcessState: "running" as const,
      processRef: PROCESS_REF,
      matchedInstallationCount: 1,
      actuatorInvoked: true,
      mutationMayHaveOccurred: true,
      retrySafe: false,
    };
    for (const launchReadiness of [
      undefined,
      {
        state: "unknown" as const,
        observedAt: "2026-07-21T15:00:19.000Z",
        source: "authenticated_runtime_v2_addon_ipc" as const,
        authenticated: false,
        reasonCode: "PROVIDER_UNAVAILABLE" as const,
      },
      readyLaunchReadiness("2026-07-21T15:00:14.000Z"),
    ]) {
      const evidence = launchReadiness ? { ...baseEvidence, launchReadiness } : baseEvidence;
      expect(() => parseProcessControlAcknowledgement({
        ...acknowledgementEnvelope(),
        commandType: "LAUNCH_NINJATRADER",
        status: "completed",
        outcomeCode: "LAUNCHED",
        evidence,
        evidenceHash: hashCanonicalPayload(evidence),
      })).toThrow(/verified running post-state/);
    }
  });

  it("accepts precise attention outcomes with truthful no-op and post-start evidence", () => {
    const unknownReadiness = {
      state: "unknown" as const,
      observedAt: "2026-07-21T15:00:19.000Z",
      source: "authenticated_runtime_v2_addon_ipc" as const,
      authenticated: false,
      reasonCode: "PROVIDER_ERROR" as const,
    };
    const alreadyEvidence = {
      target: { installationRef: INSTALLATION_REF },
      preProcessStateVersion: STATE_VERSION,
      postProcessStateVersion: STATE_VERSION,
      postObservedAt: "2026-07-21T15:00:18.000Z",
      preProcessState: "running" as const,
      postProcessState: "running" as const,
      processRef: PROCESS_REF,
      matchedInstallationCount: 1,
      actuatorInvoked: false,
      mutationMayHaveOccurred: false,
      retrySafe: true,
      launchReadiness: unknownReadiness,
    };
    const already = {
      ...acknowledgementEnvelope(),
      commandType: "LAUNCH_NINJATRADER" as const,
      status: "attention_required" as const,
      outcomeCode: "ALREADY_RUNNING_READINESS_UNCONFIRMED" as const,
      evidence: alreadyEvidence,
      evidenceHash: hashCanonicalPayload(alreadyEvidence),
    };
    expect(parseProcessControlAcknowledgement(already).outcomeCode)
      .toBe("ALREADY_RUNNING_READINESS_UNCONFIRMED");

    const launchedEvidence = {
      ...alreadyEvidence,
      preProcessStateVersion: STATE_VERSION,
      postProcessStateVersion: `sha256:${"2".repeat(64)}`,
      preProcessState: "stopped" as const,
      actuatorInvoked: true,
      mutationMayHaveOccurred: true,
      retrySafe: false,
    };
    const launched = {
      ...already,
      outcomeCode: "LAUNCHED_READINESS_UNCONFIRMED" as const,
      evidence: launchedEvidence,
      evidenceHash: hashCanonicalPayload(launchedEvidence),
    };
    expect(parseProcessControlAcknowledgement(launched).outcomeCode)
      .toBe("LAUNCHED_READINESS_UNCONFIRMED");
  });

  it.each([
    "INSTALLATION_NOT_ALLOWLISTED",
    "TARGET_AMBIGUOUS",
    "PROCESS_STATE_CHANGED",
  ] as const)("rejects false-success launch outcome %s", (outcomeCode) => {
    const evidence = {
      target: { installationRef: INSTALLATION_REF },
      preProcessStateVersion: STATE_VERSION,
      postProcessStateVersion: null,
      postObservedAt: null,
      preProcessState: "unknown" as const,
      postProcessState: "unknown" as const,
      processRef: null,
      matchedInstallationCount: 0,
      actuatorInvoked: false,
      mutationMayHaveOccurred: false,
      retrySafe: false,
    };
    const falseSuccess = {
      ...acknowledgementEnvelope(),
      commandType: "LAUNCH_NINJATRADER" as const,
      status: "completed" as const,
      outcomeCode,
      evidence,
      evidenceHash: hashCanonicalPayload(evidence),
    };
    expect(() => parseProcessControlAcknowledgement(falseSuccess)).toThrow(/does not match its status/);
  });

  it.each([
    ["INSTALLATION_NOT_ALLOWLISTED", 0, null],
    ["TARGET_AMBIGUOUS", 2, null],
    ["PROCESS_STATE_CHANGED", 1, PROCESS_REF],
  ] as const)("accepts blocked launch %s only with exact no-actuation evidence", (outcomeCode, matchedInstallationCount, processRef) => {
    const evidence = {
      target: { installationRef: INSTALLATION_REF },
      preProcessStateVersion: STATE_VERSION,
      postProcessStateVersion: null,
      postObservedAt: null,
      preProcessState: "unknown" as const,
      postProcessState: "unknown" as const,
      processRef,
      matchedInstallationCount,
      actuatorInvoked: false,
      mutationMayHaveOccurred: false,
      retrySafe: false,
    };
    const blocked = {
      ...acknowledgementEnvelope(),
      commandType: "LAUNCH_NINJATRADER" as const,
      status: "blocked" as const,
      outcomeCode,
      evidence,
      evidenceHash: hashCanonicalPayload(evidence),
    };
    expect(parseProcessControlAcknowledgement(blocked).status).toBe("blocked");

    const invokedEvidence = { ...evidence, actuatorInvoked: true, mutationMayHaveOccurred: true };
    expect(() => parseProcessControlAcknowledgement({
      ...blocked,
      evidence: invokedEvidence,
      evidenceHash: hashCanonicalPayload(invokedEvidence),
    })).toThrow(/exact no-actuation evidence/);

    const postEvidence = {
      ...evidence,
      postProcessStateVersion: `sha256:${"2".repeat(64)}`,
      postObservedAt: "2026-07-21T15:00:18.000Z",
    };
    expect(() => parseProcessControlAcknowledgement({
      ...blocked,
      evidence: postEvidence,
      evidenceHash: hashCanonicalPayload(postEvidence),
    })).toThrow(/exact no-actuation evidence/);
  });

  it("accepts completed quit only with safe preflight and verified stopped evidence", () => {
    expect(parseProcessControlAcknowledgement(completedQuitAcknowledgement()).status).toBe("completed");
  });

  it("accepts an exact already-stopped quit as a verified no-op", () => {
    const completed = completedQuitAcknowledgement();
    const evidence = {
      ...completed.evidence,
      preProcessState: "stopped" as const,
      postProcessState: "stopped" as const,
      gracefulQuitRequested: false,
      mutationMayHaveOccurred: false,
      retrySafe: true,
    };
    const noOp = {
      ...completed,
      outcomeCode: "ALREADY_STOPPED" as const,
      evidence,
      evidenceHash: hashCanonicalPayload(evidence),
    };
    expect(parseProcessControlAcknowledgement(noOp).outcomeCode).toBe("ALREADY_STOPPED");
  });

  it("rejects completed quit with missing or contradictory authoritative post-state", () => {
    const completed = completedQuitAcknowledgement();
    const missingEvidence = {
      ...completed.evidence,
      postProcessStateVersion: null,
      postObservedAt: null,
    };
    expect(() => parseProcessControlAcknowledgement({
      ...completed,
      evidence: missingEvidence,
      evidenceHash: hashCanonicalPayload(missingEvidence),
    })).toThrow(/verified stopped post-state/);

    const contradictoryEvidence = { ...completed.evidence, postProcessState: "running" as const };
    expect(() => parseProcessControlAcknowledgement({
      ...completed,
      evidence: contradictoryEvidence,
      evidenceHash: hashCanonicalPayload(contradictoryEvidence),
    })).toThrow(/verified stopped post-state/);

    const ambiguousEvidence = { ...completed.evidence, matchedProcessCount: 2 };
    expect(() => parseProcessControlAcknowledgement({
      ...completed,
      evidence: ambiguousEvidence,
      evidenceHash: hashCanonicalPayload(ambiguousEvidence),
    })).toThrow(/verified stopped post-state/);
  });

  it("requires blocked quit evidence to identify every observed blocker without actuation", () => {
    const preflight = safeSummary();
    preflight.armedScheduleCount = 1;
    preflight.orderCounts.working = 2;
    const runtimeObservedAt = "2026-07-21T14:59:58.000Z";
    const evidence = {
      target: { installationRef: INSTALLATION_REF, processRef: PROCESS_REF },
      runtimeStateDigest: processQuitRuntimeStateDigest(runtimeObservedAt, preflight),
      runtimeObservedAt,
      preflight,
      blockers: processQuitBlockers(preflight),
      preProcessStateVersion: STATE_VERSION,
      postProcessStateVersion: null,
      postObservedAt: null,
      preProcessState: "running" as const,
      postProcessState: "running" as const,
      matchedProcessCount: 1,
      gracefulQuitRequested: false,
      forceKillUsed: false as const,
      cancelOrdersUsed: false as const,
      flattenPositionsUsed: false as const,
      disconnectConnectionsUsed: false as const,
      mutationMayHaveOccurred: false,
      retrySafe: false,
    };
    const acknowledgement = {
      ...acknowledgementEnvelope(),
      commandType: "REQUEST_NINJATRADER_QUIT" as const,
      status: "blocked" as const,
      outcomeCode: "PREFLIGHT_BLOCKED" as const,
      evidence,
      evidenceHash: hashCanonicalPayload(evidence),
    };
    expect(parseProcessControlAcknowledgement(acknowledgement).status).toBe("blocked");
  });

  it.each([
    "INSTALLATION_NOT_ALLOWLISTED",
    "TARGET_NOT_FOUND",
    "TARGET_AMBIGUOUS",
    "PROCESS_STATE_CHANGED",
    "RUNTIME_STATE_STALE",
  ] as const)("blocks quit without actuation for %s", (blocker) => {
    const preflight = safeSummary();
    const runtimeObservedAt = "2026-07-21T14:59:58.000Z";
    const evidence = {
      target: { installationRef: INSTALLATION_REF, processRef: PROCESS_REF },
      runtimeStateDigest: processQuitRuntimeStateDigest(runtimeObservedAt, preflight),
      runtimeObservedAt,
      preflight,
      blockers: [blocker],
      preProcessStateVersion: STATE_VERSION,
      postProcessStateVersion: null,
      postObservedAt: null,
      preProcessState: "unknown" as const,
      postProcessState: "unknown" as const,
      matchedProcessCount: 0,
      gracefulQuitRequested: false,
      forceKillUsed: false as const,
      cancelOrdersUsed: false as const,
      flattenPositionsUsed: false as const,
      disconnectConnectionsUsed: false as const,
      mutationMayHaveOccurred: false,
      retrySafe: false,
    };
    const acknowledgement = {
      ...acknowledgementEnvelope(),
      commandType: "REQUEST_NINJATRADER_QUIT" as const,
      status: "blocked" as const,
      outcomeCode: "PREFLIGHT_BLOCKED" as const,
      evidence,
      evidenceHash: hashCanonicalPayload(evidence),
    };
    expect(parseProcessControlAcknowledgement(acknowledgement).status).toBe("blocked");
  });

  it("makes an indeterminate quit non-retryable and prohibits destructive fallbacks", () => {
    const completed = completedQuitAcknowledgement();
    const acknowledgement = {
      ...completed,
      status: "indeterminate" as const,
      outcomeCode: "QUIT_RESULT_UNKNOWN" as const,
      evidence: {
        ...completed.evidence,
        postProcessState: "unknown" as const,
        retrySafe: false,
      },
      evidenceHash: hashCanonicalPayload({
        ...completed.evidence,
        postProcessState: "unknown",
        retrySafe: false,
      }),
    };
    expect(parseProcessControlAcknowledgement(acknowledgement).status).toBe("indeterminate");

    const retryable = structuredClone(acknowledgement);
    retryable.evidence.retrySafe = true;
    retryable.evidenceHash = hashCanonicalPayload(retryable.evidence);
    expect(() => parseProcessControlAcknowledgement(retryable)).toThrow(/cannot be retried/);

    const destructive = structuredClone(acknowledgement) as unknown as Record<string, unknown>;
    destructive.evidence = { ...(destructive.evidence as object), forceKillUsed: true };
    expect(() => parseProcessControlAcknowledgement(destructive)).toThrow();
  });

  it("rejects tampered acknowledgement evidence and hashes", () => {
    const acknowledgement = completedQuitAcknowledgement();
    const tampered = {
      ...acknowledgement,
      evidence: { ...acknowledgement.evidence, postProcessState: "running" },
    };
    expect(() => parseProcessControlAcknowledgement(tampered)).toThrow();

    const valid = completedQuitAcknowledgement();
    valid.evidenceHash = `sha256:${"f".repeat(64)}`;
    expect(() => parseProcessControlAcknowledgement(valid)).toThrow(/evidence hash/);
  });
});
