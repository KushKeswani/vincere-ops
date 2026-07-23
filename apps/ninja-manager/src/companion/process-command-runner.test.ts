import { randomUUID } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import {
  buildIndeterminateProcessControlRecoveryAcknowledgement,
  NinjaTraderProcessController,
} from './process-controller';
import {
  companionProcessControlConfigSchema,
  companionStartupMode,
  launchReadinessFromRuntimeObservationV2,
  quitRuntimeStateFromRuntimeObservationV2,
  runProcessCommandStep,
  type ProcessControlAgentTransport,
  type ProcessCommandRunnerDependencies,
} from './process-command-runner';
import { newCompanionState, type CompanionState } from './state';
import {
  createDeliveredProcessControlCommand,
  PROCESS_CONTROL_PROTOCOL_VERSION,
  processControlApprovalIntentHash,
  type ProcessControlCommand,
} from '@/lib/domain/process-control-contracts';
import {
  runtimeObservationV2StateDigest,
  type RuntimeObservationV2State,
} from '@/lib/domain/runtime-observation-v2';

const AGENT_ID = '10000000-0000-4000-8000-000000000001';
const INSTANCE_A = '20000000-0000-4000-8000-000000000002';
const INSTANCE_B = '30000000-0000-4000-8000-000000000003';
const LEASE_ID = '40000000-0000-4000-8000-000000000004';
const NOW = new Date('2026-07-21T15:00:20.000Z');
const INSTALLATION_REF = `install_${'a'.repeat(32)}`;
const STATE_VERSION = `sha256:${'b'.repeat(64)}`;

function launchDelivery() {
  const command: Extract<ProcessControlCommand, { commandType: 'LAUNCH_NINJATRADER' }> = {
    protocolVersion: PROCESS_CONTROL_PROTOCOL_VERSION,
    commandType: 'LAUNCH_NINJATRADER',
    commandId: randomUUID(),
    correlationId: randomUUID(),
    agentId: AGENT_ID,
    idempotencyKey: `process-control:${randomUUID()}`,
    issuedAt: '2026-07-21T15:00:15.000Z',
    expiresAt: '2026-07-21T15:00:50.000Z',
    expectedProcessStateVersion: STATE_VERSION,
    dryRun: false,
    safetyPhase: 'local_supervised_process_control',
    approval: {
      approvalId: randomUUID(),
      interactiveConfirmationId: randomUUID(),
      approvedCommandType: 'LAUNCH_NINJATRADER',
      issuedAt: '2026-07-21T15:00:10.000Z',
      expiresAt: '2026-07-21T15:00:55.000Z',
      intentHash: `sha256:${'0'.repeat(64)}`,
    },
    payload: {
      target: { installationRef: INSTALLATION_REF },
      reasonCode: 'MANUAL_OPERATOR_LAUNCH',
    },
  };
  command.approval.intentHash = processControlApprovalIntentHash(command);
  return {
    envelope: createDeliveredProcessControlCommand(command),
    leaseId: LEASE_ID,
    leaseExpiresAt: '2026-07-21T15:00:45.000Z',
    deliveryAttempt: 1 as const,
    serverDeadlineMonotonicMs: 25_000,
  };
}

function activeState(
  state: CompanionState,
  overrides: Partial<NonNullable<CompanionState['activeProcessControl']>> = {},
) {
  const delivery = launchDelivery();
  state.activeProcessControl = {
    envelope: delivery.envelope,
    leaseId: delivery.leaseId,
    leaseExpiresAt: delivery.leaseExpiresAt,
    deliveryAttempt: 1,
    receivedAt: NOW.toISOString(),
    processInstanceId: INSTANCE_A,
    serverDeadlineMonotonicMs: delivery.serverDeadlineMonotonicMs,
    executionProcessInstanceId: null,
    actuationCommittedAt: null,
    terminalAcknowledgement: null,
    haltReason: null,
    ...overrides,
  };
  return state.activeProcessControl;
}

class FakeTransport implements ProcessControlAgentTransport {
  readonly pollProcessControl = vi.fn(async () => null as ReturnType<typeof launchDelivery> | null);
  readonly acknowledgementBodies: string[] = [];
  failAcknowledgements = 0;

