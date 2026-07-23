import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
  collectRuntimeDiscovery,
  companionRuntimeObservationV2ConfigSchema,
  createCompanionProcessHeartbeatObserver,
  createCompanionRuntimeV2Collector,
  enclosingHeartbeatObservedAt,
  mapExactProcessObservationV2,
  recordRuntimeDiscoveryEvent,
  runtimeDiscoveryTerminalOutcome,
  runtimeObservationV2DoctorSummary,
} from './companion-runtime-v2';
import { RuntimeObservationV2Collector } from './runtime-observation-collector';
import { type ProcessPlatformObservation } from './process-controller';
import { adaptAddonSnapshot } from './runtime-adapter';
import {
  RAW_NINJATRADER_ADDON_SNAPSHOT_V2_PROTOCOL,
  deriveRuntimeInstallationRefV2,
  type RawNinjaTraderAddonSnapshotV2,
} from './runtime-adapter-v2';
import { loadCompanionState, newCompanionState, saveCompanionState } from './state';

const AGENT_ID = '10000000-0000-4000-8000-000000000001';
const CORRELATION_ID = '10000000-0000-4000-8000-000000000002';
const COMMAND_ID = '10000000-0000-4000-8000-000000000003';
const OBSERVATION_ID = '10000000-0000-4000-8000-000000000004';
const OBSERVED_AT = '2026-07-21T12:00:00.000Z';
const EXECUTABLE = 'C:\\Program Files\\NinjaTrader 8\\bin\\NinjaTrader.exe';
const INSTALLATION_ID = 'raw-edith-installation';
const SESSION_ID = 'raw-per-run-session';
const ACCOUNT_ID = 'raw-account-id';

const complete = { status: 'complete' as const, errors: [] };
const unavailableMoney = {
  availability: 'unavailable' as const,
  currency: 'USD' as const,
  amountMinor: null,
  source: null,
  reasonCode: 'NOT_OBSERVED_YET' as const,
};

function addonSnapshot(): RawNinjaTraderAddonSnapshotV2 {
  return {
    protocolVersion: RAW_NINJATRADER_ADDON_SNAPSHOT_V2_PROTOCOL,
    observedAt: OBSERVED_AT,
    addon: {
      localId: 'raw-addon-id',
      status: 'connected',
      health: 'healthy',
      version: '2.0.0',
      ipcAuthenticated: true,
      capabilities: ['ACCOUNT_PNL', 'RUNTIME_DISCOVERY'],
    },
    connections: [],
    accounts: [{
      localId: ACCOUNT_ID,
      accountIdentifier: 'private-Sim101',
      classificationEvidence: {
        accountType: 'simulation',
        isSimulation: true,
        simulationMode: true,
        unavailableReasonCode: null,
      },
      connectionLocalIds: [],
      status: 'connected',
    }],
    strategies: [],
    positions: [],
    orders: [],
    executions: [],
    pnl: [{
      accountLocalId: ACCOUNT_ID,
      sessionDate: '2026-07-21',
      daily: {
        realized: {
          availability: 'available',
          currency: 'USD',
          amountMinor: 12_500,
          source: 'ninjatrader_performance',
        },
        unrealized: {
          availability: 'available',
          currency: 'USD',
          amountMinor: 2_050,
          source: 'ninjatrader_account_item',
        },
      },
      nativeLifetime: unavailableMoney,
    }],
    collectionScopes: {
      addon: complete,
      connections: complete,
      accounts: complete,
      strategies: complete,
      positions: complete,
      orders: complete,
      executions: complete,
      pnl: complete,
    },
  };
}

function fakeCollector(input: {
  ipcError?: Error;
  processes?: ProcessPlatformObservation['processes'];
  snapshot?: RawNinjaTraderAddonSnapshotV2;
} = {}) {
  const send = vi.fn(async () => {
    if (input.ipcError) throw input.ipcError;
    return { payload: input.snapshot ?? addonSnapshot() };
  });
  const observe = vi.fn(async () => ({
    observedAt: '2026-07-21T12:00:00.200Z',
    processes: input.processes ?? [{
      executablePath: EXECUTABLE,
      pid: 4242,
      startedAt: '2026-07-21T11:00:00.000Z',
      state: 'running',
    }],
    runtimeState: null,
  }));
  const collector = createCompanionRuntimeV2Collector({
    config: {
      ninjaTraderExecutablePath: EXECUTABLE,
      installationLocalId: INSTALLATION_ID,
      freshnessMaxAgeMs: 5_000,
    },
    collectionSessionLocalId: SESSION_ID,
    pipeName: 'VincereNinjaManager.v1',
    dependencies: {
      ipcSender: { send },
      processPlatform: { observe },
      localIpcSecret: Buffer.alloc(32, 7),
      identitySecret: Buffer.alloc(32, 9),
      uuid: () => OBSERVATION_ID,
      now: () => new Date('2026-07-21T12:00:00.250Z'),
    },
  });
  return { collector, observe, send };
}

