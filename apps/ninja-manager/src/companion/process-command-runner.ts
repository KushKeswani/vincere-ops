import { z } from 'zod';

import {
  buildIndeterminateProcessControlRecoveryAcknowledgement,
  NinjaTraderProcessController,
  ProcessControllerRefusalError,
} from './process-controller';
import type { RuntimeObservationV2Collector } from './runtime-observation-collector';
import type { CompanionState } from './state';
import type {
  LeasedProcessControlAgentCommand,
  ProcessControlAcknowledgementReceipt,
} from './agent-client';
import {
  launchReadinessObservationSchema,
  MAX_LAUNCH_READINESS_AGE_MS,
  processQuitRuntimeStateDigest,
  processQuitRuntimeStateSchema,
  type LaunchReadinessObservation,
  type ProcessControlAcknowledgement,
} from '@/lib/domain/process-control-contracts';
import {
  runtimeObservationV2Schema,
} from '@/lib/domain/runtime-observation-v2';
import {
  isFreshMutationReadinessEvidence,
  mutationReadinessPreflightSchema,
  permitsMutationActuation,
} from '@/lib/domain/mutation-readiness-preflight';
import type { MutationReadinessPreflightCollector } from './mutation-readiness-preflight-collector';

export const companionProcessControlConfigSchema = z.object({
  enabled: z.literal(true),
  observationDelayMs: z.number().int().min(0).max(30_000).default(500),
}).strict();

export function companionStartupMode(processControlEnabled: boolean): string {
  return processControlEnabled
    ? 'opt-in local process-control mode'
    : 'read-only supervised-simulation mode';
}

export interface ProcessControlAgentTransport {
  pollProcessControl(): Promise<LeasedProcessControlAgentCommand | null>;
  acknowledgeProcessControl(
    acknowledgement: ProcessControlAcknowledgement,
  ): Promise<ProcessControlAcknowledgementReceipt>;
}

export interface ProcessCommandRunnerDependencies {
  state: CompanionState;
  saveState(): Promise<void>;
  client: ProcessControlAgentTransport;
  controller: NinjaTraderProcessController;
  processInstanceId: string;
  now(): Date;
  monotonicNow(): number;
}

export type ProcessCommandRunnerResult =
  | 'idle'
  | 'blocked_by_read_only_command'
  | 'received'
  | 'acknowledged'
  | 'ack_pending'
  | 'manual_reconciliation_required';

function safeNow(dependencies: ProcessCommandRunnerDependencies): Date {
  const now = dependencies.now();
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new Error('Process runner clock is invalid');
  }
  return new Date(now.getTime());
}

function wallDeadlineMs(active: NonNullable<CompanionState['activeProcessControl']>): number {
  return Math.min(
    Date.parse(active.envelope.command.expiresAt),
    Date.parse(active.envelope.command.approval.expiresAt),
    Date.parse(active.leaseExpiresAt),
  );
}

function executionContext(active: NonNullable<CompanionState['activeProcessControl']>) {
  return {
    leaseId: active.leaseId,
    sequence: 1,
    serverDeadlineMonotonicMs: active.serverDeadlineMonotonicMs,
  };
}

async function persistRecoveryAcknowledgement(
  dependencies: ProcessCommandRunnerDependencies,
): Promise<void> {
  const active = dependencies.state.activeProcessControl;
  if (!active || active.terminalAcknowledgement) return;
  const acknowledgement = buildIndeterminateProcessControlRecoveryAcknowledgement(
    active.envelope,
    executionContext(active),
    safeNow(dependencies).toISOString(),
  );
  active.terminalAcknowledgement = acknowledgement;
  try {
    await dependencies.saveState();
  } catch (error) {
    active.terminalAcknowledgement = null;
    throw error;
  }
}

async function postPendingAcknowledgement(
  dependencies: ProcessCommandRunnerDependencies,
): Promise<ProcessCommandRunnerResult> {
  const active = dependencies.state.activeProcessControl;
  if (!active?.terminalAcknowledgement) return 'idle';
  await dependencies.client.acknowledgeProcessControl(active.terminalAcknowledgement);
  dependencies.state.activeProcessControl = null;
  try {
    await dependencies.saveState();
  } catch (error) {
    dependencies.state.activeProcessControl = active;
    throw error;
  }
  return 'acknowledged';
}

/**
 * Executes at most one durable process-control transition. The caller must invoke
 * this only when process control was explicitly enabled in strict local config.
 */
