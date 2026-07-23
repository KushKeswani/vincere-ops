import { createHmac, randomUUID } from "node:crypto";
import path from "node:path";

import { z } from "zod";

import {
  isFreshAuthenticatedLaunchReadiness,
  launchReadinessObservationSchema,
  MAX_LAUNCH_READINESS_AGE_MS,
  MAX_QUIT_RUNTIME_STATE_AGE_MS,
  parseDeliveredProcessControlCommand,
  parseProcessControlAcknowledgement,
  PROCESS_CONTROL_PROTOCOL_VERSION,
  processQuitBlockers,
  processQuitRuntimeStateSchema,
  type DeliveredProcessControlCommand,
  type ProcessControlAcknowledgement,
  type ProcessControlCommand,
  type LaunchReadinessObservation,
  type ProcessQuitBlockerCode,
} from "@/lib/domain/process-control-contracts";
import { hashCanonicalPayload } from "@/lib/domain/runtime-contracts";

const installationRefSchema = z.string().regex(/^install_[a-z0-9]{16,64}$/);
const isoTimestampSchema = z.iso.datetime({ offset: true });

const windowsExecutablePathSchema = z.string().min(1).max(1_024).superRefine((value, context) => {
  const normalized = path.win32.normalize(value);
  if (
    value.includes("\0")
    || !path.win32.isAbsolute(value)
    || !/^[A-Za-z]:\\/.test(normalized)
    || normalized.slice(2).includes(":")
  ) {
    context.addIssue({ code: "custom", message: "Executable path must be a local drive-rooted Windows path" });
    return;
  }
  if (path.win32.basename(normalized).toLocaleLowerCase("en-US") !== "ninjatrader.exe") {
    context.addIssue({ code: "custom", message: "Only NinjaTrader.exe may be allowlisted" });
  }
});

const processControllerConfigSchema = z.object({
  installations: z.array(z.object({
    installationRef: installationRefSchema,
    executablePath: windowsExecutablePathSchema,
  }).strict()).max(100),
  observationDelayMs: z.number().int().min(0).max(30_000).default(500),
}).strict();

const platformProcessRecordSchema = z.object({
  executablePath: windowsExecutablePathSchema,
  pid: z.number().int().positive().max(2_147_483_647),
  startedAt: isoTimestampSchema,
  state: z.enum([
    "starting",
    "running",
    "waiting_for_login",
    "stopping",
    "stopped",
    "unknown",
  ]),
}).strict();

const processPlatformObservationSchema = z.object({
  observedAt: isoTimestampSchema,
  processes: z.array(platformProcessRecordSchema).max(100),
  runtimeState: processQuitRuntimeStateSchema.nullable().default(null),
  launchReadiness: launchReadinessObservationSchema.nullable().default(null),
}).strict();

const executionContextSchema = z.object({
  leaseId: z.uuid(),
  sequence: z.number().int().safe().positive(),
  serverDeadlineMonotonicMs: z.number().finite().nonnegative(),
}).strict();

export type ProcessControllerConfig = z.input<typeof processControllerConfigSchema>;
export type PlatformProcessRecord = z.infer<typeof platformProcessRecordSchema>;
export type ProcessPlatformObservation = z.input<typeof processPlatformObservationSchema>;
export type ProcessControlExecutionContext = z.infer<typeof executionContextSchema>;

export interface ProcessControllerExecutionHooks {
  beforeActuation(input: {
    commandId: string;
    commandType: ProcessControlCommand['commandType'];
  }): Promise<void>;
}

export interface ExactProcessTarget {
  executablePath: string;
  pid: number;
  startedAt: string;
}

/**
 * The controller deliberately has no built-in OS implementation. A platform adapter must target
 * an exact allowlisted path and exact process identity; it must never use a broad name lookup or a
 * forceful termination mechanism.
 */
export interface ProcessPlatform {
  observe(executablePath: string): Promise<ProcessPlatformObservation>;
  start(executablePath: string): Promise<void>;
  requestGracefulClose(target: ExactProcessTarget): Promise<void>;
  wait(milliseconds: number): Promise<void>;
  now(): Date;
}

export class ProcessControllerRefusalError extends Error {
  constructor(
    readonly code: "COMMAND_EXPIRED" | "APPROVAL_EXPIRED" | "APPROVAL_ALREADY_USED" | "INVALID_CLOCK",
  ) {
    super(`Process controller refused command: ${code}`);
  }
}

/**
 * Once the durable pre-actuation marker exists, recovery must assume that the
 * OS mutation may have happened. It emits one non-retryable acknowledgement and
 * never invokes the platform again.
 */