  async acknowledgeProcessControl(acknowledgement: NonNullable<
    NonNullable<CompanionState['activeProcessControl']>['terminalAcknowledgement']
  >) {
    this.acknowledgementBodies.push(JSON.stringify(acknowledgement));
    if (this.failAcknowledgements > 0) {
      this.failAcknowledgements -= 1;
      throw new Error('network unavailable');
    }
    return {
      acknowledgementRecordId: randomUUID(),
      status: acknowledgement.status,
      duplicate: this.acknowledgementBodies.length > 1,
    };
  }
}

function fakeController(
  execute: NinjaTraderProcessController['execute'],
): NinjaTraderProcessController {
  return { execute } as NinjaTraderProcessController;
}

function dependencies(input: {
  state: CompanionState;
  client?: FakeTransport;
  controller: NinjaTraderProcessController;
  processInstanceId?: string;
  now?: Date;
  monotonicNow?: number;
}) {
  return {
    state: input.state,
    saveState: vi.fn(async () => undefined),
    client: input.client ?? new FakeTransport(),
    controller: input.controller,
    processInstanceId: input.processInstanceId ?? INSTANCE_A,
    now: () => new Date(input.now ?? NOW),
    monotonicNow: () => input.monotonicNow ?? 100,
  } satisfies ProcessCommandRunnerDependencies;
}