export async function runProcessCommandStep(
  dependencies: ProcessCommandRunnerDependencies,
): Promise<ProcessCommandRunnerResult> {
  z.uuid().parse(dependencies.processInstanceId);
  let active = dependencies.state.activeProcessControl;

  if (active?.terminalAcknowledgement) {
    return postPendingAcknowledgement(dependencies);
  }
  if (active?.actuationCommittedAt) {
    await persistRecoveryAcknowledgement(dependencies);
    return postPendingAcknowledgement(dependencies);
  }
  if (dependencies.state.activeCommand) return 'blocked_by_read_only_command';

  if (!active) {
    const delivery = await dependencies.client.pollProcessControl();
    if (!delivery) return 'idle';
    const receivedAt = safeNow(dependencies).toISOString();
    dependencies.state.activeProcessControl = {
      envelope: delivery.envelope,
      leaseId: delivery.leaseId,
      leaseExpiresAt: delivery.leaseExpiresAt,
      deliveryAttempt: delivery.deliveryAttempt,
      receivedAt,
      processInstanceId: dependencies.processInstanceId,
      serverDeadlineMonotonicMs: delivery.serverDeadlineMonotonicMs,
      executionProcessInstanceId: null,
      actuationCommittedAt: null,
      terminalAcknowledgement: null,
      haltReason: null,
    };
    await dependencies.saveState();
    active = dependencies.state.activeProcessControl;
    if (!active) throw new Error('Persisted process delivery disappeared');
  }

  const now = safeNow(dependencies);
  const deadlineWallMs = wallDeadlineMs(active);
  const receivedAtMs = Date.parse(active.receivedAt);
  if (
    !Number.isFinite(deadlineWallMs)
    || !Number.isFinite(receivedAtMs)
    || now.getTime() < receivedAtMs
    || now.getTime() >= deadlineWallMs
  ) {
    active.haltReason = 'WALL_DEADLINE_EXPIRED';
    await dependencies.saveState();
    return 'manual_reconciliation_required';
  }

  if (active.processInstanceId !== dependencies.processInstanceId) {
    const monotonicNow = dependencies.monotonicNow();
    if (!Number.isFinite(monotonicNow) || monotonicNow < 0) {
      throw new Error('Process runner monotonic clock is invalid');
    }
    active.processInstanceId = dependencies.processInstanceId;
    active.serverDeadlineMonotonicMs = monotonicNow + (deadlineWallMs - now.getTime());
    active.executionProcessInstanceId = null;
    active.haltReason = null;
    await dependencies.saveState();
  } else if (
    active.executionProcessInstanceId === dependencies.processInstanceId
    || active.haltReason !== null
  ) {
    return 'manual_reconciliation_required';
  }

  active.executionProcessInstanceId = dependencies.processInstanceId;
  await dependencies.saveState();

  let acknowledgement: ProcessControlAcknowledgement;
  try {
    acknowledgement = await dependencies.controller.execute(
      active.envelope,
      executionContext(active),
      {
        beforeActuation: async ({ commandId }) => {
          const current = dependencies.state.activeProcessControl;
          if (!current || current.envelope.command.commandId !== commandId) {
            throw new Error('Durable process delivery changed before actuation');
          }
          if (current.actuationCommittedAt === null) {
            current.actuationCommittedAt = safeNow(dependencies).toISOString();
            await dependencies.saveState();
          }
        },
      },
    );
  } catch (error) {
    if (active.actuationCommittedAt !== null) {
      await persistRecoveryAcknowledgement(dependencies);
      return postPendingAcknowledgement(dependencies);
    } else {
      active.haltReason = error instanceof ProcessControllerRefusalError
        && (error.code === 'COMMAND_EXPIRED' || error.code === 'APPROVAL_EXPIRED')
        ? 'WALL_DEADLINE_EXPIRED'
        : 'EXECUTION_FAILED_BEFORE_ACTUATION';
      await dependencies.saveState();
      return 'manual_reconciliation_required';
    }
  }

  active.terminalAcknowledgement = acknowledgement;
  try {
    await dependencies.saveState();
  } catch (error) {
    active.terminalAcknowledgement = null;
    throw error;
  }

  if (!dependencies.state.activeProcessControl?.terminalAcknowledgement) return 'ack_pending';
  return postPendingAcknowledgement(dependencies);
}

function unknownLaunchReadiness(
  observedAt: string,
  reasonCode: Extract<LaunchReadinessObservation, { state: 'unknown' }>['reasonCode'],
  authenticated = false,
): LaunchReadinessObservation {
  return launchReadinessObservationSchema.parse({
    state: 'unknown',
    observedAt,
    source: 'authenticated_runtime_v2_addon_ipc',
    authenticated,
    reasonCode,
  });
}

