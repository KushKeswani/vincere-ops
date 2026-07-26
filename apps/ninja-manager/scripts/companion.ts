import { randomUUID } from 'node:crypto';
import { appendFile, open, readFile, rm } from 'node:fs/promises';
import path from 'node:path';

import { z } from 'zod';

import { parseCompanionArguments, resolveDoctorProtocol } from './companion-arguments';
import { AgentApiClient, AgentApiError, buildAcknowledgement, buildAgentEvent } from '../src/companion/agent-client';
import {
  collectRuntimeDiscovery,
  companionRuntimeObservationV2ConfigSchema,
  createCompanionProcessHeartbeatObserver,
  createCompanionRuntimeV2Collector,
  enclosingHeartbeatObservedAt,
  recordRuntimeDiscoveryEvent,
  runtimeDiscoveryTerminalOutcome,
  runtimeObservationV2DoctorSummary,
  type CompanionProcessHeartbeatObserver,
  type RuntimeDiscoverySelection,
} from '../src/companion/companion-runtime-v2';
import { sendLocalIpcCommand } from '../src/companion/local-ipc';
import { MutationReadinessPreflightCollector } from '../src/companion/mutation-readiness-preflight-collector';
import {
  companionProcessControlConfigSchema,
  companionStartupMode,
  createRuntimeV2ProcessEvidenceProviders,
  runProcessCommandStep,
  type ProcessCommandRunnerDependencies,
} from '../src/companion/process-command-runner';
import { NinjaTraderProcessController } from '../src/companion/process-controller';
import { adaptAddonSnapshot, type RawAddonSnapshot } from '../src/companion/runtime-adapter';
import { deriveRuntimeInstallationRefV2 } from '../src/companion/runtime-adapter-v2';
import { loadCompanionState, saveCompanionState, type CompanionState } from '../src/companion/state';
import { WindowsProcessPlatform } from '../src/companion/windows-process-platform';

