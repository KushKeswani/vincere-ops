import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { loadCompanionState, newCompanionState, saveCompanionState } from './state';

const temporaryDirectories: string[] = [];
const AGENT_ID = '10000000-0000-4000-8000-000000000001';

async function temporaryStatePath() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'vnm-companion-state-'));
  temporaryDirectories.push(directory);
  return path.join(directory, 'state.json');
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })));
});

describe('companion durable state', () => {
  it('loads the previous version-1 shape with process control disabled', async () => {
    const filePath = await temporaryStatePath();
    await writeFile(filePath, JSON.stringify({
      version: 1,
      agentId: AGENT_ID,
      nextEventSequence: 1,
      latestStateVersion: null,
      outbox: [],
      activeCommand: null,
    }), 'utf8');

    const loaded = await loadCompanionState(filePath, AGENT_ID);

    expect(loaded.activeProcessControl).toBeNull();
  });

  it('atomically persists the explicit absent process-control state', async () => {
    const filePath = await temporaryStatePath();
    const state = newCompanionState(AGENT_ID);

    await saveCompanionState(filePath, state);

    const serialized = JSON.parse(await readFile(filePath, 'utf8')) as Record<string, unknown>;
    expect(serialized.activeProcessControl).toBeNull();
    await expect(loadCompanionState(filePath, AGENT_ID)).resolves.toEqual(state);
  });
});
