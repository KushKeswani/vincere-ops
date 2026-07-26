export type CompanionMode = 'doctor' | 'once' | 'run';
export type DoctorProtocol = 'auto' | 'v1' | 'v2';

export type CompanionArguments = {
  mode: CompanionMode;
  configPath: string;
  doctorProtocol: DoctorProtocol;
};

const USAGE = 'Usage: companion.ts <doctor|once|run> --config <absolute-config-path> [--doctor-protocol <auto|v1|v2>]';

function usageError(detail: string): Error {
  return new Error(`${detail}. ${USAGE}`);
}

export function parseCompanionArguments(argv: readonly string[]): CompanionArguments {
  const rawMode = argv[0];
  if (rawMode !== 'doctor' && rawMode !== 'once' && rawMode !== 'run') {
    throw usageError('Mode must be exactly doctor, once, or run');
  }

  let configPath: string | null = null;
  let doctorProtocol: DoctorProtocol = 'auto';
  let doctorProtocolWasProvided = false;

  for (let index = 1; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) {
      throw usageError(`Missing value for ${flag ?? 'argument'}`);
    }

    if (flag === '--config') {
      if (configPath !== null) throw usageError('Duplicate --config flag');
      configPath = value;
      continue;
    }

    if (flag === '--doctor-protocol') {
      if (doctorProtocolWasProvided) throw usageError('Duplicate --doctor-protocol flag');
      if (value !== 'auto' && value !== 'v1' && value !== 'v2') {
        throw usageError('Doctor protocol must be exactly auto, v1, or v2');
      }
      doctorProtocol = value;
      doctorProtocolWasProvided = true;
      continue;
    }

    throw usageError(`Unknown flag ${flag}`);
  }

  if (configPath === null) throw usageError('Missing --config flag');
  if (rawMode !== 'doctor' && doctorProtocolWasProvided) {
    throw usageError('--doctor-protocol is valid only in doctor mode');
  }

  return { mode: rawMode, configPath, doctorProtocol };
}

export function resolveDoctorProtocol(
  requested: DoctorProtocol,
  runtimeV2Configured: boolean,
): Exclude<DoctorProtocol, 'auto'> {
  if (requested === 'v1') return 'v1';
  if (requested === 'v2' && !runtimeV2Configured) {
    throw new Error('Doctor protocol v2 was requested, but runtimeObservationV2 is not configured');
  }
  return requested === 'v2' || runtimeV2Configured ? 'v2' : 'v1';
}
