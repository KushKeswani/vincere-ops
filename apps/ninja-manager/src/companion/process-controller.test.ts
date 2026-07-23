import { randomUUID } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  createDeliveredProcessControlCommand,
  PROCESS_CONTROL_PROTOCOL_VERSION,
  processControlApprovalIntentHash,
  processQuitRuntimeStateDigest,
  type LaunchReadinessObservation,
  type ProcessControlCommand,
  type ProcessQuitSafetySummary,
} from "@/lib/domain/process-control-contracts";

import {
  deriveProcessRef,
  deriveProcessStateVersion,
  NinjaTraderProcessController as BaseNinjaTraderProcessController,
  type ExactProcessTarget,
  type PlatformProcessRecord,
  type ProcessControlExecutionContext,
  type ProcessControllerConfig,
  type ProcessControllerExecutionHooks,
  type ProcessPlatform,
  type ProcessPlatformObservation,
} from "./process-controller";

const INSTALLATION_REF = `install_${"a".repeat(32)}`;
const OTHER_INSTALLATION_REF = `install_${"c".repeat(32)}`;
const EXECUTABLE = "C:\\Program Files\\NinjaTrader 8\\bin\\NinjaTrader.exe";
const OTHER_EXECUTABLE = "D:\\NinjaTrader 8\\bin\\NinjaTrader.exe";
const SECRET = Buffer.alloc(32, 7);
const NOW = new Date("2026-07-21T15:00:20.000Z");
const RUNTIME_OBSERVED_AT = "2026-07-21T15:00:10.000Z";
const CONTEXT = {
  leaseId: "25a89351-6357-462e-820d-796bd5ac7eed",
  sequence: 1,
  serverDeadlineMonotonicMs: 1_000_000_000_000,
};

const awaitedTestHooks: ProcessControllerExecutionHooks = {
  beforeActuation: async () => undefined,
};

class NinjaTraderProcessController extends BaseNinjaTraderProcessController {
  override execute(
    deliveredInput: unknown,
    contextInput: ProcessControlExecutionContext,
    hooks: ProcessControllerExecutionHooks = awaitedTestHooks,
  ) {
    return super.execute(deliveredInput, contextInput, hooks);
  }
}

const compileOnlyOmittedHook = (
  controller: BaseNinjaTraderProcessController,
  delivered: unknown,
) => {
  // @ts-expect-error The production controller requires a durable hook.
  return controller.execute(delivered, CONTEXT);
};
void compileOnlyOmittedHook;

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

function runtimeState(summary = safeSummary(), observedAt = RUNTIME_OBSERVED_AT) {
  return {
    observedAt,
    digest: processQuitRuntimeStateDigest(observedAt, summary),
    summary,
  };
}

function record(
  state: PlatformProcessRecord["state"],
  input: Partial<PlatformProcessRecord> = {},
): PlatformProcessRecord {
  return {
    executablePath: EXECUTABLE,
    pid: 9232,
    startedAt: "2026-07-21T13:00:00.000Z",
    state,
    ...input,
  };
}

function observation(
  processes: PlatformProcessRecord[],
  observedAt: string,
  runtime = runtimeState(),
  launchReadiness: LaunchReadinessObservation | null = {
    state: "ready",
    observedAt,
    source: "authenticated_runtime_v2_addon_ipc",
    authenticated: true,
    reasonCode: null,
  },
): ProcessPlatformObservation {
  return { observedAt, processes, runtimeState: runtime, launchReadiness };
}

function unknownReadiness(
  observedAt: string,
  reasonCode: Extract<LaunchReadinessObservation, { state: "unknown" }>["reasonCode"]
    = "PROVIDER_UNAVAILABLE",
): LaunchReadinessObservation {
  return {
    state: "unknown",
    observedAt,
    source: "authenticated_runtime_v2_addon_ipc",
    authenticated: false,
    reasonCode,
  };
}

function stateVersion(processes: PlatformProcessRecord[]): string {
  return deriveProcessStateVersion(INSTALLATION_REF, EXECUTABLE, processes, SECRET);
}

function withIntent<T extends ProcessControlCommand>(command: T): T {
  command.approval.intentHash = processControlApprovalIntentHash(command);
  return command;
}

