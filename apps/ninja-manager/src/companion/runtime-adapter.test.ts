import { describe, expect, it } from 'vitest';

import { adaptAddonSnapshot } from './runtime-adapter';

describe('runtime adapter', () => {
  it('masks local identifiers and emits a supervised strict snapshot', () => {
    const snapshot = adaptAddonSnapshot({
      observedAt: '2026-07-15T12:00:00.000Z',
      addonVersion: '0.1.0',
      accounts: [{
        localId: 'Sim101',
        accountName: 'Sim101',
        accountKind: 'simulation',
        connectionName: 'Simulated Data Feed',
        connectionStatus: 'connected',
      }],
      strategies: [{
        localId: 'Sim101|Example|1',
        accountLocalId: 'Sim101',
        strategyName: 'Private Client Strategy',
        strategyType: 'Vincere.ExampleStrategy',
        instrument: 'MNQ 09-26',
        timeframe: '1 Minute',
        enabled: true,
        sync: true,
        runtimeState: 'running',
        stateCode: 'SYNCHRONIZED',
      }],
    }, Buffer.alloc(32, 9));

    expect(snapshot.collectionMode).toBe('supervised_simulation');
    expect(snapshot.accounts[0]).toMatchObject({
      maskedIdentifier: '****m101',
      displayLabel: 'Simulation account 1',
    });
    expect(JSON.stringify(snapshot)).not.toContain('Sim101');
    expect(JSON.stringify(snapshot)).not.toContain('Private Client Strategy');
    expect(snapshot.strategies[0]).toMatchObject({
      displayLabel: 'Strategy 1',
      instrumentCode: 'MNQ SEP26',
      sync: true,
      runtimeState: 'running',
    });
  });

  it('fails closed for timeframes protocol v1 cannot represent', () => {
    expect(() => adaptAddonSnapshot({
      observedAt: '2026-07-15T12:00:00.000Z',
      addonVersion: '0.1.0',
      accounts: [],
      strategies: [{
        localId: 'x', accountLocalId: 'missing', strategyName: 'x', strategyType: 'X',
        instrument: 'MNQ 09-26', timeframe: 'Unsupported:Renko', enabled: false,
        sync: null, runtimeState: 'disabled', stateCode: 'DISABLED_BY_CONFIGURATION',
      }],
    }, Buffer.alloc(32, 1))).toThrow();
  });
});
