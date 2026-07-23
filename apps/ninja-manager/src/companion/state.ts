import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { z } from 'zod';

import {
  agentEventSchema,
  commandAcknowledgementSchema,
  deliveredReadOnlyCommandEnvelopeSchema,
} from '@/lib/domain/runtime-contracts';
import {
  deliveredProcessControlCommandSchema,
  processControlAcknowledgementSchema,
} from '@/lib/domain/process-control-contracts';

const runtimeDiscoveryTerminalOutcomeSchema = z.object({
  status: z.enum(['completed', 'partial']),
  messageCode: z.enum(['COMMAND_COMPLETED', 'COMMAND_PARTIAL']),
  completedScopes: z.array(z.enum(['accounts', 'strategies'])).max(2),
  failedScopes: z.array(z.enum(['accounts', 'strategies'])).max(2),
  retrySafe: z.boolean(),
  errorCode: z.enum([
    'NONE',
    'ADDON_OFFLINE',
    'COMMAND_TIMEOUT',
    'UNSUPPORTED_CAPABILITY',
    'INTERNAL_ERROR',
  ]),
}).strict().superRefine((value, context) => {
  const complete = value.status === 'completed';
  if (value.messageCode !== (complete ? 'COMMAND_COMPLETED' : 'COMMAND_PARTIAL')) {
    context.addIssue({ code: 'custom', message: 'Terminal message code does not match status' });
  }
  if (complete !== (value.failedScopes.length === 0 && value.errorCode === 'NONE')) {
    context.addIssue({ code: 'custom', message: 'Terminal scope/error evidence is inconsistent' });
  }
  const all = [...value.completedScopes, ...value.failedScopes];
  if (new Set(all).size !== all.length) {
    context.addIssue({ code: 'custom', message: 'Terminal scopes must be disjoint and unique' });
  }
});

const activeCommandSchema = z.object({
  envelope: deliveredReadOnlyCommandEnvelopeSchema,
  leaseId: z.uuid(),
  leaseExpiresAt: z.iso.datetime({ offset: true }),
  deliveryAttempt: z.number().int().positive(),
  stage: z.enum(['leased', 'accepted', 'started', 'snapshot_recorded']),
  nextAcknowledgementSequence: z.number().int().positive(),
  resultEventId: z.uuid().nullable(),
  observedStateVersion: z.string().regex(/^sha256:[a-f0-9]{64}$/).nullable(),
  counts: z.object({
    accounts: z.number().int().min(0).max(500),
    strategies: z.number().int().min(0).max(10_000),
    executions: z.number().int().min(0).max(10_000),
  }).strict(),
  terminalOutcome: runtimeDiscoveryTerminalOutcomeSchema.nullable().default(null),
  pendingAcknowledgement: commandAcknowledgementSchema.nullable(),
}).strict();

const activeProcessControlSchema = z.object({
  envelope: deliveredProcessControlCommandSchema,
  leaseId: z.uuid(),
  leaseExpiresAt: z.iso.datetime({ offset: true }),
  deliveryAttempt: z.literal(1),
  receivedAt: z.iso.datetime({ offset: true }),
  processInstanceId: z.uuid(),
  serverDeadlineMonotonicMs: z.number().finite().nonnegative(),
  executionProcessInstanceId: z.uuid().nullable(),
  actuationCommittedAt: z.iso.datetime({ offset: true }).nullable(),
  terminalAcknowledgement: processControlAcknowledgementSchema.nullable(),
  haltReason: z.enum([
    'WALL_DEADLINE_EXPIRED',
    'EXECUTION_FAILED_BEFORE_ACTUATION',
  ]).nullable(),
}).strict().superRefine((value, context) => {
  if (value.actuationCommittedAt !== null && value.executionProcessInstanceId === null) {
    context.addIssue({ code: 'custom', message: 'An actuation marker requires a recorded execution process' });
  }
  if (value.terminalAcknowledgement !== null) {
    if (value.terminalAcknowledgement.commandId !== value.envelope.command.commandId) {
      context.addIssue({ code: 'custom', message: 'Pending process acknowledgement belongs to another command' });
    }
    if (value.terminalAcknowledgement.leaseId !== value.leaseId) {
      context.addIssue({ code: 'custom', message: 'Pending process acknowledgement belongs to another lease' });
    }
  }
});

const companionStateSchema = z.object({
  version: z.literal(1),
  agentId: z.uuid(),
  nextEventSequence: z.number().int().positive(),
  latestStateVersion: z.string().regex(/^sha256:[a-f0-9]{64}$/).nullable(),
  outbox: z.array(agentEventSchema).max(10_000),
  activeCommand: activeCommandSchema.nullable(),
  activeProcessControl: activeProcessControlSchema.nullable().default(null),
}).strict().superRefine((value, context) => {
  if (
    value.activeProcessControl
    && value.activeProcessControl.envelope.command.agentId !== value.agentId
  ) {
    context.addIssue({
      code: 'custom',
      message: 'Durable process command belongs to another agent identity',
      path: ['activeProcessControl', 'envelope', 'command', 'agentId'],
    });
  }
});

export type CompanionState = z.infer<typeof companionStateSchema>;
export type ActiveCommandState = NonNullable<CompanionState['activeCommand']>;
export type ActiveProcessControlState = NonNullable<CompanionState['activeProcessControl']>;

export function newCompanionState(agentId: string): CompanionState {
  return companionStateSchema.parse({
    version: 1,
    agentId,
    nextEventSequence: 1,
    latestStateVersion: null,
    outbox: [],
    activeCommand: null,
    activeProcessControl: null,
  });
}

export async function loadCompanionState(filePath: string, agentId: string): Promise<CompanionState> {
  try {
    const parsed = companionStateSchema.parse(JSON.parse(await readFile(filePath, 'utf8')));
    if (parsed.agentId !== agentId) throw new Error('Companion state belongs to a different agent identity');
    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return newCompanionState(agentId);
    throw error;
  }
}

export async function saveCompanionState(filePath: string, state: CompanionState): Promise<void> {
  const validated = companionStateSchema.parse(state);
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(validated)}\n`, { encoding: 'utf8', mode: 0o600 });
  await rename(temporary, filePath);
}