function launchDelivery(expectedProcessStateVersion: string, installationRef = INSTALLATION_REF) {
  const command: LaunchCommand = withIntent({
    protocolVersion: PROCESS_CONTROL_PROTOCOL_VERSION,
    commandType: "LAUNCH_NINJATRADER",
    commandId: randomUUID(),
    correlationId: randomUUID(),
    agentId: randomUUID(),
    idempotencyKey: `process-control:${randomUUID()}`,
    issuedAt: "2026-07-21T15:00:15.000Z",
    expiresAt: "2026-07-21T15:00:50.000Z",
    expectedProcessStateVersion,
    dryRun: false,
    safetyPhase: "local_supervised_process_control",
    approval: {
      approvalId: randomUUID(),
      interactiveConfirmationId: randomUUID(),
      approvedCommandType: "LAUNCH_NINJATRADER",
      issuedAt: "2026-07-21T15:00:00.000Z",
      expiresAt: "2026-07-21T15:00:55.000Z",
      intentHash: `sha256:${"0".repeat(64)}`,
    },
    payload: {
      target: { installationRef },
      reasonCode: "MANUAL_OPERATOR_LAUNCH",
    },
  });
  return createDeliveredProcessControlCommand(command);
}

function quitDelivery(
  target: PlatformProcessRecord,
  expectedProcessStateVersion: string,
  commandRuntimeState = runtimeState(),
) {
  const command: QuitCommand = withIntent({
    protocolVersion: PROCESS_CONTROL_PROTOCOL_VERSION,
    commandType: "REQUEST_NINJATRADER_QUIT",
    commandId: randomUUID(),
    correlationId: randomUUID(),
    agentId: randomUUID(),
    idempotencyKey: `process-control:${randomUUID()}`,
    issuedAt: "2026-07-21T15:00:15.000Z",
    expiresAt: "2026-07-21T15:00:50.000Z",
    expectedProcessStateVersion,
    dryRun: false,
    safetyPhase: "local_supervised_process_control",
    approval: {
      approvalId: randomUUID(),
      interactiveConfirmationId: randomUUID(),
      approvedCommandType: "REQUEST_NINJATRADER_QUIT",
      issuedAt: "2026-07-21T15:00:00.000Z",
      expiresAt: "2026-07-21T15:00:55.000Z",
      intentHash: `sha256:${"0".repeat(64)}`,
    },
    payload: {
      target: {
        installationRef: INSTALLATION_REF,
        processRef: deriveProcessRef(SECRET, target),
      },
      reasonCode: "MANUAL_OPERATOR_QUIT",
      runtimeState: commandRuntimeState,
    },
  });
  return createDeliveredProcessControlCommand(command);
}

class FakePlatform implements ProcessPlatform {
  readonly observeCalls: string[] = [];
  readonly startCalls: string[] = [];
  readonly closeCalls: ExactProcessTarget[] = [];
  readonly waitCalls: number[] = [];
  failStart = false;
  failClose = false;

  constructor(
    private readonly observations: Array<ProcessPlatformObservation | Error>,
    private readonly clock = NOW,
  ) {}

  async observe(executablePath: string): Promise<ProcessPlatformObservation> {
    this.observeCalls.push(executablePath);
    const next = this.observations.shift();
    if (!next) throw new Error("No fake observation available");
    if (next instanceof Error) throw next;
    return structuredClone(next);
  }

  async start(executablePath: string): Promise<void> {
    this.startCalls.push(executablePath);
    if (this.failStart) throw new Error("start outcome unknown");
  }

  async requestGracefulClose(target: ExactProcessTarget): Promise<void> {
    this.closeCalls.push(structuredClone(target));
    if (this.failClose) throw new Error("close outcome unknown");
  }

  async wait(milliseconds: number): Promise<void> {
    this.waitCalls.push(milliseconds);
  }

  now(): Date {
    return new Date(this.clock);
  }
}

function config(installations: ProcessControllerConfig["installations"] = [{
  installationRef: INSTALLATION_REF,
  executablePath: EXECUTABLE,
}]): ProcessControllerConfig {
  return { installations, observationDelayMs: 25 };
}

