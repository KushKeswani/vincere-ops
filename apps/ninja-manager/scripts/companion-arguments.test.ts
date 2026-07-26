import { describe, expect, it } from 'vitest';

import { parseCompanionArguments, resolveDoctorProtocol } from './companion-arguments';

describe('companion arguments', () => {
  it('keeps doctor protocol selection automatic by default', () => {
    expect(parseCompanionArguments(['doctor', '--config', 'C:\\Vincere\\companion.json'])).toEqual({
      mode: 'doctor',
      configPath: 'C:\\Vincere\\companion.json',
      doctorProtocol: 'auto',
    });
  });

  it('accepts an explicit v1 doctor selection', () => {
    expect(parseCompanionArguments([
      'doctor',
      '--doctor-protocol',
      'v1',
      '--config',
      'C:\\Vincere\\companion.json',
    ])).toMatchObject({ mode: 'doctor', doctorProtocol: 'v1' });
  });

  it('rejects doctor protocol selection in once and run modes', () => {
    for (const mode of ['once', 'run']) {
      expect(() => parseCompanionArguments([
        mode,
        '--config',
        'C:\\Vincere\\companion.json',
        '--doctor-protocol',
        'v1',
      ])).toThrow('--doctor-protocol is valid only in doctor mode');
    }
  });

  it.each([
    [['invalid', '--config', 'config.json'], 'Mode must be exactly'],
    [['doctor', '--config'], 'Missing value for --config'],
    [['doctor', '--config', 'config.json', '--unknown', 'value'], 'Unknown flag --unknown'],
    [['doctor', '--config', 'a', '--config', 'b'], 'Duplicate --config flag'],
    [['doctor', '--config', 'config.json', '--doctor-protocol', 'V1'], 'Doctor protocol must be exactly'],
  ])('fails closed for invalid arguments: %j', (argumentsList, message) => {
    expect(() => parseCompanionArguments(argumentsList)).toThrow(message);
  });
});

describe('doctor protocol resolution', () => {
  it('forces v1 even when runtime v2 is configured', () => {
    expect(resolveDoctorProtocol('v1', true)).toBe('v1');
  });

  it('preserves automatic compatibility selection', () => {
    expect(resolveDoctorProtocol('auto', true)).toBe('v2');
    expect(resolveDoctorProtocol('auto', false)).toBe('v1');
  });

  it('fails closed when v2 is forced without v2 configuration', () => {
    expect(() => resolveDoctorProtocol('v2', false)).toThrow(
      'runtimeObservationV2 is not configured',
    );
  });
});