export function buildIndeterminateProcessControlRecoveryAcknowledgement(
  deliveredInput: unknown,
  contextInput: ProcessControlExecutionContext,
  occurredAtInput: string,
): ProcessControlAcknowledgement {
  const delivered = parseDeliveredProcessControlCommand(deliveredInput);
  const context = executionContextSchema.parse(contextInput);
  const occurredAt = isoTimestampSchema.parse(occurredAtInput);
  const command = delivered.command;
  const base = {
    protocolVersion: PROCESS_CONTROL_PROTOCOL_VERSION,
    acknowledgementId: randomUUID(),
    commandId: command.commandId,
    correlationId: command.correlationId,
    agentId: command.agentId,
    leaseId: context.leaseId,
    sequence: context.sequence,
    occurredAt,
  };
  const withoutHash = command.commandType === "LAUNCH_NINJATRADER"
    ? {
      ...base,
      commandType: command.commandType,
      status: "indeterminate" as const,
      outcomeCode: "LAUNCH_RESULT_UNKNOWN" as const,
      evidence: {
        target: command.payload.target,
        preProcessStateVersion: command.expectedProcessStateVersion,
        postProcessStateVersion: null,
        postObservedAt: null,
        preProcessState: "stopped" as const,
        postProcessState: "unknown" as const,
        processRef: null,
        matchedInstallationCount: 1 as const,
        actuatorInvoked: true,
        mutationMayHaveOccurred: true,
        retrySafe: false,
        launchReadiness: unavailableLaunchReadiness(occurredAt, "PROVIDER_UNAVAILABLE"),
      },
    }
    : {
      ...base,
      commandType: command.commandType,
      status: "indeterminate" as const,
      outcomeCode: "QUIT_RESULT_UNKNOWN" as const,
      evidence: {
        target: command.payload.target,
        runtimeStateDigest: command.payload.runtimeState.digest,
        runtimeObservedAt: command.payload.runtimeState.observedAt,
        preflight: command.payload.runtimeState.summary,
        blockers: [] as ProcessQuitBlockerCode[],
        preProcessStateVersion: command.expectedProcessStateVersion,
        postProcessStateVersion: null,
        postObservedAt: null,
        preProcessState: "running" as const,
        postProcessState: "unknown" as const,
        matchedProcessCount: 1 as const,
        gracefulQuitRequested: true,
        forceKillUsed: false as const,
        cancelOrdersUsed: false as const,
        flattenPositionsUsed: false as const,
        disconnectConnectionsUsed: false as const,
        mutationMayHaveOccurred: true,
        retrySafe: false,
      },
    };
  return parseProcessControlAcknowledgement({
    ...withoutHash,
    evidenceHash: hashCanonicalPayload(withoutHash.evidence),
  });
}

type LaunchCommand = Extract<ProcessControlCommand, { commandType: "LAUNCH_NINJATRADER" }>;
type QuitCommand = Extract<ProcessControlCommand, { commandType: "REQUEST_NINJATRADER_QUIT" }>;
type ParsedObservation = z.infer<typeof processPlatformObservationSchema>;

interface Installation {
  installationRef: string;
  executablePath: string;
}

interface ObservationState {
  observation: ParsedObservation;
  records: PlatformProcessRecord[];
  stateVersion: string;
}

function normalizeExecutablePath(value: string): string {
  return path.win32.normalize(value);
}

function canonicalIdentityPath(value: string): string {
  return normalizeExecutablePath(value).toLocaleLowerCase("en-US");
}

function sameExecutablePath(left: string, right: string): boolean {
  return canonicalIdentityPath(left) === canonicalIdentityPath(right);
}

export function parseProcessPlatformObservation(input: unknown): z.infer<typeof processPlatformObservationSchema> {
  return processPlatformObservationSchema.parse(input);
}

export function selectExactProcessRecords(
  executablePath: string,
  records: readonly PlatformProcessRecord[],
): PlatformProcessRecord[] {
  const normalizedExecutablePath = windowsExecutablePathSchema.parse(executablePath);
  return records
    .map((record) => platformProcessRecordSchema.parse(record))
    .filter((record) => sameExecutablePath(record.executablePath, normalizedExecutablePath));
}

export function deriveProcessRef(
  identitySecret: Uint8Array,
  target: ExactProcessTarget,
): string {
  if (identitySecret.byteLength !== 32) throw new Error("Process identity secret must contain exactly 32 bytes");
  const executablePath = windowsExecutablePathSchema.parse(target.executablePath);
  const pid = z.number().int().positive().max(2_147_483_647).parse(target.pid);
  const startedAt = isoTimestampSchema.parse(target.startedAt);
  const digest = createHmac("sha256", identitySecret)
    .update(`${canonicalIdentityPath(executablePath)}\0${pid}\0${startedAt}`, "utf8")
    .digest("hex");
  return `process_${digest}`;
}