describe("NinjaTraderProcessController launch", () => {
  it("launches the exact allowlisted executable with no command-supplied arguments", async () => {
    const running = record("running");
    const platform = new FakePlatform([
      observation([], "2026-07-21T15:00:16.000Z"),
      observation([], "2026-07-21T15:00:17.000Z"),
      observation([running], "2026-07-21T15:00:18.000Z"),
    ]);
    const controller = new NinjaTraderProcessController(config(), SECRET, platform);

    const result = await controller.execute(launchDelivery(stateVersion([])), CONTEXT);

    expect(result.status).toBe("completed");
    expect(result.outcomeCode).toBe("LAUNCHED");
    expect(platform.startCalls).toEqual([EXECUTABLE]);
    expect(platform.closeCalls).toEqual([]);
    if (result.commandType !== "LAUNCH_NINJATRADER") throw new Error("Expected launch acknowledgement");
    expect(result.evidence.processRef).toBe(deriveProcessRef(SECRET, running));
  });

  it("returns a verified already-running no-op", async () => {
    const running = record("running");
    const platform = new FakePlatform([
      observation([running], "2026-07-21T15:00:16.000Z"),
      observation([running], "2026-07-21T15:00:17.000Z"),
    ]);
    const controller = new NinjaTraderProcessController(config(), SECRET, platform);

    const result = await controller.execute(launchDelivery(stateVersion([running])), CONTEXT);

    expect(result.outcomeCode).toBe("ALREADY_RUNNING");
    expect(platform.startCalls).toEqual([]);
    expect(platform.closeCalls).toEqual([]);
    expect(result.evidence.postProcessStateVersion).toBe(result.evidence.preProcessStateVersion);
  });

  it("blocks an installation allowlist miss without observing or actuating", async () => {
    const platform = new FakePlatform([]);
    const controller = new NinjaTraderProcessController(config(), SECRET, platform);

    const result = await controller.execute(
      launchDelivery(`sha256:${"1".repeat(64)}`, OTHER_INSTALLATION_REF),
      CONTEXT,
    );

    expect(result.outcomeCode).toBe("INSTALLATION_NOT_ALLOWLISTED");
    expect(platform.observeCalls).toEqual([]);
    expect(platform.startCalls).toEqual([]);
    expect(platform.closeCalls).toEqual([]);
  });

  it("blocks an ambiguous local allowlist without observing or actuating", async () => {
    const platform = new FakePlatform([]);
    const controller = new NinjaTraderProcessController(config([
      { installationRef: INSTALLATION_REF, executablePath: EXECUTABLE },
      { installationRef: INSTALLATION_REF, executablePath: OTHER_EXECUTABLE },
    ]), SECRET, platform);

    const result = await controller.execute(launchDelivery(`sha256:${"1".repeat(64)}`), CONTEXT);

    expect(result.outcomeCode).toBe("TARGET_AMBIGUOUS");
    if (result.commandType !== "LAUNCH_NINJATRADER") throw new Error("Expected launch acknowledgement");
    expect(result.evidence.matchedInstallationCount).toBe(2);
    expect(platform.observeCalls).toEqual([]);
    expect(platform.startCalls).toEqual([]);
  });

  it("requires operator attention when an already-running process has no authenticated Add-On readiness", async () => {
    const running = record("running");
    const platform = new FakePlatform([
      observation([running], "2026-07-21T15:00:16.000Z", runtimeState(), null),
      observation(
        [running],
        "2026-07-21T15:00:17.000Z",
        runtimeState(),
        unknownReadiness("2026-07-21T15:00:17.000Z"),
      ),
    ]);
    const controller = new NinjaTraderProcessController(config(), SECRET, platform);

    const result = await controller.execute(launchDelivery(stateVersion([running])), CONTEXT);

    expect(result.status).toBe("attention_required");
    expect(result.outcomeCode).toBe("ALREADY_RUNNING_READINESS_UNCONFIRMED");
    expect(platform.startCalls).toEqual([]);
    if (result.commandType !== "LAUNCH_NINJATRADER") throw new Error("Expected launch acknowledgement");
    expect(result.evidence).toMatchObject({
      actuatorInvoked: false,
      mutationMayHaveOccurred: false,
      retrySafe: true,
      launchReadiness: { state: "unknown", reasonCode: "PROVIDER_UNAVAILABLE" },
    });
  });

  it("repeats and blocks on a process-state change before launch", async () => {
    const running = record("running");
    const platform = new FakePlatform([
      observation([], "2026-07-21T15:00:16.000Z"),
      observation([running], "2026-07-21T15:00:17.000Z"),
    ]);
    const controller = new NinjaTraderProcessController(config(), SECRET, platform);

    const result = await controller.execute(launchDelivery(stateVersion([])), CONTEXT);

    expect(result.outcomeCode).toBe("PROCESS_STATE_CHANGED");
    expect(platform.observeCalls).toHaveLength(2);
    expect(platform.startCalls).toEqual([]);
    expect(platform.closeCalls).toEqual([]);
  });

  it("reports a started process waiting for manual login", async () => {
    const waiting = record("waiting_for_login");
    const platform = new FakePlatform([
      observation([], "2026-07-21T15:00:16.000Z"),
      observation([], "2026-07-21T15:00:17.000Z"),
      observation([waiting], "2026-07-21T15:00:18.000Z", runtimeState(), {
        state: "not_ready",
        observedAt: "2026-07-21T15:00:18.000Z",
        source: "authenticated_runtime_v2_addon_ipc",
        authenticated: true,
        reasonCode: "LOGIN_REQUIRED",
      }),
    ]);
    const controller = new NinjaTraderProcessController(config(), SECRET, platform);

    const result = await controller.execute(launchDelivery(stateVersion([])), CONTEXT);

    expect(result.status).toBe("attention_required");
    expect(result.outcomeCode).toBe("WAITING_FOR_LOGIN");
    expect(platform.startCalls).toEqual([EXECUTABLE]);
  });

  it("requires operator attention after start when the OS process exists but Add-On readiness is unknown", async () => {
    const running = record("running");
    const platform = new FakePlatform([
      observation([], "2026-07-21T15:00:16.000Z"),
      observation([], "2026-07-21T15:00:17.000Z"),
      observation(
        [running],
        "2026-07-21T15:00:18.000Z",
        runtimeState(),
        unknownReadiness("2026-07-21T15:00:18.000Z"),
      ),
    ]);
    const controller = new NinjaTraderProcessController(config(), SECRET, platform);

    const result = await controller.execute(launchDelivery(stateVersion([])), CONTEXT);

    expect(result.status).toBe("attention_required");
    expect(result.outcomeCode).toBe("LAUNCHED_READINESS_UNCONFIRMED");
    expect(platform.startCalls).toEqual([EXECUTABLE]);
    if (result.commandType !== "LAUNCH_NINJATRADER") throw new Error("Expected launch acknowledgement");
    expect(result.evidence).toMatchObject({
      postProcessState: "running",
      actuatorInvoked: true,
      mutationMayHaveOccurred: true,
      retrySafe: false,
      launchReadiness: { state: "unknown", reasonCode: "PROVIDER_UNAVAILABLE" },
    });
  });

  it("treats a readiness provider error as attention, never completed", async () => {
    const running = record("running");
    const platform = new FakePlatform([
      observation([running], "2026-07-21T15:00:16.000Z"),
      observation(
        [running],
        "2026-07-21T15:00:17.000Z",
        runtimeState(),
        unknownReadiness("2026-07-21T15:00:17.000Z", "PROVIDER_ERROR"),
      ),
    ]);
    const controller = new NinjaTraderProcessController(config(), SECRET, platform);

    const result = await controller.execute(launchDelivery(stateVersion([running])), CONTEXT);

    expect(result).toMatchObject({
      status: "attention_required",
      outcomeCode: "ALREADY_RUNNING_READINESS_UNCONFIRMED",
      evidence: { launchReadiness: { reasonCode: "PROVIDER_ERROR" } },
    });
    expect(platform.startCalls).toEqual([]);
  });

  it("treats missing or stale readiness as attention, never completed", async () => {
    const running = record("running");
    const stale = {
      state: "ready" as const,
      observedAt: "2026-07-21T15:00:10.000Z",
      source: "authenticated_runtime_v2_addon_ipc" as const,
      authenticated: true as const,
      reasonCode: null,
    };
    for (const launchReadiness of [null, stale]) {
      const platform = new FakePlatform([
        observation([running], "2026-07-21T15:00:16.000Z"),
        observation([running], "2026-07-21T15:00:17.000Z", runtimeState(), launchReadiness),
      ]);
      const controller = new NinjaTraderProcessController(config(), SECRET, platform);

      const result = await controller.execute(launchDelivery(stateVersion([running])), CONTEXT);

      expect(result.status).toBe("attention_required");
      expect(result.outcomeCode).toBe("ALREADY_RUNNING_READINESS_UNCONFIRMED");
      expect(platform.startCalls).toEqual([]);
    }
  });

  it("makes an uncertain launch indeterminate and non-retryable", async () => {
    const platform = new FakePlatform([
      observation([], "2026-07-21T15:00:16.000Z"),
      observation([], "2026-07-21T15:00:17.000Z"),
    ]);
    platform.failStart = true;
    const controller = new NinjaTraderProcessController(config(), SECRET, platform);

    const result = await controller.execute(launchDelivery(stateVersion([])), CONTEXT);

    expect(result.status).toBe("indeterminate");
    expect(result.outcomeCode).toBe("LAUNCH_RESULT_UNKNOWN");
    expect(result.evidence.retrySafe).toBe(false);
    expect(platform.startCalls).toEqual([EXECUTABLE]);
  });

  it("awaits the durability hook before starting the allowlisted executable", async () => {
    const running = record("running");
    const platform = new FakePlatform([
      observation([], "2026-07-21T15:00:16.000Z"),
      observation([], "2026-07-21T15:00:17.000Z"),
      observation([running], "2026-07-21T15:00:18.000Z"),
    ]);
    const controller = new NinjaTraderProcessController(config(), SECRET, platform);
    const beforeActuation = vi.fn(async () => {
      expect(platform.startCalls).toEqual([]);
    });

    await controller.execute(launchDelivery(stateVersion([])), CONTEXT, { beforeActuation });

    expect(beforeActuation).toHaveBeenCalledTimes(1);
    expect(platform.startCalls).toEqual([EXECUTABLE]);
  });

  it("does not call the OS when the durability hook fails", async () => {
    const platform = new FakePlatform([
      observation([], "2026-07-21T15:00:16.000Z"),
      observation([], "2026-07-21T15:00:17.000Z"),
    ]);
    const controller = new NinjaTraderProcessController(config(), SECRET, platform);

    await expect(controller.execute(launchDelivery(stateVersion([])), CONTEXT, {
      beforeActuation: async () => {
        throw new Error("durability unavailable");
      },
    })).rejects.toThrow("durability unavailable");

    expect(platform.startCalls).toEqual([]);
    expect(platform.closeCalls).toEqual([]);
  });

  it("degrades a future post-launch observation to indeterminate evidence", async () => {
    const running = record("running");
    const platform = new FakePlatform([
      observation([], "2026-07-21T15:00:16.000Z"),
      observation([], "2026-07-21T15:00:17.000Z"),
      observation([running], "2026-07-21T15:00:21.000Z"),
    ]);
    const controller = new NinjaTraderProcessController(config(), SECRET, platform);

    const result = await controller.execute(launchDelivery(stateVersion([])), CONTEXT);

    expect(result.status).toBe("indeterminate");
    expect(result.outcomeCode).toBe("LAUNCH_RESULT_UNKNOWN");
    expect(result.evidence.postObservedAt).toBeNull();
    expect(platform.startCalls).toEqual([EXECUTABLE]);
  });

  it("blocks before start when the server deadline elapses during preflight despite a slow local clock", async () => {
    const platform = new FakePlatform([
      observation([], "2026-07-21T15:00:16.000Z"),
      observation([], "2026-07-21T15:00:17.000Z"),
    ]);
    const monotonicNow = vi.fn()
      .mockReturnValueOnce(10)
      .mockReturnValueOnce(50);
    const controller = new NinjaTraderProcessController(config(), SECRET, platform, monotonicNow);

    await expect(controller.execute(
      launchDelivery(stateVersion([])),
      { ...CONTEXT, serverDeadlineMonotonicMs: 40 },
    )).rejects.toMatchObject({ code: "COMMAND_EXPIRED" });
    expect(platform.startCalls).toEqual([]);
    expect(platform.closeCalls).toEqual([]);
    expect(platform.now().getTime()).toBe(NOW.getTime());
  });
});

