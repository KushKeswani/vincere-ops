import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import nextEnvironment from '@next/env';

import { getDatabase } from '../src/lib/db/client';
import { RuntimeRepository } from '../src/lib/repositories/runtime-repository';

const { loadEnvConfig } = nextEnvironment;
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DEFAULT_NINJATRADER_EXECUTABLE_PATH = 'C:\\Program Files\\NinjaTrader 8\\bin\\NinjaTrader.exe';
export const DEFAULT_NINJATRADER_INSTALLATION_LOCAL_ID = 'local-ninjatrader-default-installation';
export const DEFAULT_RUNTIME_OBSERVATION_FRESHNESS_MS = 5_000;
export const LOCAL_COMPANION_ENROLLMENT_CAPABILITIES = [
  'command.acknowledgements',
  'process.observation',
  'runtime.discovery',
] as const;

export interface LocalCompanionConfigurationInput {
  agentId: string;
  agentTokenFile: string;
  dashboardUrl: string;
  enrollmentDatabaseUrl: string;
  ipcSecretFile: string;
  identitySecretFile: string;
  stateFile: string;
  logFile: string;
}

/** Pure config generation keeps enrollment defaults testable without enrolling an agent. */
export function buildLocalCompanionConfiguration(input: LocalCompanionConfigurationInput) {
  return {
    agentId: input.agentId,
    agentTokenFile: input.agentTokenFile,
    dashboardUrl: input.dashboardUrl,
    enrollmentDatabaseUrl: input.enrollmentDatabaseUrl,
    ipcSecretFile: input.ipcSecretFile,
    identitySecretFile: input.identitySecretFile,
    pipeName: 'VincereNinjaManager.v1',
    stateFile: input.stateFile,
    logFile: input.logFile,
    pollIntervalSeconds: 5,
    heartbeatIntervalSeconds: 30,
    runtimeObservationV2: {
      ninjaTraderExecutablePath: DEFAULT_NINJATRADER_EXECUTABLE_PATH,
      installationLocalId: DEFAULT_NINJATRADER_INSTALLATION_LOCAL_ID,
      freshnessMaxAgeMs: DEFAULT_RUNTIME_OBSERVATION_FRESHNESS_MS,
    },
  };
}

function argument(name: string): string {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value) throw new Error(`Missing required argument ${name}`);
  return path.resolve(value);
}

async function main() {
  loadEnvConfig(projectRoot, true, console, true);
  const configFile = argument('--config');
  const tokenFile = argument('--token-file');
  const ipcSecretFile = argument('--ipc-secret-file');
  const identitySecretFile = argument('--identity-secret-file');
  const stateFile = argument('--state-file');
  const logFile = argument('--log-file');
  const dashboardUrlIndex = process.argv.indexOf('--dashboard-url');
  const dashboardUrl = dashboardUrlIndex >= 0 ? process.argv[dashboardUrlIndex + 1] : 'http://127.0.0.1:3000';
  if (!dashboardUrl) throw new Error('Dashboard URL is required');
  const enrollmentDatabaseUrl = process.env.DATABASE_URL;
  if (!enrollmentDatabaseUrl?.startsWith('file://')) {
    throw new Error('A local file:// DATABASE_URL is required for companion enrollment');
  }

  try {
    const existing = JSON.parse(await readFile(configFile, 'utf8')) as {
      agentId?: string;
      dashboardUrl?: string;
      enrollmentDatabaseUrl?: string;
    };
    if (!existing.agentId) throw new Error('Existing companion configuration has no agent ID');
    if (existing.dashboardUrl !== dashboardUrl || existing.enrollmentDatabaseUrl !== enrollmentDatabaseUrl) {
      throw new Error(
        'Existing companion enrollment is bound to a different or unknown dashboard database; archive it with the Windows preparation script before reenrolling',
      );
    }
    console.log(`Companion configuration already exists for agent ${existing.agentId}; enrollment was not duplicated.`);
    return;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }

  const database = getDatabase();
  try {
    const staffRows = await database.query<{
      id: string;
      organization_id: string;
      email: string;
      name: string;
    }>(
      "SELECT id, organization_id, email, name FROM users WHERE role = 'staff' ORDER BY created_at LIMIT 1",
    );
    const staff = staffRows[0];
    if (!staff) throw new Error('No local staff identity exists; run the documented database seed first');
    const environments = await database.query<{ id: string }>(
      'SELECT id FROM environments WHERE organization_id = $1 ORDER BY created_at LIMIT 1',
      [staff.organization_id],
    );
    const enrollment = await new RuntimeRepository(database).enrollAgent({
      id: staff.id,
      organizationId: staff.organization_id,
      email: staff.email,
      name: staff.name,
      role: 'staff',
    }, {
      displayName: 'Local NinjaTrader companion',
      agentVersion: '0.1.0',
      protocolVersion: '1.0',
      capabilities: [...LOCAL_COMPANION_ENROLLMENT_CAPABILITIES],
      environmentId: environments[0]?.id,
    });

    await Promise.all([
      mkdir(path.dirname(configFile), { recursive: true }),
      mkdir(path.dirname(tokenFile), { recursive: true }),
      mkdir(path.dirname(stateFile), { recursive: true }),
      mkdir(path.dirname(logFile), { recursive: true }),
    ]);
    await writeFile(tokenFile, `${enrollment.token}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    await writeFile(configFile, `${JSON.stringify(buildLocalCompanionConfiguration({
      agentId: enrollment.agentId,
      agentTokenFile: tokenFile,
      dashboardUrl,
      enrollmentDatabaseUrl,
      ipcSecretFile,
      identitySecretFile,
      stateFile,
      logFile,
    }), null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    console.log(`Local companion enrolled as ${enrollment.agentId}; token ends in ${enrollment.tokenLastFour}.`);
    console.log(`Credential expires ${enrollment.expiresAt.toISOString()}.`);
  } finally {
    await database.close();
  }
}

const entrypoint = process.argv[1];
if (
  entrypoint
  && path.resolve(entrypoint).toLocaleLowerCase('en-US')
    === fileURLToPath(import.meta.url).toLocaleLowerCase('en-US')
) {
  main().catch((error) => {
    console.error((error as Error).message);
    process.exitCode = 1;
  });
}