export function deriveProcessStateVersion(
  installationRef: string,
  executablePath: string,
  records: readonly PlatformProcessRecord[],
  identitySecret: Uint8Array,
): string {
  const normalizedInstallationRef = installationRefSchema.parse(installationRef);
  const normalizedExecutablePath = windowsExecutablePathSchema.parse(executablePath);
  const processes = records
    .filter((record) => sameExecutablePath(record.executablePath, normalizedExecutablePath))
    .map((record) => ({
      processRef: deriveProcessRef(identitySecret, record),
      state: record.state,
    }))
    .sort((left, right) => left.processRef.localeCompare(right.processRef)
      || left.state.localeCompare(right.state));
  return hashCanonicalPayload({ installationRef: normalizedInstallationRef, processes });
}

function processState(record: PlatformProcessRecord | undefined): "running" | "stopped" | "unknown" {
  if (!record) return "unknown";
  if (record.state === "stopped") return "stopped";
  if (record.state === "unknown") return "unknown";
  return "running";
}

function launchState(records: readonly PlatformProcessRecord[]): {
  state: "stopped" | "running" | "unknown";
  processRefRecord: PlatformProcessRecord | null;
} {
  const active = records.filter((record) => record.state !== "stopped");
  if (active.length === 0) return { state: "stopped", processRefRecord: null };
  if (active.length !== 1 || active[0].state !== "running") {
    return { state: "unknown", processRefRecord: active.length === 1 ? active[0] : null };
  }
  return { state: "running", processRefRecord: active[0] };
}

function sortedUniqueBlockers(blockers: readonly ProcessQuitBlockerCode[]): ProcessQuitBlockerCode[] {
  return [...new Set(blockers)].sort();
}

function unavailableLaunchReadiness(
  observedAt: string,
  reasonCode: Extract<LaunchReadinessObservation, { state: "unknown" }>["reasonCode"],
  authenticated = false,
): LaunchReadinessObservation {
  return launchReadinessObservationSchema.parse({
    state: "unknown",
    observedAt,
    source: "authenticated_runtime_v2_addon_ipc",
    authenticated,
    reasonCode,
  });
}

function readinessForEvidence(
  state: ObservationState,
  occurredAt: string,
): LaunchReadinessObservation {
  const readiness = state.observation.launchReadiness;
  if (!readiness) {
    return unavailableLaunchReadiness(state.observation.observedAt, "PROVIDER_UNAVAILABLE");
  }
  const readinessMs = Date.parse(readiness.observedAt);
  const postMs = Date.parse(state.observation.observedAt);
  const occurredMs = Date.parse(occurredAt);
  if (readinessMs < postMs || readinessMs > occurredMs) {
    return unavailableLaunchReadiness(
      readiness.observedAt,
      "OBSERVATION_TIME_INVALID",
      readiness.authenticated,
    );
  }
  if (occurredMs - readinessMs > MAX_LAUNCH_READINESS_AGE_MS) {
    return unavailableLaunchReadiness(
      readiness.observedAt,
      "OBSERVATION_STALE",
      readiness.authenticated,
    );
  }
  return readiness;
}

function validClock(now: Date): number {
  const milliseconds = now.getTime();
  if (!Number.isFinite(milliseconds)) throw new ProcessControllerRefusalError("INVALID_CLOCK");
  return milliseconds;
}

export class NinjaTraderProcessController {
  private readonly config: z.output<typeof processControllerConfigSchema>;
  private readonly identitySecret: Uint8Array;
  // The durable queue must enforce one-use approvals across companion restarts.
  private readonly consumedApprovalIds = new Set<string>();

  constructor(
    config: ProcessControllerConfig,
    identitySecret: Uint8Array,
    private readonly platform: ProcessPlatform,
    private readonly monotonicNow: () => number = () => performance.now(),
  ) {
    this.config = processControllerConfigSchema.parse(config);
    if (identitySecret.byteLength !== 32) throw new Error("Process identity secret must contain exactly 32 bytes");
    this.identitySecret = Uint8Array.from(identitySecret);
  }

  async execute(
    deliveredInput: unknown,
    contextInput: ProcessControlExecutionContext,
    hooks: ProcessControllerExecutionHooks,
  ): Promise<ProcessControlAcknowledgement> {
    if (!hooks || typeof hooks.beforeActuation !== "function") {
      throw new Error("Process controller requires a durable before-actuation hook");
    }
    const delivered = parseDeliveredProcessControlCommand(deliveredInput);
    const context = executionContextSchema.parse(contextInput);
    this.assertWithinServerDeadline(context);
    this.assertFreshAndConsumeApproval(delivered);
    return delivered.command.commandType === "LAUNCH_NINJATRADER"
      ? this.executeLaunch(delivered.command, context, hooks)
      : this.executeQuit(delivered.command, context, hooks);
  }

  private assertFreshAndConsumeApproval(delivered: DeliveredProcessControlCommand): void {
    const command = delivered.command;
    const now = validClock(this.platform.now());
    if (now >= Date.parse(command.expiresAt)) throw new ProcessControllerRefusalError("COMMAND_EXPIRED");
    if (now >= Date.parse(command.approval.expiresAt)) throw new ProcessControllerRefusalError("APPROVAL_EXPIRED");
    if (this.consumedApprovalIds.has(command.approval.approvalId)) {
      throw new ProcessControllerRefusalError("APPROVAL_ALREADY_USED");
    }
    this.consumedApprovalIds.add(command.approval.approvalId);
  }