describe("NinjaTraderProcessController graceful quit", () => {
  it("blocks a changed unsafe runtime preflight with zero actuation", async () => {
    const running = record("running");
    const unsafe = safeSummary();
    unsafe.strategyCounts.enabled = 1;
    const platform = new FakePlatform([
      observation([running], "2026-07-21T15:00:16.000Z", runtimeState(unsafe)),
    ]);
    const controller = new NinjaTraderProcessController(config(), SECRET, platform);

    const result = await controller.execute(
      quitDelivery(running, stateVersion([running])),
      CONTEXT,
    );

    expect(result.status).toBe("blocked");
    expect(result.outcomeCode).toBe("PREFLIGHT_BLOCKED");
    if (result.commandType !== "REQUEST_NINJATRADER_QUIT") throw new Error("Expected quit acknowledgement");
    expect(result.evidence.blockers).toEqual([
      "PROCESS_STATE_CHANGED",
      "STRATEGY_ENABLED_OR_UNKNOWN",
    ]);
    expect(platform.closeCalls).toEqual([]);
    expect(platform.startCalls).toEqual([]);
  });

  it("preserves runtime blockers when the exact quit target is missing", async () => {
    const running = record("running");
    const unsafe = safeSummary();
    unsafe.strategyCounts.enabled = 1;
    const platform = new FakePlatform([
      observation([], "2026-07-21T15:00:16.000Z", runtimeState(unsafe)),
    ]);
    const controller = new NinjaTraderProcessController(config(), SECRET, platform);

    const result = await controller.execute(
      quitDelivery(running, stateVersion([running])),
      CONTEXT,
    );

    expect(result.status).toBe("blocked");
    if (result.commandType !== "REQUEST_NINJATRADER_QUIT") throw new Error("Expected quit acknowledgement");
    expect(result.evidence.blockers).toEqual([
      "PROCESS_STATE_CHANGED",
      "STRATEGY_ENABLED_OR_UNKNOWN",
      "TARGET_NOT_FOUND",
    ]);
    expect(platform.closeCalls).toEqual([]);
    expect(platform.startCalls).toEqual([]);
  });

  it("requests one exact graceful close and verifies the stopped tombstone", async () => {
    const running = record("running");
    const stopped = record("stopped");
    const platform = new FakePlatform([
      observation([running], "2026-07-21T15:00:16.000Z"),
      observation([running], "2026-07-21T15:00:17.000Z"),
      observation([stopped], "2026-07-21T15:00:18.000Z"),
    ]);
    const controller = new NinjaTraderProcessController(config(), SECRET, platform);

    const result = await controller.execute(
      quitDelivery(running, stateVersion([running])),
      CONTEXT,
    );

    expect(result.status).toBe("completed");
    expect(result.outcomeCode).toBe("GRACEFUL_QUIT_VERIFIED");
    expect(platform.closeCalls).toEqual([{
      executablePath: EXECUTABLE,
      pid: running.pid,
      startedAt: running.startedAt,
    }]);
    expect(platform.startCalls).toEqual([]);
    if (result.commandType !== "REQUEST_NINJATRADER_QUIT") throw new Error("Expected quit acknowledgement");
    expect(result.evidence.forceKillUsed).toBe(false);
    expect(result.evidence.cancelOrdersUsed).toBe(false);
    expect(result.evidence.flattenPositionsUsed).toBe(false);
    expect(result.evidence.disconnectConnectionsUsed).toBe(false);
  });

  it("returns an exact already-stopped tombstone no-op", async () => {
    const stopped = record("stopped");
    const platform = new FakePlatform([
      observation([stopped], "2026-07-21T15:00:16.000Z"),
      observation([stopped], "2026-07-21T15:00:17.000Z"),
    ]);
    const controller = new NinjaTraderProcessController(config(), SECRET, platform);

    const result = await controller.execute(
      quitDelivery(stopped, stateVersion([stopped])),
      CONTEXT,
    );

    expect(result.outcomeCode).toBe("ALREADY_STOPPED");
    expect(platform.closeCalls).toEqual([]);
    expect(platform.startCalls).toEqual([]);
    expect(result.evidence.retrySafe).toBe(true);
  });

  it("requires attention when graceful quit is not confirmed", async () => {
    const running = record("running");
    const stopping = record("stopping");
    const platform = new FakePlatform([
      observation([running], "2026-07-21T15:00:16.000Z"),
      observation([running], "2026-07-21T15:00:17.000Z"),
      observation([stopping], "2026-07-21T15:00:18.000Z"),
    ]);
    const controller = new NinjaTraderProcessController(config(), SECRET, platform);

    const result = await controller.execute(
      quitDelivery(running, stateVersion([running])),
      CONTEXT,
    );

    expect(result.status).toBe("attention_required");
    expect(result.outcomeCode).toBe("GRACEFUL_QUIT_NOT_CONFIRMED");
    expect(result.evidence.retrySafe).toBe(false);
    expect(platform.closeCalls).toHaveLength(1);
  });

  it("makes an uncertain graceful-close result indeterminate", async () => {
    const running = record("running");
    const platform = new FakePlatform([
      observation([running], "2026-07-21T15:00:16.000Z"),
      observation([running], "2026-07-21T15:00:17.000Z"),
    ]);
    platform.failClose = true;
    const controller = new NinjaTraderProcessController(config(), SECRET, platform);

    const result = await controller.execute(
      quitDelivery(running, stateVersion([running])),
      CONTEXT,
    );

    expect(result.status).toBe("indeterminate");
    expect(result.outcomeCode).toBe("QUIT_RESULT_UNKNOWN");
    expect(result.evidence.retrySafe).toBe(false);
    expect(platform.closeCalls).toHaveLength(1);
  });

  it("awaits the durability hook before requesting graceful close", async () => {
    const running = record("running");
    const stopped = record("stopped");
    const platform = new FakePlatform([
      observation([running], "2026-07-21T15:00:16.000Z"),
      observation([running], "2026-07-21T15:00:17.000Z"),
      observation([stopped], "2026-07-21T15:00:18.000Z"),
    ]);
    const controller = new NinjaTraderProcessController(config(), SECRET, platform);
    const beforeActuation = vi.fn(async () => {
      expect(platform.closeCalls).toEqual([]);
    });

    await controller.execute(
      quitDelivery(running, stateVersion([running])),
      CONTEXT,
      { beforeActuation },
    );

    expect(beforeActuation).toHaveBeenCalledTimes(1);
    expect(platform.closeCalls).toHaveLength(1);
  });

  it("blocks before graceful close when the server deadline elapses during preflight despite a slow local clock", async () => {
    const running = record("running");
    const platform = new FakePlatform([
      observation([running], "2026-07-21T15:00:16.000Z"),
      observation([running], "2026-07-21T15:00:17.000Z"),
    ]);
    const monotonicNow = vi.fn()
      .mockReturnValueOnce(10)
      .mockReturnValueOnce(50);
    const controller = new NinjaTraderProcessController(config(), SECRET, platform, monotonicNow);

    await expect(controller.execute(
      quitDelivery(running, stateVersion([running])),
      { ...CONTEXT, serverDeadlineMonotonicMs: 40 },
    )).rejects.toMatchObject({ code: "COMMAND_EXPIRED" });
    expect(platform.closeCalls).toEqual([]);
    expect(platform.startCalls).toEqual([]);
    expect(platform.now().getTime()).toBe(NOW.getTime());
  });
});