const VERSION = '0.1.0';
const configSchema = z.object({
  agentId: z.uuid(),
  agentTokenFile: z.string().min(1),
  dashboardUrl: z.url(),
  enrollmentDatabaseUrl: z.string().regex(/^file:\/\//),
  ipcSecretFile: z.string().min(1),
  identitySecretFile: z.string().min(1),
  pipeName: z.string().regex(/^[A-Za-z0-9._-]{3,80}$/).default('VincereNinjaManager.v1'),
  stateFile: z.string().min(1),
  logFile: z.string().min(1),
  pollIntervalSeconds: z.number().int().min(2).max(60).default(5),
  heartbeatIntervalSeconds: z.number().int().min(15).max(120).default(30),
  runtimeObservationV2: companionRuntimeObservationV2ConfigSchema.optional(),
  processControl: companionProcessControlConfigSchema.optional(),
}).strict().superRefine((value, context) => {
  if (value.processControl && !value.runtimeObservationV2) {
    context.addIssue({
      code: 'custom',
      message: 'processControl requires the strict local runtimeObservationV2 configuration',
      path: ['processControl'],
    });
  }
});

type CompanionConfig = z.infer<typeof configSchema>;
type RuntimeV2Collector = RuntimeDiscoverySelection['v2Collector'];

async function log(config: CompanionConfig, message: string): Promise<void> {
  const safe = message.replace(/[\r\n]+/g, ' ').slice(0, 1_000);
  await appendFile(config.logFile, `${new Date().toISOString()} ${safe}\n`, { encoding: 'utf8', mode: 0o600 });
  console.log(`[Vincere companion] ${safe}`);
}

async function loadConfig(filePath: string): Promise<CompanionConfig> {
  return configSchema.parse(JSON.parse(await readFile(filePath, 'utf8')));
}

async function readSecret(filePath: string, label: string): Promise<Buffer> {
  const value = await readFile(filePath);
  if (value.length !== 32) throw new Error(`${label} must contain exactly 32 bytes`);
  return value;
}

async function queueEvent(
  config: CompanionConfig,
  state: CompanionState,
  eventType: 'agent.heartbeat' | 'runtime.snapshot',
  payload: Parameters<typeof buildAgentEvent>[0]['payload'],
  correlationId: string | null = null,
  causationId: string | null = null,
) {
  const event = buildAgentEvent({
    agentId: config.agentId,
    sequence: state.nextEventSequence,
    eventType,
    payload,
    correlationId,
    causationId,
  });
  state.nextEventSequence += 1;
  state.outbox.push(event);
  await saveCompanionState(config.stateFile, state);
  return event;
}

async function flushOutbox(config: CompanionConfig, state: CompanionState, client: AgentApiClient): Promise<void> {
  while (state.outbox[0]) {
    await client.postEvent(state.outbox[0]);
    state.outbox.shift();
    await saveCompanionState(config.stateFile, state);
  }
}

async function getAddonSnapshot(config: CompanionConfig, ipcSecret: Buffer): Promise<RawAddonSnapshot> {
  const result = await sendLocalIpcCommand<RawAddonSnapshot>({
    command: 'GET_RUNTIME_SNAPSHOT',
    secret: ipcSecret,
    pipeName: config.pipeName,
  });
  return result.payload;
}

async function getAddonVersion(config: CompanionConfig, ipcSecret: Buffer): Promise<string | null> {
  try {
    const result = await sendLocalIpcCommand<{ addonVersion: string }>({
      command: 'PING',
      secret: ipcSecret,
      pipeName: config.pipeName,
    });
    return result.payload.addonVersion;
  } catch {
    return null;
  }
}

async function sendHeartbeat(
  config: CompanionConfig,
  state: CompanionState,
  client: AgentApiClient,
  ipcSecret: Buffer,
  processHeartbeatObserver: CompanionProcessHeartbeatObserver | null,
): Promise<void> {
  const [addonVersion, processObservation] = await Promise.all([
    getAddonVersion(config, ipcSecret),
    processHeartbeatObserver?.observe(),
  ]);
  const observedAt = enclosingHeartbeatObservedAt(
    processObservation,
    () => new Date(),
  );
  await queueEvent(config, state, 'agent.heartbeat', {
    source: 'vps_companion_agent',
    observedAt,
    agentVersion: VERSION,
    health: addonVersion ? 'online' : 'degraded',
    addonConnected: addonVersion !== null,
    addonVersion,
    pendingEventCount: state.outbox.length,
    ...(processObservation ? { processObservation } : {}),
  });
  await flushOutbox(config, state, client);
}

type Evidence = Parameters<typeof buildAcknowledgement>[0]['evidence'];

async function acknowledge(
  config: CompanionConfig,
  state: CompanionState,
  client: AgentApiClient,
  status: 'accepted' | 'rejected' | 'started' | 'completed' | 'failed' | 'partial',
  messageCode: 'COMMAND_PERSISTED' | 'COMMAND_REJECTED_POLICY' | 'COMMAND_STARTED' | 'COMMAND_COMPLETED' | 'COMMAND_FAILED' | 'COMMAND_PARTIAL',
  evidence: Evidence,
): Promise<void> {
  const active = state.activeCommand;
  if (!active) throw new Error('No active command to acknowledge');
  if (!active.pendingAcknowledgement) {
    const command = active.envelope.command;
    active.pendingAcknowledgement = buildAcknowledgement({
      commandId: command.commandId,
      correlationId: command.correlationId,
      agentId: command.agentId,
      leaseId: active.leaseId,
      sequence: active.nextAcknowledgementSequence,
      status,
      messageCode,
      evidence,
      occurredAt: new Date().toISOString(),
    });
    await saveCompanionState(config.stateFile, state);
  }
  await client.acknowledge(active.pendingAcknowledgement);
  active.pendingAcknowledgement = null;
  active.nextAcknowledgementSequence += 1;
  await saveCompanionState(config.stateFile, state);
}

function emptyEvidence(errorCode: Evidence['errorCode'] = 'NONE', retrySafe = false): Evidence {
  return {
    resultEventIds: [],
    completedScopes: [],
    failedScopes: [],
    retrySafe,
    errorCode,
    observedStateVersion: null,
    counts: { accounts: 0, strategies: 0, executions: 0 },
  };
}

async function processCommand(
  config: CompanionConfig,
  state: CompanionState,
  client: AgentApiClient,
  ipcSecret: Buffer,
  identitySecret: Buffer,
  runtimeV2Collector: RuntimeV2Collector,
): Promise<void> {
  if (!state.activeCommand) {
    const [delivery] = await client.poll(1);
    if (!delivery) return;
    state.activeCommand = {
      ...delivery,
      stage: 'leased',
      nextAcknowledgementSequence: 1,
      resultEventId: null,
      observedStateVersion: null,
      counts: { accounts: 0, strategies: 0, executions: 0 },
      terminalOutcome: null,
      pendingAcknowledgement: null,
    };
    await saveCompanionState(config.stateFile, state);
  }

  const active = state.activeCommand;
  const command = active.envelope.command;
  if (Date.now() >= Date.parse(command.expiresAt) && !active.pendingAcknowledgement) {
    state.activeCommand = null;
    await saveCompanionState(config.stateFile, state);
    await log(config, `Discarded expired command ${command.commandId}.`);
    return;
  }

  if (command.commandType !== 'DISCOVER_RUNTIME_STATE') {
    await acknowledge(config, state, client, 'rejected', 'COMMAND_REJECTED_POLICY', emptyEvidence('UNSUPPORTED_CAPABILITY'));
    state.activeCommand = null;
    await saveCompanionState(config.stateFile, state);
    return;
  }

  if (active.stage === 'leased') {
    await acknowledge(config, state, client, 'accepted', 'COMMAND_PERSISTED', emptyEvidence());
    active.stage = 'accepted';
    await saveCompanionState(config.stateFile, state);
  }
  if (active.stage === 'accepted') {
    await acknowledge(config, state, client, 'started', 'COMMAND_STARTED', emptyEvidence());
    active.stage = 'started';
    await saveCompanionState(config.stateFile, state);
  }

  if (active.stage === 'started') {
    if (command.expectedStateVersion && command.expectedStateVersion !== state.latestStateVersion) {
      await acknowledge(config, state, client, 'failed', 'COMMAND_FAILED', emptyEvidence('STATE_CHANGED', true));
      state.activeCommand = null;
      await saveCompanionState(config.stateFile, state);
      return;
    }
    try {
      const collection = await collectRuntimeDiscovery({
        v2Collector: runtimeV2Collector,
        collectLegacySnapshot: async () => adaptAddonSnapshot(
          await getAddonSnapshot(config, ipcSecret),
          identitySecret,
        ),
      });
      const event = recordRuntimeDiscoveryEvent({
        state,
        agentId: config.agentId,
        correlationId: command.correlationId,
        causationId: command.commandId,
        collection,
      });
      active.resultEventId = event.eventId;
      active.observedStateVersion = collection.stateVersion;
      active.counts = collection.counts;
      active.terminalOutcome = runtimeDiscoveryTerminalOutcome(
        collection,
        command.payload.include,
      );
      active.stage = 'snapshot_recorded';
      await saveCompanionState(config.stateFile, state);
    } catch (error) {
      await acknowledge(config, state, client, 'failed', 'COMMAND_FAILED', emptyEvidence('ADDON_OFFLINE', true));
      state.activeCommand = null;
      await saveCompanionState(config.stateFile, state);
      await log(config, runtimeV2Collector
        ? 'Runtime observation v2 discovery failed before durable recording.'
        : `Read-only discovery failed: ${(error as Error).message}`);
      return;
    }
  }

  if (active.stage === 'snapshot_recorded') {
    await flushOutbox(config, state, client);
    const scopes = command.payload.include;
    const terminal = active.terminalOutcome ?? (runtimeV2Collector
      ? {
        status: 'partial' as const,
        messageCode: 'COMMAND_PARTIAL' as const,
        completedScopes: [],
        failedScopes: [...scopes],
        retrySafe: false,
        errorCode: 'INTERNAL_ERROR' as const,
      }
      : {
        status: 'completed' as const,
        messageCode: 'COMMAND_COMPLETED' as const,
        completedScopes: [...scopes],
        failedScopes: [],
        retrySafe: true,
        errorCode: 'NONE' as const,
      });
    await acknowledge(config, state, client, terminal.status, terminal.messageCode, {
      resultEventIds: active.resultEventId ? [active.resultEventId] : [],
      completedScopes: terminal.completedScopes,
      failedScopes: terminal.failedScopes,
      retrySafe: terminal.retrySafe,
      errorCode: terminal.errorCode,
      observedStateVersion: active.observedStateVersion,
      counts: active.counts,
    });
    state.activeCommand = null;
    await saveCompanionState(config.stateFile, state);
  }
}

async function doctor(
  config: CompanionConfig,
  ipcSecret: Buffer,
  identitySecret: Buffer,
  runtimeV2Collector: RuntimeV2Collector,
): Promise<void> {
  if (runtimeV2Collector) {
    console.log(JSON.stringify(
      runtimeObservationV2DoctorSummary(await runtimeV2Collector.collect()),
      null,
      2,
    ));
    return;
  }
  const capabilities = await sendLocalIpcCommand<{ addonVersion: string; commands: string[] }>({
    command: 'GET_CAPABILITIES', secret: ipcSecret, pipeName: config.pipeName,
  });
  const snapshot = adaptAddonSnapshot(await getAddonSnapshot(config, ipcSecret), identitySecret);
  console.log(JSON.stringify({
    status: 'ready',
    addonVersion: capabilities.payload.addonVersion,
    commands: capabilities.payload.commands,
    accountCount: snapshot.accounts.length,
    strategyCount: snapshot.strategies.length,
    collectionMode: snapshot.collectionMode,
  }, null, 2));
}

async function acquireProcessLock(lockPath: string) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const handle = await open(lockPath, 'wx', 0o600);
      await handle.writeFile(`${process.pid}\n`, 'utf8');
      await handle.sync();
      return handle;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST' || attempt > 0) throw error;
      let active = false;
      try {
        const existingPid = Number((await readFile(lockPath, 'utf8')).trim());
        if (Number.isInteger(existingPid) && existingPid > 0) {
          process.kill(existingPid, 0);
          active = true;
        }
      } catch { active = false; }
      if (active) throw new Error('Another companion process appears to be running');
      await rm(lockPath, { force: true });
    }
  }
  throw new Error('Unable to acquire companion process lock');
}