export function launchReadinessFromRuntimeObservationV2(
  input: unknown,
  nowInput: Date,
): LaunchReadinessObservation {
  const now = new Date(nowInput);
  const fallbackTime = Number.isFinite(now.getTime()) ? now.toISOString() : new Date().toISOString();
  const parsed = runtimeObservationV2Schema.safeParse(input);
  if (!parsed.success) return unknownLaunchReadiness(fallbackTime, 'PROVIDER_INVALID_RESPONSE');
  const observedAt = parsed.data.asOf;
  const observedAtMs = Date.parse(observedAt);
  const ageMs = now.getTime() - observedAtMs;
  if (!Number.isFinite(ageMs) || ageMs < 0) {
    return unknownLaunchReadiness(observedAt, 'OBSERVATION_TIME_INVALID', true);
  }
  if (
    parsed.data.freshness.status !== 'fresh'
    || ageMs > MAX_LAUNCH_READINESS_AGE_MS
    || ageMs > parsed.data.freshness.maxAgeMs
  ) {
    return unknownLaunchReadiness(observedAt, 'OBSERVATION_STALE', true);
  }
  const addonScope = parsed.data.state.collection.scopes.addon;
  const addon = parsed.data.state.addon;
  if (addonScope.status !== 'complete' || addon === null) {
    return unknownLaunchReadiness(observedAt, 'ADDON_STATE_UNAVAILABLE', true);
  }
  if (
    addon.status === 'connected'
    && addon.health === 'healthy'
    && addon.ipcAuthenticated
  ) {
    return launchReadinessObservationSchema.parse({
      state: 'ready',
      observedAt,
      source: 'authenticated_runtime_v2_addon_ipc',
      authenticated: true,
      reasonCode: null,
    });
  }
  return launchReadinessObservationSchema.parse({
    state: 'not_ready',
    observedAt,
    source: 'authenticated_runtime_v2_addon_ipc',
    authenticated: true,
    reasonCode: 'ADDON_RUNTIME_NOT_READY',
  });
}

export function quitRuntimeStateFromMutationReadinessPreflight(
  input: unknown,
  nowInput: Date,
) {
  const parsed = mutationReadinessPreflightSchema.safeParse(input);
  const now = new Date(nowInput);
  const evidenceSummary = parsed.success ? parsed.data.addon.summary : null;
  if (!parsed.success
    || !Number.isFinite(now.getTime())
    || !isFreshMutationReadinessEvidence(parsed.data, now)
    || !permitsMutationActuation(parsed.data, now)
    || evidenceSummary === null) return null;

  const evidence = parsed.data.addon;
  const summary = {
    // This companion has no scheduler actuator. A future scheduler integration
    // must replace this with its durable local schedule authority before enabling
    // process control alongside scheduling.
    armedScheduleCount: 0,
    accountCounts: {
      simulation: evidenceSummary.accounts.simulation,
      evaluation: 0,
      funded: 0,
      live: 0,
      unknown: evidenceSummary.accounts.nonSimulationOrUnknown,
    },
    strategyCounts: {
      enabled: evidenceSummary.strategies.enabled,
      unknown: evidenceSummary.strategies.unknown,
    },
    positionCounts: evidenceSummary.positions,
    orderCounts: {
      working: evidenceSummary.orders.working,
      transitional: evidenceSummary.orders.transitional,
      unknown: evidenceSummary.orders.unknown,
    },
    // The process runner guarantees no read-only command or prior process result
    // can interleave with this preflight; the currently executing quit is excluded.
    commandCounts: { inFlight: 0, indeterminate: 0 },
  };
  return processQuitRuntimeStateSchema.parse({
    observedAt: evidence.completedAt,
    digest: processQuitRuntimeStateDigest(evidence.completedAt, summary),
    summary,
  });
}

export function createRuntimeV2ProcessEvidenceProviders(input: {
  collector: RuntimeObservationV2Collector;
  mutationReadinessCollector: MutationReadinessPreflightCollector;
  now(): Date;
}) {
  return {
    launchReadinessProvider: async () => launchReadinessFromRuntimeObservationV2(
      await input.collector.collect(),
      input.now(),
    ),
    runtimeStateProvider: async () => quitRuntimeStateFromMutationReadinessPreflight(
      await input.mutationReadinessCollector.collect(),
      input.now(),
    ),
  };
}
