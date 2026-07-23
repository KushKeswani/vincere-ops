import { describe, expect, it } from 'vitest';

import { companionRuntimeObservationV2ConfigSchema } from '../src/companion/companion-runtime-v2';
import {
  DEFAULT_NINJATRADER_EXECUTABLE_PATH,
  DEFAULT_NINJATRADER_INSTALLATION_LOCAL_ID,
  LOCAL_COMPANION_ENROLLMENT_CAPABILITIES,
  buildLocalCompanionConfiguration,
} from './enroll-local-companion';

const AGENT_ID = '10000000-0000-4000-8000-000000000001';

function build(agentId = AGENT_ID) {
  return buildLocalCompanionConfiguration({
    agentId,
    agentTokenFile: 'C:\\Vincere\\secrets\\agent.token',
    dashboardUrl: 'http://127.0.0.1:3000',
    enrollmentDatabaseUrl: 'file://C:/Vincere/operator-local-readiness',
    ipcSecretFile: 'C:\\Vincere\\secrets\\ipc-secret.bin',
    identitySecretFile: 'C:\\Vincere\\secrets\\identity-secret.bin',
    stateFile: 'C:\\Vincere\\state\\companion-state.json',
    logFile: 'C:\\Vincere\\logs\\companion.log',
  });
}

describe('local companion enrollment config generation', () => {
  it('generates the strict v2 observation block with a stable local installation identity', () => {
    const first = build();
    const second = build();

    expect(companionRuntimeObservationV2ConfigSchema.parse(first.runtimeObservationV2))
      .toEqual(first.runtimeObservationV2);
    expect(first.runtimeObservationV2).toEqual({
      ninjaTraderExecutablePath: DEFAULT_NINJATRADER_EXECUTABLE_PATH,
      installationLocalId: DEFAULT_NINJATRADER_INSTALLATION_LOCAL_ID,
      freshnessMaxAgeMs: 5_000,
    });
    expect(second.runtimeObservationV2.installationLocalId)
      .toBe(first.runtimeObservationV2.installationLocalId);
    expect(build('20000000-0000-4000-8000-000000000002').runtimeObservationV2.installationLocalId)
      .toBe(first.runtimeObservationV2.installationLocalId);
  });

  it('advertises observation without process control or trading actuation', () => {
    expect(LOCAL_COMPANION_ENROLLMENT_CAPABILITIES).toEqual([
      'command.acknowledgements',
      'process.observation',
      'runtime.discovery',
    ]);
    const serialized = JSON.stringify(LOCAL_COMPANION_ENROLLMENT_CAPABILITIES);
    for (const forbidden of [
      'process.control',
      'LAUNCH_NINJATRADER',
      'REQUEST_NINJATRADER_QUIT',
      'strategy.enable',
      'order.',
    ]) expect(serialized).not.toContain(forbidden);
  });

  it('contains only intentional local path references and never secret contents', () => {
    const config = build();
    const serialized = JSON.stringify(config);

    expect(serialized).not.toContain('agent-token-secret-value');
    expect(serialized).not.toContain('ipc-secret-bytes');
    expect(serialized).not.toContain('identity-secret-bytes');
    expect(serialized.match(/[A-Z]:\\\\[^"}]*/g)?.sort()).toEqual([
      'C:\\\\Program Files\\\\NinjaTrader 8\\\\bin\\\\NinjaTrader.exe',
      'C:\\\\Vincere\\\\logs\\\\companion.log',
      'C:\\\\Vincere\\\\secrets\\\\agent.token',
      'C:\\\\Vincere\\\\secrets\\\\identity-secret.bin',
      'C:\\\\Vincere\\\\secrets\\\\ipc-secret.bin',
      'C:\\\\Vincere\\\\state\\\\companion-state.json',
    ].sort());
    expect(serialized).not.toContain('NinjaTrader.exe"}');
  });
});