  private assertStillFresh(command: ProcessControlCommand): void {
    const now = validClock(this.platform.now());
    if (now >= Date.parse(command.expiresAt)) throw new ProcessControllerRefusalError("COMMAND_EXPIRED");
    if (now >= Date.parse(command.approval.expiresAt)) throw new ProcessControllerRefusalError("APPROVAL_EXPIRED");
  }

  private assertWithinServerDeadline(context: ProcessControlExecutionContext): void {
    const now = this.monotonicNow();
    if (!Number.isFinite(now) || now < 0) {
      throw new ProcessControllerRefusalError("INVALID_CLOCK");
    }
    if (now >= context.serverDeadlineMonotonicMs) {
      throw new ProcessControllerRefusalError("COMMAND_EXPIRED");
    }
  }

  private nowIso(): string {
    const now = this.platform.now();
    validClock(now);
    return now.toISOString();
  }

  private matchingInstallations(installationRef: string): Installation[] {
    return this.config.installations
      .filter((installation) => installation.installationRef === installationRef)
      .map((installation) => ({
        installationRef: installation.installationRef,
        executablePath: normalizeExecutablePath(installation.executablePath),
      }));
  }

  private async observe(installation: Installation): Promise<ObservationState> {
    const observation = parseProcessPlatformObservation(
      await this.platform.observe(installation.executablePath),
    );
    const records = selectExactProcessRecords(installation.executablePath, observation.processes);
    return {
      observation,
      records,
      stateVersion: deriveProcessStateVersion(
        installation.installationRef,
        installation.executablePath,
        records,
        this.identitySecret,
      ),
    };
  }

  private base(command: ProcessControlCommand, context: ProcessControlExecutionContext) {
    return {
      protocolVersion: PROCESS_CONTROL_PROTOCOL_VERSION,
      acknowledgementId: randomUUID(),
      commandId: command.commandId,
      correlationId: command.correlationId,
      agentId: command.agentId,
      leaseId: context.leaseId,
      sequence: context.sequence,
    };
  }

  private finish(input: Omit<ProcessControlAcknowledgement, "evidenceHash">): ProcessControlAcknowledgement {
    return parseProcessControlAcknowledgement({
      ...input,
      evidenceHash: hashCanonicalPayload(input.evidence),
    });
  }

  private blockedLaunch(
    command: LaunchCommand,
    context: ProcessControlExecutionContext,
    outcomeCode: "INSTALLATION_NOT_ALLOWLISTED" | "TARGET_AMBIGUOUS" | "PROCESS_STATE_CHANGED",
    input: {
      matchedInstallationCount: 0 | 1 | 2;
      stateVersion?: string;
      preState?: "stopped" | "running" | "unknown";
      processRef?: string | null;
    },
  ): ProcessControlAcknowledgement {
    const occurredAt = this.nowIso();
    const evidence = {
      target: command.payload.target,
      preProcessStateVersion: input.stateVersion ?? command.expectedProcessStateVersion,
      postProcessStateVersion: null,
      postObservedAt: null,
      preProcessState: input.preState ?? "unknown" as const,
      postProcessState: "unknown" as const,
      processRef: input.processRef ?? null,
      matchedInstallationCount: input.matchedInstallationCount,
      actuatorInvoked: false,
      mutationMayHaveOccurred: false,
      retrySafe: false,
      launchReadiness: unavailableLaunchReadiness(occurredAt, "PROVIDER_UNAVAILABLE"),
    };
    return this.finish({
      ...this.base(command, context),
      commandType: command.commandType,
      status: "blocked",
      outcomeCode,
      occurredAt,
      evidence,
    });
  }

