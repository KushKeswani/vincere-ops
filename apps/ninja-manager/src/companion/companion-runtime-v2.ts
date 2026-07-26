import path from 'node:path';

import { z } from 'zod';

import { buildAgentEvent } from './agent-client';
import {
  RuntimeObservationV2Collector,
  type AuthenticatedRuntimeObservationIpcSender,
  type CompanionProcessObservationV2,
  type RuntimeObservationV2ManagerLedgerProvider,
} from './runtime-observation-collector';
import { type ProcessPlatformObservation } from './process-controller';
import {
  createProcessObservation,
  createUnavailableProcessObservation,
} from './process-observation';
import { deriveRuntimeInstallationRefV2 } from './runtime-adapter-v2';
import { type CompanionState } from './state';
import { type RuntimeObservationV2 } from '@/lib/domain/runtime-observation-v2';
import {
  type AgentEvent,
  type ProcessObservation,
  type RuntimeSnapshotEvent,
} from '@/lib/domain/runtime-contracts';

const localIdSchema = z.string().min(1).max(1_024);
function isExactNinjaTraderPath(value: string): boolean {
  const normalized = path.win32.normalize(value);
  return !value.includes(String.fromCharCode(0)) && path.win32.isAbsolute(value)
    && /^[A-Za-z]:\\/.test(normalized) && !normalized.slice(2).includes(':')
    && path.win32.basename(normalized).toLocaleLowerCase('en-US') === 'ninjatrader.exe';
}
const ninjaTraderExecutablePathSchema = z.string().min(1).max(1_024).refine(isExactNinjaTraderPath);

export const companionRuntimeObservationV2ConfigSchema = z.object({
  ninjaTraderExecutablePath: ninjaTraderExecutablePathSchema,
  installationLocalId: localIdSchema,
  freshnessMaxAgeMs: z.number().int().min(1).max(3_600_000),
}).strict();

export type CompanionRuntimeObservationV2Config = z.infer<
  typeof companionRuntimeObservationV2ConfigSchema
>;

export interface RuntimeObservationProcessPlatform {
  observe(executablePath: string): Promise<ProcessPlatformObservation>;
}

export interface CompanionRuntimeV2Dependencies {
  ipcSender: AuthenticatedRuntimeObservationIpcSender;
  processPlatform: RuntimeObservationProcessPlatform;
  localIpcSecret: Buffer;
  identitySecret: Buffer;
  uuid(): string;
  now(): Date;
}

export interface CompanionProcessHeartbeatObserver {
  observe(): Promise<ProcessObservation>;
}

function safeCurrentTimestamp(now: () => Date): string {
  try {
    const value = now();
    if (Number.isFinite(value.getTime())) return value.toISOString();
  } catch {
    // Fall through to a fresh system timestamp without exposing provider detail.
  }
  return new Date().toISOString();
}

/** Enforces the heartbeat contract's process-observation timestamp ordering. */
export function enclosingHeartbeatObservedAt(
  processObservation: ProcessObservation | undefined,
  now: () => Date,
): string {
  const current = safeCurrentTimestamp(now);
  if (!processObservation) return current;
  return Date.parse(processObservation.observedAt) > Date.parse(current)
    ? processObservation.observedAt
    : current;
}

/**
 * Builds the always-present process evidence source used when v2 is configured.
 * Observation failures become explicit unknown evidence and never silently
 * downgrade to an omitted heartbeat field.
 */
export function createCompanionProcessHeartbeatObserver(input: {
  config: CompanionRuntimeObservationV2Config;
  processPlatform: RuntimeObservationProcessPlatform;
  identitySecret: Uint8Array;
  now(): Date;
}): CompanionProcessHeartbeatObserver {
  const config = companionRuntimeObservationV2ConfigSchema.parse(input.config);
  const installationRef = deriveRuntimeInstallationRefV2(
    input.identitySecret,
    config.installationLocalId,
  );
  return {
    async observe() {
      try {
        return createProcessObservation({
          installationRef,
          executablePath: config.ninjaTraderExecutablePath,
          identitySecret: input.identitySecret,
          observation: await input.processPlatform.observe(config.ninjaTraderExecutablePath),
        });
      } catch {
        return createUnavailableProcessObservation({
          observedAt: safeCurrentTimestamp(input.now),
          installationRef,
          reason: 'OBSERVATION_FAILED',
        });
      }
    },
  };
}

export type RuntimeDiscoveryCollection =
  | {
    mode: 'v1';
    eventType: 'runtime.snapshot';
    payload: RuntimeSnapshotEvent['payload'];
    stateVersion: string;
    counts: { accounts: number; strategies: number; executions: 0 };
  }
  | {
    mode: 'v2';
    eventType: 'runtime.observation_v2';
    payload: RuntimeObservationV2;
    stateVersion: string;
    counts: { accounts: number; strategies: number; executions: number };
  };