describe('durable process command runner', () => {
  it('keeps process polling absent unless the strict opt-in config block exists', () => {
    expect(companionProcessControlConfigSchema.optional().parse(undefined)).toBeUndefined();
    expect(companionProcessControlConfigSchema.safeParse({ enabled: false }).success).toBe(false);
    expect(companionProcessControlConfigSchema.safeParse({
      enabled: true,
      observationDelayMs: 500,
      executablePath: 'C:\\unsafe.exe',
    }).success).toBe(false);
  });

  it('uses a bounded startup mode label that does not call enabled process control read-only', () => {
    expect(companionStartupMode(false)).toBe('read-only supervised-simulation mode');
    expect(companionStartupMode(true)).toBe('opt-in local process-control mode');
    expect(companionStartupMode(true).length).toBeLessThan(80);
  });

  it('persists a delivery before execution and preserves its first monotonic deadline', async () => {
    const state = newCompanionState(AGENT_ID);
    const client = new FakeTransport();
    const delivery = launchDelivery();
    client.pollProcessControl.mockResolvedValueOnce(delivery);
    const observedDeadlines: number[] = [];
    const controller = fakeController(async (envelope, context) => {
      observedDeadlines.push(context.serverDeadlineMonotonicMs);
      return buildIndeterminateProcessControlRecoveryAcknowledgement(
        envelope,
        context,
        NOW.toISOString(),
      );
    });
    const deps = dependencies({ state, client, controller });

    await runProcessCommandStep(deps);

    expect(deps.saveState).toHaveBeenCalled();
    expect(observedDeadlines).toEqual([delivery.serverDeadlineMonotonicMs]);
    expect(client.acknowledgementBodies).toHaveLength(1);
    expect(state.activeProcessControl).toBeNull();
  });

  it('resumes a pre-marker failure only in a new process while wall deadlines remain valid', async () => {
    const state = newCompanionState(AGENT_ID);
    activeState(state, {
      executionProcessInstanceId: INSTANCE_A,
      haltReason: 'EXECUTION_FAILED_BEFORE_ACTUATION',
    });
    const client = new FakeTransport();
    const execute = vi.fn(async (envelope, context) =>
      buildIndeterminateProcessControlRecoveryAcknowledgement(
        envelope,
        context,
        NOW.toISOString(),
      ));
    const deps = dependencies({
      state,
      client,
      controller: fakeController(execute),
      processInstanceId: INSTANCE_B,
      monotonicNow: 1_000,
    });

    await expect(runProcessCommandStep(deps)).resolves.toBe('acknowledged');

    expect(execute).toHaveBeenCalledTimes(1);
    const usedContext = execute.mock.calls[0][1];
    expect(usedContext.serverDeadlineMonotonicMs).toBe(26_000);
    expect(state.activeProcessControl).toBeNull();
  });

  it('never executes the controller again after the actuation marker', async () => {
    const state = newCompanionState(AGENT_ID);
    activeState(state, {
      executionProcessInstanceId: INSTANCE_A,
      actuationCommittedAt: NOW.toISOString(),
    });
    const execute = vi.fn();
    const client = new FakeTransport();

    await expect(runProcessCommandStep(dependencies({
      state,
      client,
      controller: fakeController(execute),
      processInstanceId: INSTANCE_B,
    }))).resolves.toBe('acknowledged');

    expect(execute).not.toHaveBeenCalled();
    expect(client.acknowledgementBodies).toHaveLength(1);
    expect(JSON.parse(client.acknowledgementBodies[0])).toMatchObject({
      status: 'indeterminate',
      outcomeCode: 'LAUNCH_RESULT_UNKNOWN',
      evidence: { mutationMayHaveOccurred: true, retrySafe: false },
    });
  });

  it('replays a persisted terminal acknowledgement byte-for-byte', async () => {
    const state = newCompanionState(AGENT_ID);
    const active = activeState(state, {
      executionProcessInstanceId: INSTANCE_A,
      actuationCommittedAt: NOW.toISOString(),
    });
    active.terminalAcknowledgement = buildIndeterminateProcessControlRecoveryAcknowledgement(
      active.envelope,
      { leaseId: active.leaseId, sequence: 1, serverDeadlineMonotonicMs: 25_000 },
      NOW.toISOString(),
    );
    const client = new FakeTransport();
    client.failAcknowledgements = 1;
    const deps = dependencies({
      state,
      client,
      controller: fakeController(vi.fn()),
      processInstanceId: INSTANCE_B,
    });

    await expect(runProcessCommandStep(deps)).rejects.toThrow('network unavailable');
    await expect(runProcessCommandStep(deps)).resolves.toBe('acknowledged');

    expect(client.acknowledgementBodies).toHaveLength(2);
    expect(client.acknowledgementBodies[1]).toBe(client.acknowledgementBodies[0]);
  });

  it('never posts a terminal result whose durable save failed', async () => {
    const state = newCompanionState(AGENT_ID);
    const client = new FakeTransport();
    client.pollProcessControl.mockResolvedValueOnce(launchDelivery());
    const controller = fakeController(async (envelope, context) =>
      buildIndeterminateProcessControlRecoveryAcknowledgement(
        envelope,
        context,
        NOW.toISOString(),
      ));
    const deps = dependencies({ state, client, controller });
    let saves = 0;
    deps.saveState.mockImplementation(async () => {
      saves += 1;
      if (saves === 3) throw new Error('terminal persistence failed');
    });

    await expect(runProcessCommandStep(deps)).rejects.toThrow('terminal persistence failed');

    expect(client.acknowledgementBodies).toEqual([]);
    expect(state.activeProcessControl?.terminalAcknowledgement).toBeNull();
  });

  it('restores the pending acknowledgement in memory when durable clear fails', async () => {
    const state = newCompanionState(AGENT_ID);
    const active = activeState(state);
    active.terminalAcknowledgement = buildIndeterminateProcessControlRecoveryAcknowledgement(
      active.envelope,
      { leaseId: active.leaseId, sequence: 1, serverDeadlineMonotonicMs: 25_000 },
      NOW.toISOString(),
    );
    const client = new FakeTransport();
    const deps = dependencies({
      state,
      client,
      controller: fakeController(vi.fn()),
    });
    deps.saveState.mockRejectedValueOnce(new Error('clear persistence failed'));

    await expect(runProcessCommandStep(deps)).rejects.toThrow('clear persistence failed');

    expect(state.activeProcessControl?.terminalAcknowledgement).not.toBeNull();
    expect(client.acknowledgementBodies).toHaveLength(1);
    await expect(runProcessCommandStep(deps)).resolves.toBe('acknowledged');
    expect(client.acknowledgementBodies[1]).toBe(client.acknowledgementBodies[0]);
  });

  it('halts without polling or actuation when a wall deadline elapsed', async () => {
    const state = newCompanionState(AGENT_ID);
    activeState(state);
    const client = new FakeTransport();
    const execute = vi.fn();

    await expect(runProcessCommandStep(dependencies({
      state,
      client,
      controller: fakeController(execute),
      processInstanceId: INSTANCE_B,
      now: new Date('2026-07-21T15:00:46.000Z'),
    }))).resolves.toBe('manual_reconciliation_required');

    expect(client.pollProcessControl).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
    expect(state.activeProcessControl?.haltReason).toBe('WALL_DEADLINE_EXPIRED');
  });

  it('fails closed on a wall-clock rollback before rebasing a restart deadline', async () => {
    const state = newCompanionState(AGENT_ID);
    activeState(state);
    const client = new FakeTransport();
    const execute = vi.fn();

    await expect(runProcessCommandStep(dependencies({
      state,
      client,
      controller: fakeController(execute),
      processInstanceId: INSTANCE_B,
      now: new Date('2026-07-21T15:00:19.999Z'),
    }))).resolves.toBe('manual_reconciliation_required');

    expect(execute).not.toHaveBeenCalled();
    expect(client.pollProcessControl).not.toHaveBeenCalled();
    expect(state.activeProcessControl?.haltReason).toBe('WALL_DEADLINE_EXPIRED');
  });

  it('does not poll or execute process control while a read-only command is active', async () => {
    const state = newCompanionState(AGENT_ID);
    state.activeCommand = {} as NonNullable<CompanionState['activeCommand']>;
    const client = new FakeTransport();
    const execute = vi.fn();

    await expect(runProcessCommandStep(dependencies({
      state,
      client,
      controller: fakeController(execute),
    }))).resolves.toBe('blocked_by_read_only_command');

    expect(client.pollProcessControl).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });
});