  private async executeLaunch(
    command: LaunchCommand,
    context: ProcessControlExecutionContext,
    hooks: ProcessControllerExecutionHooks,
  ): Promise<ProcessControlAcknowledgement> {
    const installations = this.matchingInstallations(command.payload.target.installationRef);
    if (installations.length === 0) {
      return this.blockedLaunch(command, context, "INSTALLATION_NOT_ALLOWLISTED", {
        matchedInstallationCount: 0,
      });
    }
    if (installations.length !== 1) {
      return this.blockedLaunch(command, context, "TARGET_AMBIGUOUS", {
        matchedInstallationCount: 2,
      });
    }
    const installation = installations[0];

    let first: ObservationState;
    try {
      first = await this.observe(installation);
    } catch {
      return this.blockedLaunch(command, context, "PROCESS_STATE_CHANGED", {
        matchedInstallationCount: 1,
      });
    }
    const firstLaunchState = launchState(first.records);
    const firstRef = firstLaunchState.processRefRecord
      ? deriveProcessRef(this.identitySecret, firstLaunchState.processRefRecord)
      : null;
    if (Date.parse(first.observation.observedAt) > validClock(this.platform.now())
      || first.stateVersion !== command.expectedProcessStateVersion) {
      return this.blockedLaunch(command, context, "PROCESS_STATE_CHANGED", {
        matchedInstallationCount: 1,
        stateVersion: first.stateVersion,
        preState: firstLaunchState.state,
        processRef: firstRef,
      });
    }

    let pre: ObservationState;
    try {
      pre = await this.observe(installation);
    } catch {
      return this.blockedLaunch(command, context, "PROCESS_STATE_CHANGED", {
        matchedInstallationCount: 1,
        stateVersion: first.stateVersion,
        preState: firstLaunchState.state,
        processRef: firstRef,
      });
    }
    const preLaunchState = launchState(pre.records);
    const preRef = preLaunchState.processRefRecord
      ? deriveProcessRef(this.identitySecret, preLaunchState.processRefRecord)
      : null;
    if (Date.parse(pre.observation.observedAt) > validClock(this.platform.now())
      || pre.stateVersion !== command.expectedProcessStateVersion) {
      return this.blockedLaunch(command, context, "PROCESS_STATE_CHANGED", {
        matchedInstallationCount: 1,
        stateVersion: pre.stateVersion,
        preState: preLaunchState.state,
        processRef: preRef,
      });
    }
    if (preLaunchState.state === "running" && preRef) {
      const occurredAt = this.nowIso();
      const launchReadiness = readinessForEvidence(pre, occurredAt);
      const evidence = {
        target: command.payload.target,
        preProcessStateVersion: pre.stateVersion,
        postProcessStateVersion: pre.stateVersion,
        postObservedAt: pre.observation.observedAt,
        preProcessState: "running" as const,
        postProcessState: "running" as const,
        processRef: preRef,
        matchedInstallationCount: 1,
        actuatorInvoked: false,
        mutationMayHaveOccurred: false,
        retrySafe: true,
        launchReadiness,
      };
      return this.finish({
        ...this.base(command, context),
        commandType: command.commandType,
        status: isFreshAuthenticatedLaunchReadiness(
          launchReadiness,
          pre.observation.observedAt,
          occurredAt,
        ) ? "completed" : "attention_required",
        outcomeCode: isFreshAuthenticatedLaunchReadiness(
          launchReadiness,
          pre.observation.observedAt,
          occurredAt,
        ) ? "ALREADY_RUNNING" : "ALREADY_RUNNING_READINESS_UNCONFIRMED",
        occurredAt,
        evidence,
      });
    }
    if (preLaunchState.state !== "stopped") {
      return this.blockedLaunch(command, context, "PROCESS_STATE_CHANGED", {
        matchedInstallationCount: 1,
        stateVersion: pre.stateVersion,
        preState: preLaunchState.state,
        processRef: preRef,
      });
    }

    this.assertStillFresh(command);
    this.assertWithinServerDeadline(context);
    await hooks.beforeActuation({ commandId: command.commandId, commandType: command.commandType });
    this.assertStillFresh(command);
    this.assertWithinServerDeadline(context);
    try {
      await this.platform.start(installation.executablePath);
      await this.platform.wait(this.config.observationDelayMs);
    } catch {
      return this.indeterminateLaunch(command, context, pre.stateVersion);
    }

    let post: ObservationState;
    try {
      post = await this.observe(installation);
    } catch {
      return this.indeterminateLaunch(command, context, pre.stateVersion);
    }
    const active = post.records.filter((record) => record.state !== "stopped");
    const postRecord = active.length === 1 ? active[0] : null;
    const processRef = postRecord ? deriveProcessRef(this.identitySecret, postRecord) : null;
    const occurredAt = this.nowIso();
    if (Date.parse(post.observation.observedAt) > Date.parse(occurredAt)) {
      return this.indeterminateLaunch(command, context, pre.stateVersion);
    }
    const changed = post.stateVersion !== pre.stateVersion;
    const launchReadiness = readinessForEvidence(post, occurredAt);
    if (postRecord?.state === "running" && processRef && changed) {
      const evidence = {
        target: command.payload.target,
        preProcessStateVersion: pre.stateVersion,
        postProcessStateVersion: post.stateVersion,
        postObservedAt: post.observation.observedAt,
        preProcessState: "stopped" as const,
        postProcessState: "running" as const,
        processRef,
        matchedInstallationCount: 1,
        actuatorInvoked: true,
        mutationMayHaveOccurred: true,
        retrySafe: false,
        launchReadiness,
      };
      const ready = isFreshAuthenticatedLaunchReadiness(
        launchReadiness,
        post.observation.observedAt,
        occurredAt,
      );
      return this.finish({
        ...this.base(command, context),
        commandType: command.commandType,
        status: ready ? "completed" : "attention_required",
        outcomeCode: ready ? "LAUNCHED" : "LAUNCHED_READINESS_UNCONFIRMED",
        occurredAt,
        evidence,
      });
    }
    if (postRecord?.state === "waiting_for_login" && processRef && changed) {
      const evidence = {
        target: command.payload.target,
        preProcessStateVersion: pre.stateVersion,
        postProcessStateVersion: post.stateVersion,
        postObservedAt: post.observation.observedAt,
        preProcessState: "stopped" as const,
        postProcessState: "waiting_for_login" as const,
        processRef,
        matchedInstallationCount: 1,
        actuatorInvoked: true,
        mutationMayHaveOccurred: true,
        retrySafe: false,
        launchReadiness,
      };
      const loginRequired = launchReadiness.state === "not_ready"
        && launchReadiness.reasonCode === "LOGIN_REQUIRED";
      return this.finish({
        ...this.base(command, context),
        commandType: command.commandType,
        status: "attention_required",
        outcomeCode: loginRequired ? "WAITING_FOR_LOGIN" : "LAUNCHED_READINESS_UNCONFIRMED",
        occurredAt,
        evidence,
      });
    }
    return this.indeterminateLaunch(command, context, pre.stateVersion, post, processRef);
  }