export type RuntimeDiscoveryRequestedScope = 'accounts' | 'strategies';
export interface RuntimeDiscoveryTerminalOutcome {
  status: 'completed' | 'partial';
  messageCode: 'COMMAND_COMPLETED' | 'COMMAND_PARTIAL';
  completedScopes: RuntimeDiscoveryRequestedScope[];
  failedScopes: RuntimeDiscoveryRequestedScope[];
  retrySafe: boolean;
  errorCode: 'NONE' | 'ADDON_OFFLINE' | 'COMMAND_TIMEOUT'
    | 'UNSUPPORTED_CAPABILITY' | 'INTERNAL_ERROR';
}

export interface RuntimeDiscoverySelection {
  v2Collector: RuntimeObservationV2Collector | null;
  collectLegacySnapshot(): Promise<RuntimeSnapshotEvent['payload']>;
}

const inconsistentProcessEvidence = (): CompanionProcessObservationV2 => ({
  process: null,
  processCollectionScope: {
    status: 'unavailable',
    errors: [{ code: 'INCONSISTENT_RUNTIME_STATE', retryable: true }],
  },
});

export function mapExactProcessObservationV2(
  input: unknown,
  identity: {
    installationRef: string;
    executablePath: string;
    identitySecret: Uint8Array;
  },
): CompanionProcessObservationV2 {
  try {
    const observation = input as ProcessPlatformObservation;
    const controllerEvidence = createProcessObservation({
      installationRef: identity.installationRef,
      executablePath: identity.executablePath,
      identitySecret: identity.identitySecret,
      observation,
    });
    if (controllerEvidence.processStateVersion === null) return inconsistentProcessEvidence();
    if (controllerEvidence.state === 'not_running') {
      return {
        process: {
          processRef: null,
          status: 'not_running',
          health: 'offline',
          version: null,
          startedAt: null,
        },
        processCollectionScope: { status: 'complete', errors: [] },
      };
    }
    if (controllerEvidence.state !== 'running' || controllerEvidence.processRef === null) {
      return inconsistentProcessEvidence();
    }
    const exactRunning = observation.processes.filter((record) => (
      record.state === 'running'
      && path.win32.normalize(record.executablePath).toLocaleLowerCase('en-US')
        === path.win32.normalize(identity.executablePath).toLocaleLowerCase('en-US')
    ));
    if (exactRunning.length !== 1 || !exactRunning[0]) return inconsistentProcessEvidence();
    return {
      process: {
        processRef: controllerEvidence.processRef,
        status: 'running',
        health: 'healthy',
        version: null,
        startedAt: exactRunning[0].startedAt,
      },
      processCollectionScope: { status: 'complete', errors: [] },
    };
  } catch {
    return inconsistentProcessEvidence();
  }
}

export function unavailableManagerLedgerProvider(): RuntimeObservationV2ManagerLedgerProvider {
  return {
    async readCumulativePnl(input) {
      return Object.fromEntries(input.accountLocalIds.map((accountLocalId) => [
        accountLocalId,
        {
          value: {
            availability: 'unavailable',
            currency: 'USD',
            amountMinor: null,
            source: null,
            reasonCode: 'NOT_OBSERVED_YET',
          },
          observedSince: null,
        },
      ]));
    },
  };
}

export function createCompanionRuntimeV2Collector(input: {
  config: CompanionRuntimeObservationV2Config;
  collectionSessionLocalId: string;
  pipeName: string;
  dependencies: CompanionRuntimeV2Dependencies;
}): RuntimeObservationV2Collector {
  const config = companionRuntimeObservationV2ConfigSchema.parse(input.config);
  const collectionSessionLocalId = localIdSchema.parse(input.collectionSessionLocalId);
  const installationRef = deriveRuntimeInstallationRefV2(
    input.dependencies.identitySecret,
    config.installationLocalId,
  );
  return new RuntimeObservationV2Collector({
    installationLocalId: config.installationLocalId,
    collectionSessionLocalId,
    freshnessMaxAgeMs: config.freshnessMaxAgeMs,
    pipeName: input.pipeName,
  }, {
    ipcSender: input.dependencies.ipcSender,
    processProvider: {
      async observe() {
        try {
          const observed = await input.dependencies.processPlatform.observe(
            config.ninjaTraderExecutablePath,
          );
          return mapExactProcessObservationV2(observed, {
            installationRef,
            executablePath: config.ninjaTraderExecutablePath,
            identitySecret: input.dependencies.identitySecret,
          });
        } catch {
          return inconsistentProcessEvidence();
        }
      },
    },
    managerLedgerProvider: unavailableManagerLedgerProvider(),
    localIpcSecret: input.dependencies.localIpcSecret,
    identitySecret: input.dependencies.identitySecret,
    uuid: input.dependencies.uuid,
    now: input.dependencies.now,
  });
}