describe("process controller local boundaries", () => {
  it("rejects an omitted durability hook before observation or actuation", async () => {
    const platform = new FakePlatform([]);
    const controller = new BaseNinjaTraderProcessController(config(), SECRET, platform);
    const executeWithoutHook = controller.execute.bind(controller) as unknown as (
      delivered: unknown,
      context: ProcessControlExecutionContext,
    ) => Promise<unknown>;

    await expect(executeWithoutHook(
      launchDelivery(stateVersion([])),
      CONTEXT,
    )).rejects.toThrow("requires a durable before-actuation hook");

    expect(platform.observeCalls).toEqual([]);
    expect(platform.startCalls).toEqual([]);
    expect(platform.closeCalls).toEqual([]);
  });

  it("requires a valid unexpired server deadline before any observation or actuation", async () => {
    const platform = new FakePlatform([]);
    const controller = new NinjaTraderProcessController(config(), SECRET, platform, () => 100);
    const delivery = launchDelivery(stateVersion([]));

    await expect(controller.execute(
      delivery,
      { leaseId: CONTEXT.leaseId, sequence: CONTEXT.sequence } as typeof CONTEXT,
    )).rejects.toThrow();
    await expect(controller.execute(
      delivery,
      { ...CONTEXT, serverDeadlineMonotonicMs: 100 },
    )).rejects.toMatchObject({ code: "COMMAND_EXPIRED" });
    expect(platform.observeCalls).toEqual([]);
    expect(platform.startCalls).toEqual([]);
    expect(platform.closeCalls).toEqual([]);
  });

  it("accepts a valid server deadline window", async () => {
    const running = record("running");
    const platform = new FakePlatform([
      observation([running], "2026-07-21T15:00:16.000Z"),
      observation([running], "2026-07-21T15:00:17.000Z"),
    ]);
    const controller = new NinjaTraderProcessController(config(), SECRET, platform, () => 99);

    await expect(controller.execute(
      launchDelivery(stateVersion([running])),
      { ...CONTEXT, serverDeadlineMonotonicMs: 100 },
    )).resolves.toMatchObject({ status: "completed", outcomeCode: "ALREADY_RUNNING" });
    expect(platform.startCalls).toEqual([]);
    expect(platform.closeCalls).toEqual([]);
  });

  it("requires a 32-byte local identity secret and exact NinjaTrader executable", () => {
    const platform = new FakePlatform([]);
    expect(() => new NinjaTraderProcessController(config(), Buffer.alloc(31), platform)).toThrow(/32 bytes/);
    expect(() => new NinjaTraderProcessController(config([{
      installationRef: INSTALLATION_REF,
      executablePath: "C:\\Windows\\System32\\cmd.exe",
    }]), SECRET, platform)).toThrow(/NinjaTrader\.exe/);
    expect(() => new NinjaTraderProcessController({
      ...config(),
      arguments: ["--connect"],
    } as unknown as ProcessControllerConfig, SECRET, platform)).toThrow();
  });

  it.each([
    "\\\\server\\share\\NinjaTrader.exe",
    "\\\\?\\C:\\NinjaTrader 8\\bin\\NinjaTrader.exe",
    "\\\\.\\C:\\NinjaTrader 8\\bin\\NinjaTrader.exe",
  ])("rejects non-local Windows executable path %s", (executablePath) => {
    expect(() => new NinjaTraderProcessController(config([{
      installationRef: INSTALLATION_REF,
      executablePath,
    }]), SECRET, new FakePlatform([]))).toThrow(/local drive-rooted/);
  });

  it("uses case-insensitive canonical Windows paths for stable process identity", () => {
    const upper = record("running", {
      executablePath: "C:\\PROGRAM FILES\\NINJATRADER 8\\BIN\\NINJATRADER.EXE",
    });
    const lower = record("running", {
      executablePath: "c:\\program files\\ninjatrader 8\\bin\\ninjatrader.exe",
    });

    expect(deriveProcessRef(SECRET, upper)).toBe(deriveProcessRef(SECRET, lower));
    expect(deriveProcessStateVersion(
      INSTALLATION_REF,
      EXECUTABLE,
      [upper],
      SECRET,
    )).toBe(deriveProcessStateVersion(
      INSTALLATION_REF,
      EXECUTABLE.toLocaleLowerCase("en-US"),
      [lower],
      SECRET,
    ));
  });
});