  private indeterminateLaunch(
    command: LaunchCommand,
    context: ProcessControlExecutionContext,
    preStateVersion: string,
    post: ObservationState | null = null,
    processRef: string | null = null,
  ): ProcessControlAcknowledgement {
    const postRecord = post?.records.filter((record) => record.state !== "stopped");
    const observedState = postRecord?.length === 1 ? postRecord[0].state : "unknown";
    const postProcessState: "starting" | "running" | "waiting_for_login" | "unknown" = observedState === "starting" || observedState === "running"
      || observedState === "waiting_for_login"
      ? observedState
      : "unknown";
    const evidence = {
      target: command.payload.target,
      preProcessStateVersion: preStateVersion,
      postProcessStateVersion: post?.stateVersion ?? null,
      postObservedAt: post?.observation.observedAt ?? null,
      preProcessState: "stopped" as const,
      postProcessState,
      processRef,
      matchedInstallationCount: 1,
      actuatorInvoked: true,
      mutationMayHaveOccurred: true,
      retrySafe: false,
      launchReadiness: post
        ? readinessForEvidence(post, this.nowIso())
        : unavailableLaunchReadiness(this.nowIso(), "PROVIDER_UNAVAILABLE"),
    };
    return this.finish({
      ...this.base(command, context),
      commandType: command.commandType,
      status: "indeterminate",
      outcomeCode: "LAUNCH_RESULT_UNKNOWN",
      occurredAt: this.nowIso(),
      evidence,
    });
  }

  private blockedQuit(
    command: QuitCommand,
    context: ProcessControlExecutionContext,
    blockers: readonly ProcessQuitBlockerCode[],
    input: {
      stateVersion?: string;
      preState?: "running" | "stopped" | "unknown";
      matchedProcessCount?: 0 | 1 | 2;
      runtimeState?: QuitCommand["payload"]["runtimeState"];
    } = {},
  ): ProcessControlAcknowledgement {
    const runtimeState = input.runtimeState ?? command.payload.runtimeState;
    const evidence = {
      target: command.payload.target,
      runtimeStateDigest: runtimeState.digest,
      runtimeObservedAt: runtimeState.observedAt,
      preflight: runtimeState.summary,
      blockers: sortedUniqueBlockers(blockers),
      preProcessStateVersion: input.stateVersion ?? command.expectedProcessStateVersion,
      postProcessStateVersion: null,
      postObservedAt: null,
      preProcessState: input.preState ?? "unknown" as const,
      postProcessState: "unknown" as const,
      matchedProcessCount: input.matchedProcessCount ?? 0,
      gracefulQuitRequested: false,
      forceKillUsed: false as const,
      cancelOrdersUsed: false as const,
      flattenPositionsUsed: false as const,
      disconnectConnectionsUsed: false as const,
      mutationMayHaveOccurred: false,
      retrySafe: false,
    };
    return this.finish({
      ...this.base(command, context),
      commandType: command.commandType,
      status: "blocked",
      outcomeCode: "PREFLIGHT_BLOCKED",
      occurredAt: this.nowIso(),
      evidence,
    });
  }

  private quitObservationBlockers(
    command: QuitCommand,
    state: ObservationState,
    now: Date,
  ): { blockers: ProcessQuitBlockerCode[]; runtimeState: QuitCommand["payload"]["runtimeState"] } {
    const runtimeState = state.observation.runtimeState ?? command.payload.runtimeState;
    const blockers: ProcessQuitBlockerCode[] = [];
    if (!state.observation.runtimeState) blockers.push("RUNTIME_STATE_STALE");
    if (runtimeState.digest !== command.payload.runtimeState.digest) blockers.push("PROCESS_STATE_CHANGED");
    const nowMs = validClock(now);
    const observedMs = Date.parse(runtimeState.observedAt);
    if (observedMs > nowMs || nowMs - observedMs > MAX_QUIT_RUNTIME_STATE_AGE_MS) {
      blockers.push("RUNTIME_STATE_STALE");
    }
    if (Date.parse(state.observation.observedAt) > nowMs) blockers.push("PROCESS_STATE_CHANGED");
    blockers.push(...processQuitBlockers(runtimeState.summary));
    return { blockers: sortedUniqueBlockers(blockers), runtimeState };
  }