/** A configured v2 failure propagates and is never replaced by a legacy snapshot. */
export async function collectRuntimeDiscovery(
  selection: RuntimeDiscoverySelection,
): Promise<RuntimeDiscoveryCollection> {
  if (selection.v2Collector) {
    const observation = await selection.v2Collector.collect();
    return {
      mode: 'v2',
      eventType: 'runtime.observation_v2',
      payload: observation,
      stateVersion: observation.stateDigest,
      counts: {
        accounts: observation.state.accounts.length,
        strategies: observation.state.strategies.length,
        executions: observation.state.executions.length,
      },
    };
  }
  const snapshot = await selection.collectLegacySnapshot();
  return {
    mode: 'v1',
    eventType: 'runtime.snapshot',
    payload: snapshot,
    stateVersion: snapshot.stateVersion,
    counts: {
      accounts: snapshot.accounts.length,
      strategies: snapshot.strategies.length,
      executions: 0,
    },
  };
}

export function recordRuntimeDiscoveryEvent(input: {
  state: CompanionState;
  agentId: string;
  correlationId: string;
  causationId: string;
  collection: RuntimeDiscoveryCollection;
}): AgentEvent {
  const event = buildAgentEvent({
    agentId: input.agentId,
    sequence: input.state.nextEventSequence,
    eventType: input.collection.eventType,
    payload: input.collection.payload,
    correlationId: input.correlationId,
    causationId: input.causationId,
  });
  input.state.nextEventSequence += 1;
  input.state.outbox.push(event);
  input.state.latestStateVersion = input.collection.stateVersion;
  return event;
}

export function runtimeObservationV2DoctorSummary(observation: RuntimeObservationV2) {
  const scopes = observation.state.collection.scopes;
  return {
    status: observation.freshness.status === 'fresh'
      && observation.state.collection.overall === 'complete'
      ? 'ready'
      : 'degraded',
    protocolVersion: observation.protocolVersion,
    collectionMode: 'runtime_observation_v2',
    freshness: observation.freshness.status,
    collectionOverall: observation.state.collection.overall,
    process: observation.state.process === null ? null : {
      status: observation.state.process.status,
      health: observation.state.process.health,
    },
    addon: observation.state.addon === null ? null : {
      status: observation.state.addon.status,
      health: observation.state.addon.health,
      version: observation.state.addon.version,
      ipcAuthenticated: observation.state.addon.ipcAuthenticated,
    },
    counts: {
      connections: observation.state.connections.length,
      accounts: observation.state.accounts.length,
      strategies: observation.state.strategies.length,
      positions: observation.state.positions.length,
      orders: observation.state.orders.length,
      executions: observation.state.executions.length,
      pnl: observation.state.pnl.length,
    },
    scopes: Object.fromEntries(Object.entries(scopes).map(([name, scope]) => [name, {
      status: scope.status,
      errorCodes: scope.errors.map((error) => error.code),
    }])),
  };
}

function terminalErrorCode(
  errors: Array<{ code: string; retryable: boolean }>,
): RuntimeDiscoveryTerminalOutcome['errorCode'] {
  const codes = new Set(errors.map((error) => error.code));
  if (codes.has('CAPABILITY_UNSUPPORTED')) return 'UNSUPPORTED_CAPABILITY';
  if (codes.has('COLLECTION_TIMEOUT')) return 'COMMAND_TIMEOUT';
  if (codes.has('ADDON_OFFLINE') || codes.has('CONNECTION_UNAVAILABLE')) return 'ADDON_OFFLINE';
  return 'INTERNAL_ERROR';
}

export function runtimeDiscoveryTerminalOutcome(
  collection: RuntimeDiscoveryCollection,
  requestedScopes: readonly RuntimeDiscoveryRequestedScope[],
): RuntimeDiscoveryTerminalOutcome {
  if (collection.mode === 'v1') {
    return {
      status: 'completed',
      messageCode: 'COMMAND_COMPLETED',
      completedScopes: [...requestedScopes],
      failedScopes: [],
      retrySafe: true,
      errorCode: 'NONE',
    };
  }
  const completedScopes = requestedScopes.filter(
    (scope) => collection.payload.state.collection.scopes[scope].status === 'complete',
  );
  const failedScopes = requestedScopes.filter((scope) => !completedScopes.includes(scope));
  if (failedScopes.length === 0) {
    return {
      status: 'completed',
      messageCode: 'COMMAND_COMPLETED',
      completedScopes: [...completedScopes],
      failedScopes: [],
      retrySafe: true,
      errorCode: 'NONE',
    };
  }
  const errors = failedScopes.flatMap(
    (scope) => collection.payload.state.collection.scopes[scope].errors,
  );
  return {
    status: 'partial',
    messageCode: 'COMMAND_PARTIAL',
    completedScopes: [...completedScopes],
    failedScopes: [...failedScopes],
    retrySafe: errors.every((error) => error.retryable),
    errorCode: terminalErrorCode(errors),
  };
}