function legacySnapshot() {
  return adaptAddonSnapshot({
    observedAt: OBSERVED_AT,
    addonVersion: '1.0.0',
    accounts: [],
    strategies: [],
  }, Buffer.alloc(32, 4));
}

describe('companion runtime v2 wiring', () => {
  it('accepts only the strict three-field v2 config with an exact local NinjaTrader path', () => {
    expect(companionRuntimeObservationV2ConfigSchema.parse({
      ninjaTraderExecutablePath: EXECUTABLE,
      installationLocalId: INSTALLATION_ID,
      freshnessMaxAgeMs: 5_000,
    })).toBeTruthy();
    expect(() => companionRuntimeObservationV2ConfigSchema.parse({
      ninjaTraderExecutablePath: '\\\\server\\share\\NinjaTrader.exe',
      installationLocalId: INSTALLATION_ID,
      freshnessMaxAgeMs: 5_000,
    })).toThrow();
    expect(() => companionRuntimeObservationV2ConfigSchema.parse({
      ninjaTraderExecutablePath: EXECUTABLE,
      installationLocalId: INSTALLATION_ID,
      freshnessMaxAgeMs: 5_000,
      unexpected: true,
    })).toThrow();
  });

  it('uses only the authenticated v2 command and explicit unavailable manager P&L', async () => {
    const { collector, observe, send } = fakeCollector();
    const observation = await collector.collect();
    expect(send).toHaveBeenCalledWith({
      command: 'GET_RUNTIME_OBSERVATION_V2',
      payload: {},
      secret: Buffer.alloc(32, 7),
      pipeName: 'VincereNinjaManager.v1',
    });
    expect(observe).toHaveBeenCalledWith(EXECUTABLE);
    expect(observation.state.pnl[0].managerObservedCumulative).toEqual({
      value: unavailableMoney,
      observedSince: null,
    });
  });

  it('keeps local identifiers and paths out of the event and doctor summary', async () => {
    const observation = await fakeCollector().collector.collect();
    const eventText = JSON.stringify(observation);
    for (const raw of [
      EXECUTABLE,
      INSTALLATION_ID,
      SESSION_ID,
      ACCOUNT_ID,
      'private-Sim101',
      'raw-addon-id',
    ]) expect(eventText).not.toContain(raw);
    expect(observation.state.process).toBeNull();

    const doctorText = JSON.stringify(runtimeObservationV2DoctorSummary(observation));
    for (const raw of [
      EXECUTABLE,
      INSTALLATION_ID,
      SESSION_ID,
      ACCOUNT_ID,
      'private-Sim101',
      '4242',
      observation.source.installationRef,
    ]) expect(doctorText).not.toContain(raw);
    expect(JSON.parse(doctorText)).toMatchObject({
      status: 'degraded',
      collectionMode: 'runtime_observation_v2',
      counts: { accounts: 1, executions: 0, pnl: 1 },
    });
  });

  it('marks absent, ambiguous, unknown, and provider-failed process evidence unavailable', async () => {
    expect(mapExactProcessObservationV2({
      processes: [{
        executablePath: EXECUTABLE,
        pid: 4242,
        startedAt: OBSERVED_AT,
        state: 'running',
      }],
    })).toEqual({
      process: null,
      processCollectionScope: {
        status: 'unavailable',
        errors: [{ code: 'CAPABILITY_UNSUPPORTED', retryable: false }],
      },
    });
    const cases: ProcessPlatformObservation['processes'][] = [
      [],
      [
        { executablePath: EXECUTABLE, pid: 1, startedAt: OBSERVED_AT, state: 'running' },
        { executablePath: EXECUTABLE, pid: 2, startedAt: OBSERVED_AT, state: 'running' },
      ],
      [{ executablePath: EXECUTABLE, pid: 3, startedAt: OBSERVED_AT, state: 'unknown' }],
    ];
    for (const processes of cases) {
      expect(mapExactProcessObservationV2({ processes })).toEqual({
        process: null,
        processCollectionScope: {
          status: 'unavailable',
          errors: [{ code: 'INCONSISTENT_RUNTIME_STATE', retryable: true }],
        },
      });
    }

    const failed = fakeCollector();
    failed.observe.mockRejectedValueOnce(new Error('fake process provider failure'));
    const observation = await failed.collector.collect();
    expect(observation.state.collection).toMatchObject({
      overall: 'partial',
      scopes: {
        process: {
          status: 'unavailable',
          errors: [{ code: 'INCONSISTENT_RUNTIME_STATE', retryable: true }],
        },
      },
    });
  });

  it('publishes a fresh exact not-running heartbeat prerequisite with the shared v2 installation reference', async () => {
    const identitySecret = Buffer.alloc(32, 9);
    const processPlatform = {
      observe: vi.fn(async () => ({
        observedAt: '2026-07-21T12:00:00.200Z',
        processes: [],
        runtimeState: null,
      })),
    };
    const observer = createCompanionProcessHeartbeatObserver({
      config: {
        ninjaTraderExecutablePath: EXECUTABLE,
        installationLocalId: INSTALLATION_ID,
        freshnessMaxAgeMs: 5_000,
      },
      processPlatform,
      identitySecret,
      now: () => new Date('2026-07-21T12:00:00.250Z'),
    });

    const evidence = await observer.observe();
    const runtimeObservation = await fakeCollector({ processes: [] }).collector.collect();
    expect(evidence).toMatchObject({
      observedAt: '2026-07-21T12:00:00.200Z',
      installationRef: deriveRuntimeInstallationRefV2(identitySecret, INSTALLATION_ID),
      state: 'not_running',
      processRef: null,
      matchedProcessCount: 0,
      unavailableReason: null,
    });
    expect(evidence.processStateVersion).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(evidence.installationRef).toBe(runtimeObservation.source.installationRef);
    expect(enclosingHeartbeatObservedAt(
      evidence,
      () => new Date('2026-07-21T12:00:00.250Z'),
    )).toBe('2026-07-21T12:00:00.250Z');
    expect(processPlatform.observe).toHaveBeenCalledWith(EXECUTABLE);
  });

  it('publishes one running process opaquely and withholds identity for ambiguity', async () => {
    const identitySecret = Buffer.alloc(32, 5);
    const processes: ProcessPlatformObservation['processes'] = [{
      executablePath: EXECUTABLE,
      pid: 4242,
      startedAt: '2026-07-21T11:00:00.000Z',
      state: 'running',
    }];
    const processPlatform = {
      observe: vi.fn(async () => ({
        observedAt: '2026-07-21T12:00:00.200Z',
        processes,
        runtimeState: null,
      })),
    };
    const observer = createCompanionProcessHeartbeatObserver({
      config: {
        ninjaTraderExecutablePath: EXECUTABLE,
        installationLocalId: INSTALLATION_ID,
        freshnessMaxAgeMs: 5_000,
      },
      processPlatform,
      identitySecret,
      now: () => new Date('2026-07-21T12:00:00.250Z'),
    });

    const running = await observer.observe();
    expect(running).toMatchObject({ state: 'running', matchedProcessCount: 1 });
    expect(running.processRef).toMatch(/^process_[a-f0-9]{64}$/);
    for (const raw of [EXECUTABLE, INSTALLATION_ID, '4242']) {
      expect(JSON.stringify(running)).not.toContain(raw);
    }

    processes.push({
      executablePath: EXECUTABLE,
      pid: 4243,
      startedAt: '2026-07-21T11:00:01.000Z',
      state: 'running',
    });
    expect(await observer.observe()).toMatchObject({
      state: 'ambiguous',
      processRef: null,
      matchedProcessCount: 2,
      unavailableReason: 'MULTIPLE_ACTIVE_PROCESSES',
    });
  });

  it('turns every configured process observation failure into explicit unknown evidence', async () => {
    const identitySecret = Buffer.alloc(32, 6);
    const processPlatform = {
      observe: vi.fn(async (): Promise<ProcessPlatformObservation> => {
        throw new Error(`private failure at ${EXECUTABLE}`);
      }),
    };
    const observer = createCompanionProcessHeartbeatObserver({
      config: {
        ninjaTraderExecutablePath: EXECUTABLE,
        installationLocalId: INSTALLATION_ID,
        freshnessMaxAgeMs: 5_000,
      },
      processPlatform,
      identitySecret,
      now: () => new Date('2026-07-21T12:00:01.000Z'),
    });

    const evidence = await observer.observe();
    expect(evidence).toEqual({
      observedAt: '2026-07-21T12:00:01.000Z',
      installationRef: deriveRuntimeInstallationRefV2(identitySecret, INSTALLATION_ID),
      state: 'unknown',
      processStateVersion: null,
      processRef: null,
      matchedProcessCount: null,
      unavailableReason: 'OBSERVATION_FAILED',
    });
    expect(JSON.stringify(evidence)).not.toContain(EXECUTABLE);
    expect(enclosingHeartbeatObservedAt(
      evidence,
      () => new Date('2026-07-21T12:00:00.000Z'),
    )).toBe(evidence.observedAt);
  });

  it('keeps the legacy v1 collector path when v2 config is absent', async () => {
    const snapshot = legacySnapshot();
    const collectLegacySnapshot = vi.fn(async () => snapshot);
    const result = await collectRuntimeDiscovery({
      v2Collector: null,
      collectLegacySnapshot,
    });
    expect(collectLegacySnapshot).toHaveBeenCalledOnce();
    expect(result).toEqual({
      mode: 'v1',
      eventType: 'runtime.snapshot',
      payload: snapshot,
      stateVersion: snapshot.stateVersion,
      counts: { accounts: 0, strategies: 0, executions: 0 },
    });
    expect(runtimeDiscoveryTerminalOutcome(result, ['accounts', 'strategies'])).toEqual({
      status: 'completed',
      messageCode: 'COMMAND_COMPLETED',
      completedScopes: ['accounts', 'strategies'],
      failedScopes: [],
      retrySafe: true,
      errorCode: 'NONE',
    });
  });

  it('never falls back to v1 or yields recordable success when configured v2 fails', async () => {
    const error = new Error('fake authenticated v2 failure');
    const v2Collector = { collect: vi.fn(async () => { throw error; }) };
    const collectLegacySnapshot = vi.fn(async () => legacySnapshot());
    await expect(collectRuntimeDiscovery({
      v2Collector: v2Collector as unknown as RuntimeObservationV2Collector,
      collectLegacySnapshot,
    })).rejects.toBe(error);
    expect(collectLegacySnapshot).not.toHaveBeenCalled();
  });

  it('never classifies requested partial v2 scopes as completed', async () => {
    const snapshot = addonSnapshot();
    snapshot.collectionScopes.accounts = {
      status: 'partial',
      errors: [{ code: 'CAPABILITY_UNSUPPORTED', retryable: false }],
    };
    const collection = await collectRuntimeDiscovery({
      v2Collector: fakeCollector({ snapshot }).collector,
      collectLegacySnapshot: vi.fn(async () => legacySnapshot()),
    });
    expect(runtimeDiscoveryTerminalOutcome(collection, ['accounts', 'strategies'])).toEqual({
      status: 'partial',
      messageCode: 'COMMAND_PARTIAL',
      completedScopes: ['strategies'],
      failedScopes: ['accounts'],
      retrySafe: false,
      errorCode: 'UNSUPPORTED_CAPABILITY',
    });
  });

  it('keeps unavailable requested v2 scopes fail-closed with retry evidence', async () => {
    const snapshot = addonSnapshot();
    snapshot.collectionScopes.strategies = {
      status: 'unavailable',
      errors: [{ code: 'ADDON_OFFLINE', retryable: true }],
    };
    const collection = await collectRuntimeDiscovery({
      v2Collector: fakeCollector({ snapshot }).collector,
      collectLegacySnapshot: vi.fn(async () => legacySnapshot()),
    });
    expect(runtimeDiscoveryTerminalOutcome(collection, ['strategies'])).toEqual({
      status: 'partial',
      messageCode: 'COMMAND_PARTIAL',
      completedScopes: [],
      failedScopes: ['strategies'],
      retrySafe: true,
      errorCode: 'ADDON_OFFLINE',
    });
  });

  it('persists and reloads the exact authenticated v2 event, digest, and counts', async () => {
    const collection = await collectRuntimeDiscovery({
      v2Collector: fakeCollector().collector,
      collectLegacySnapshot: vi.fn(async () => legacySnapshot()),
    });
    expect(collection).toMatchObject({
      mode: 'v2',
      eventType: 'runtime.observation_v2',
      counts: { accounts: 1, strategies: 0, executions: 0 },
    });
    const state = newCompanionState(AGENT_ID);
    const event = recordRuntimeDiscoveryEvent({
      state,
      agentId: AGENT_ID,
      correlationId: CORRELATION_ID,
      causationId: COMMAND_ID,
      collection,
    });
    expect(event).toMatchObject({
      eventType: 'runtime.observation_v2',
      correlationId: CORRELATION_ID,
      causationId: COMMAND_ID,
    });
    expect(event.payloadHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(event.envelopeHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(state.latestStateVersion).toBe(collection.stateVersion);
    expect(state.outbox).toEqual([event]);

    const directory = await mkdtemp(path.join(tmpdir(), 'vnm-companion-v2-'));
    const stateFile = path.join(directory, 'state.json');
    try {
      await saveCompanionState(stateFile, state);
      const reloaded = await loadCompanionState(stateFile, AGENT_ID);
      expect(reloaded).toEqual(state);
      expect(reloaded.outbox[0]).toEqual(event);
      expect(reloaded.outbox[0]?.eventType).toBe('runtime.observation_v2');
      expect(reloaded.latestStateVersion).toBe(collection.stateVersion);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