async function main() {
  const cli = parseCompanionArguments(process.argv.slice(2));
  const config = await loadConfig(path.resolve(cli.configPath));
  const doctorProtocol = cli.mode === 'doctor'
    ? resolveDoctorProtocol(cli.doctorProtocol, config.runtimeObservationV2 !== undefined)
    : null;
  const [ipcSecret, identitySecret] = await Promise.all([
    readSecret(config.ipcSecretFile, 'IPC secret'),
    readSecret(config.identitySecretFile, 'Identity secret'),
  ]);
  const runtimeV2Config = cli.mode === 'doctor' && doctorProtocol === 'v1'
    ? null
    : (config.runtimeObservationV2 ?? null);
  const observationProcessPlatform = runtimeV2Config
    ? new WindowsProcessPlatform()
    : null;
  const runtimeV2Collector = runtimeV2Config && observationProcessPlatform
    ? createCompanionRuntimeV2Collector({
      config: runtimeV2Config,
      collectionSessionLocalId: randomUUID(),
      pipeName: config.pipeName,
      dependencies: {
        ipcSender: { send: (input) => sendLocalIpcCommand(input) },
        processPlatform: observationProcessPlatform,
        localIpcSecret: ipcSecret,
        identitySecret,
        uuid: randomUUID,
        now: () => new Date(),
      },
    })
    : null;
  const processHeartbeatObserver = runtimeV2Config && observationProcessPlatform
    ? createCompanionProcessHeartbeatObserver({
      config: runtimeV2Config,
      processPlatform: observationProcessPlatform,
      identitySecret,
      now: () => new Date(),
    })
    : null;
  if (cli.mode === 'doctor') return doctor(config, ipcSecret, identitySecret, runtimeV2Collector);

  const token = (await readFile(config.agentTokenFile, 'utf8')).trim();
  const client = new AgentApiClient(config.dashboardUrl, token);
  const state = await loadCompanionState(config.stateFile, config.agentId);
  const processInstanceId = randomUUID();
  const processRunner = config.processControl && config.runtimeObservationV2 && runtimeV2Collector
    ? (() => {
      const mutationReadinessCollector = new MutationReadinessPreflightCollector({
        pipeName: config.pipeName,
        freshnessMaxAgeMs: 5_000,
      }, {
        ipcSender: { send: (input) => sendLocalIpcCommand(input) },
        localIpcSecret: ipcSecret,
        now: () => new Date(),
        uuid: randomUUID,
      });
      const providers = createRuntimeV2ProcessEvidenceProviders({
        collector: runtimeV2Collector,
        mutationReadinessCollector,
        now: () => new Date(),
      });
      const controllerPlatform = new WindowsProcessPlatform(providers);
      const controller = new NinjaTraderProcessController({
        installations: [{
          installationRef: deriveRuntimeInstallationRefV2(
            identitySecret,
            config.runtimeObservationV2.installationLocalId,
          ),
          executablePath: config.runtimeObservationV2.ninjaTraderExecutablePath,
        }],
        observationDelayMs: config.processControl.observationDelayMs,
      }, identitySecret, controllerPlatform);
      return {
        state,
        saveState: () => saveCompanionState(config.stateFile, state),
        client,
        controller,
        processInstanceId,
        now: () => new Date(),
        monotonicNow: () => performance.now(),
      } satisfies ProcessCommandRunnerDependencies;
    })()
    : null;
  await flushOutbox(config, state, client);
  await sendHeartbeat(config, state, client, ipcSecret, processHeartbeatObserver);

  if (cli.mode === 'once') {
    if (processRunner) await runProcessCommandStep(processRunner);
    if (!state.activeProcessControl) {
      await processCommand(config, state, client, ipcSecret, identitySecret, runtimeV2Collector);
    }
    return;
  }

  const lockPath = `${config.stateFile}.lock`;
  const lock = await acquireProcessLock(lockPath);
  const cleanup = async () => { await lock.close(); await rm(lockPath, { force: true }); };
  process.once('SIGINT', () => void cleanup().finally(() => process.exit(0)));
  process.once('SIGTERM', () => void cleanup().finally(() => process.exit(0)));

  let lastHeartbeat = Date.now();
  await log(config, `Companion ${VERSION} started in ${companionStartupMode(config.processControl !== undefined)}.`);
  try {
    while (true) {
      try {
        if (processRunner) await runProcessCommandStep(processRunner);
        if (!state.activeProcessControl) {
          await processCommand(config, state, client, ipcSecret, identitySecret, runtimeV2Collector);
        }
        if (Date.now() - lastHeartbeat >= config.heartbeatIntervalSeconds * 1_000) {
          await sendHeartbeat(config, state, client, ipcSecret, processHeartbeatObserver);
          lastHeartbeat = Date.now();
        }
      } catch (error) {
        const detail = error instanceof AgentApiError
          ? `dashboard HTTP ${error.status}`
          : (error as Error).message;
        await log(config, `Loop degraded: ${detail}`);
      }
      await new Promise((resolve) => setTimeout(resolve, config.pollIntervalSeconds * 1_000));
    }
  } finally {
    await cleanup();
  }
}

main().catch((error) => {
  console.error(`[Vincere companion] ${(error as Error).message}`);
  process.exitCode = 1;
});