  private targetRecords(command: QuitCommand, state: ObservationState): PlatformProcessRecord[] {
    return state.records.filter((record) =>
      deriveProcessRef(this.identitySecret, record) === command.payload.target.processRef);
  }

  private async executeQuit(
    command: QuitCommand,
    context: ProcessControlExecutionContext,
    hooks: ProcessControllerExecutionHooks,
  ): Promise<ProcessControlAcknowledgement> {
    const installations = this.matchingInstallations(command.payload.target.installationRef);
    if (installations.length === 0) {
      return this.blockedQuit(command, context, ["INSTALLATION_NOT_ALLOWLISTED"]);
    }
    if (installations.length !== 1) {
      return this.blockedQuit(command, context, ["TARGET_AMBIGUOUS"], { matchedProcessCount: 0 });
    }
    const installation = installations[0];

    let first: ObservationState;
    try {
      first = await this.observe(installation);
    } catch {
      return this.blockedQuit(command, context, ["RUNTIME_STATE_STALE"]);
    }
    const firstRuntime = this.quitObservationBlockers(command, first, this.platform.now());
    const firstTargets = this.targetRecords(command, first);
    if (firstTargets.length === 0) firstRuntime.blockers.push("TARGET_NOT_FOUND");
    if (firstTargets.length > 1) firstRuntime.blockers.push("TARGET_AMBIGUOUS");
    if (first.stateVersion !== command.expectedProcessStateVersion) {
      firstRuntime.blockers.push("PROCESS_STATE_CHANGED");
    }
    const firstState = processState(firstTargets[0]);
    if (firstRuntime.blockers.length > 0 || firstTargets.length !== 1) {
      return this.blockedQuit(command, context, firstRuntime.blockers, {
        stateVersion: first.stateVersion,
        preState: firstState,
        matchedProcessCount: firstTargets.length === 0 ? 0 : firstTargets.length === 1 ? 1 : 2,
        runtimeState: firstRuntime.runtimeState,
      });
    }

    let pre: ObservationState;
    try {
      pre = await this.observe(installation);
    } catch {
      return this.blockedQuit(command, context, ["RUNTIME_STATE_STALE"], {
        stateVersion: first.stateVersion,
        preState: firstState,
        matchedProcessCount: 1,
        runtimeState: firstRuntime.runtimeState,
      });
    }
    const preTargets = this.targetRecords(command, pre);
    const preRuntime = this.quitObservationBlockers(command, pre, this.platform.now());
    if (preTargets.length === 0) preRuntime.blockers.push("TARGET_NOT_FOUND");
    if (preTargets.length > 1) preRuntime.blockers.push("TARGET_AMBIGUOUS");
    if (pre.stateVersion !== command.expectedProcessStateVersion) {
      preRuntime.blockers.push("PROCESS_STATE_CHANGED");
    }
    if (preRuntime.blockers.length > 0 || preTargets.length !== 1) {
      return this.blockedQuit(command, context, preRuntime.blockers, {
        stateVersion: pre.stateVersion,
        preState: processState(preTargets[0]),
        matchedProcessCount: preTargets.length === 0 ? 0 : preTargets.length === 1 ? 1 : 2,
        runtimeState: preRuntime.runtimeState,
      });
    }
    const target = preTargets[0];
    const targetState = processState(target);
    if (targetState === "unknown") {
      return this.blockedQuit(command, context, ["PROCESS_STATE_CHANGED"], {
        stateVersion: pre.stateVersion,
        preState: "unknown",
        matchedProcessCount: 1,
        runtimeState: preRuntime.runtimeState,
      });
    }
    if (targetState === "stopped") {
      const evidence = {
        target: command.payload.target,
        runtimeStateDigest: preRuntime.runtimeState.digest,
        runtimeObservedAt: preRuntime.runtimeState.observedAt,
        preflight: preRuntime.runtimeState.summary,
        blockers: [] as ProcessQuitBlockerCode[],
        preProcessStateVersion: pre.stateVersion,
        postProcessStateVersion: pre.stateVersion,
        postObservedAt: pre.observation.observedAt,
        preProcessState: "stopped" as const,
        postProcessState: "stopped" as const,
        matchedProcessCount: 1,
        gracefulQuitRequested: false,
        forceKillUsed: false as const,
        cancelOrdersUsed: false as const,
        flattenPositionsUsed: false as const,
        disconnectConnectionsUsed: false as const,
        mutationMayHaveOccurred: false,
        retrySafe: true,
      };
      return this.finish({
        ...this.base(command, context),
        commandType: command.commandType,
        status: "completed",
        outcomeCode: "ALREADY_STOPPED",
        occurredAt: this.nowIso(),
        evidence,
      });
    }

    this.assertStillFresh(command);
    this.assertWithinServerDeadline(context);
    await hooks.beforeActuation({ commandId: command.commandId, commandType: command.commandType });
    this.assertStillFresh(command);
    this.assertWithinServerDeadline(context);
    try {
      await this.platform.requestGracefulClose({
        executablePath: installation.executablePath,
        pid: target.pid,
        startedAt: target.startedAt,
      });
      await this.platform.wait(this.config.observationDelayMs);
    } catch {
      return this.indeterminateQuit(command, context, pre, preRuntime.runtimeState);
    }

    let post: ObservationState;
    try {
      post = await this.observe(installation);
    } catch {
      return this.indeterminateQuit(command, context, pre, preRuntime.runtimeState);
    }
    const quitOccurredAt = this.nowIso();
    const postObservedAt = Date.parse(post.observation.observedAt);
    if (postObservedAt < Date.parse(preRuntime.runtimeState.observedAt)
      || postObservedAt > Date.parse(quitOccurredAt)) {
      return this.indeterminateQuit(command, context, pre, preRuntime.runtimeState);
    }
    const postTargets = this.targetRecords(command, post);
    if (postTargets.length === 1 && postTargets[0].state === "stopped"
      && post.stateVersion !== pre.stateVersion) {
      const evidence = {
        target: command.payload.target,
        runtimeStateDigest: preRuntime.runtimeState.digest,
        runtimeObservedAt: preRuntime.runtimeState.observedAt,
        preflight: preRuntime.runtimeState.summary,
        blockers: [] as ProcessQuitBlockerCode[],
        preProcessStateVersion: pre.stateVersion,
        postProcessStateVersion: post.stateVersion,
        postObservedAt: post.observation.observedAt,
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
      return this.finish({
        ...this.base(command, context),
        commandType: command.commandType,
        status: "completed",
        outcomeCode: "GRACEFUL_QUIT_VERIFIED",
        occurredAt: quitOccurredAt,
        evidence,
      });
    }
    if (postTargets.length === 1 && (postTargets[0].state === "running" || postTargets[0].state === "stopping")) {
      const evidence = {
        target: command.payload.target,
        runtimeStateDigest: preRuntime.runtimeState.digest,
        runtimeObservedAt: preRuntime.runtimeState.observedAt,
        preflight: preRuntime.runtimeState.summary,
        blockers: [] as ProcessQuitBlockerCode[],
        preProcessStateVersion: pre.stateVersion,
        postProcessStateVersion: post.stateVersion,
        postObservedAt: post.observation.observedAt,
        preProcessState: "running" as const,
        postProcessState: postTargets[0].state,
        matchedProcessCount: 1,
        gracefulQuitRequested: true,
        forceKillUsed: false as const,
        cancelOrdersUsed: false as const,
        flattenPositionsUsed: false as const,
        disconnectConnectionsUsed: false as const,
        mutationMayHaveOccurred: true,
        retrySafe: false,
      };
      return this.finish({
        ...this.base(command, context),
        commandType: command.commandType,
        status: "attention_required",
        outcomeCode: "GRACEFUL_QUIT_NOT_CONFIRMED",
        occurredAt: quitOccurredAt,
        evidence,
      });
    }
    return this.indeterminateQuit(command, context, pre, preRuntime.runtimeState, post);
  }

  private indeterminateQuit(
    command: QuitCommand,
    context: ProcessControlExecutionContext,
    pre: ObservationState,
    runtimeState: QuitCommand["payload"]["runtimeState"],
    post: ObservationState | null = null,
  ): ProcessControlAcknowledgement {
    const evidence = {
      target: command.payload.target,
      runtimeStateDigest: runtimeState.digest,
      runtimeObservedAt: runtimeState.observedAt,
      preflight: runtimeState.summary,
      blockers: [] as ProcessQuitBlockerCode[],
      preProcessStateVersion: pre.stateVersion,
      postProcessStateVersion: post?.stateVersion ?? null,
      postObservedAt: post?.observation.observedAt ?? null,
      preProcessState: "running" as const,
      postProcessState: "unknown" as const,
      matchedProcessCount: 1,
      gracefulQuitRequested: true,
      forceKillUsed: false as const,
      cancelOrdersUsed: false as const,
      flattenPositionsUsed: false as const,
      disconnectConnectionsUsed: false as const,
      mutationMayHaveOccurred: true,
      retrySafe: false,
    };
    return this.finish({
      ...this.base(command, context),
      commandType: command.commandType,
      status: "indeterminate",
      outcomeCode: "QUIT_RESULT_UNKNOWN",
      occurredAt: this.nowIso(),
      evidence,
    });
  }
}