function completeRuntimeObservation() {
  const complete = (itemCount: number) => ({ status: 'complete' as const, itemCount, errors: [] });
  const state: RuntimeObservationV2State = {
    process: {
      processRef: `process_${'c'.repeat(32)}`,
      status: 'running',
      health: 'healthy',
      processId: 9232,
      version: '8.1.7.2',
      startedAt: '2026-07-21T14:00:00.000Z',
    },
    addon: {
      addonRef: `addon_${'d'.repeat(32)}`,
      status: 'connected',
      health: 'healthy',
      version: '2.0.0',
      ipcAuthenticated: true,
      capabilities: ['RUNTIME_DISCOVERY'],
    },
    connections: [],
    accounts: [],
    strategies: [],
    positions: [],
    orders: [],
    executions: [],
    pnl: [],
    collection: {
      overall: 'complete',
      scopes: {
        process: complete(1),
        addon: complete(1),
        connections: complete(0),
        accounts: complete(0),
        strategies: complete(0),
        positions: complete(0),
        orders: complete(0),
        executions: complete(0),
        pnl: complete(0),
      },
    },
  };
  return {
    protocolVersion: 'runtime-observation/2.0' as const,
    observationId: randomUUID(),
    source: {
      collector: 'vps_companion_agent' as const,
      authority: 'ninjatrader_runtime' as const,
      installationRef: INSTALLATION_REF,
      collectionSessionRef: `session_${'e'.repeat(32)}`,
    },
    asOf: NOW.toISOString(),
    freshness: { status: 'fresh' as const, ageMs: 0, maxAgeMs: 5_000 },
    stateDigest: runtimeObservationV2StateDigest(state),
    state,
  };
}

describe('Runtime-v2 process evidence providers', () => {
  it('accepts only fresh authenticated Add-On readiness', () => {
    const valid = completeRuntimeObservation();
    expect(launchReadinessFromRuntimeObservationV2(valid, NOW)).toMatchObject({
      state: 'ready',
      authenticated: true,
    });
    expect(launchReadinessFromRuntimeObservationV2({}, NOW)).toMatchObject({
      state: 'unknown',
      reasonCode: 'PROVIDER_INVALID_RESPONSE',
    });
    expect(launchReadinessFromRuntimeObservationV2(
      valid,
      new Date(NOW.getTime() + 5_001),
    )).toMatchObject({
      state: 'unknown',
      reasonCode: 'OBSERVATION_STALE',
    });
  });

  it('returns quit state only for a fresh complete authoritative observation', () => {
    const valid = completeRuntimeObservation();
    expect(quitRuntimeStateFromRuntimeObservationV2(valid, NOW)).toMatchObject({
      summary: {
        armedScheduleCount: 0,
        accountCounts: { simulation: 0, live: 0, unknown: 0 },
        commandCounts: { inFlight: 0, indeterminate: 0 },
      },
    });

    const incomplete = structuredClone(valid);
    incomplete.state.collection.scopes.addon = {
      status: 'partial',
      itemCount: 1,
      errors: [{ code: 'SOURCE_ERROR', retryable: true }],
    };
    incomplete.state.collection.overall = 'partial';
    incomplete.stateDigest = runtimeObservationV2StateDigest(incomplete.state);
    expect(quitRuntimeStateFromRuntimeObservationV2(incomplete, NOW)).toBeNull();
    expect(quitRuntimeStateFromRuntimeObservationV2({}, NOW)).toBeNull();
    expect(quitRuntimeStateFromRuntimeObservationV2(
      valid,
      new Date(NOW.getTime() + 30_001),
    )).toBeNull();
  });
});
