import { randomUUID } from 'node:crypto';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createDeliveredProcessControlCommand,
  PROCESS_CONTROL_PROTOCOL_VERSION,
  processControlApprovalIntentHash,
  type ProcessControlAcknowledgement,
  type ProcessControlCommand,
} from '@/lib/domain/process-control-contracts';
import { RuntimeServiceError } from '@/lib/domain/runtime-errors';
import { hashCanonicalPayload } from '@/lib/domain/runtime-contracts';

const mocks = vi.hoisted(() => ({
  authenticateAgentRequest: vi.fn(),
  leaseNextCommand: vi.fn(),
  recordAcknowledgement: vi.fn(),
}));

vi.mock('@/lib/auth/agent', () => ({
  authenticateAgentRequest: mocks.authenticateAgentRequest,
}));
vi.mock('@/lib/repositories/process-control-repository', () => ({
  getProcessControlRepository: () => ({
    leaseNextCommand: mocks.leaseNextCommand,
    recordAcknowledgement: mocks.recordAcknowledgement,
  }),
}));

import { POST as acknowledge } from './commands/[commandId]/acknowledgements/route';
import { POST as poll } from './poll/route';

const ORIGIN = 'https://ninja-manager.test';
const IDENTITY = {
  organizationId: '10000000-0000-4000-8000-000000000001',
  agentId: '30000000-0000-4000-8000-000000000001',
  credentialId: '40000000-0000-4000-8000-000000000001',
  protocolVersion: '1.0',
};
const ISSUED_AT = '2026-07-21T15:00:00.000Z';
const INSTALLATION_REF = `install_${'a'.repeat(32)}`;
const STATE_VERSION = `sha256:${'1'.repeat(64)}`;

function deliveredLaunch() {
  const command: ProcessControlCommand = {
    protocolVersion: PROCESS_CONTROL_PROTOCOL_VERSION,
    commandType: 'LAUNCH_NINJATRADER',
    commandId: randomUUID(),
    correlationId: randomUUID(),
    agentId: IDENTITY.agentId,
    idempotencyKey: `process-control:${randomUUID()}`,
    issuedAt: ISSUED_AT,
    expiresAt: '2026-07-21T15:00:45.000Z',
    expectedProcessStateVersion: STATE_VERSION,
    dryRun: false,
    safetyPhase: 'local_supervised_process_control',
    approval: {
      approvalId: randomUUID(),
      interactiveConfirmationId: randomUUID(),
      approvedCommandType: 'LAUNCH_NINJATRADER',
      issuedAt: '2026-07-21T14:59:50.000Z',
      expiresAt: '2026-07-21T15:00:50.000Z',
      intentHash: `sha256:${'0'.repeat(64)}`,
    },
    payload: {
      target: { installationRef: INSTALLATION_REF },
      reasonCode: 'MANUAL_OPERATOR_LAUNCH',
    },
  };
  command.approval.intentHash = processControlApprovalIntentHash(command);
  return createDeliveredProcessControlCommand(command);
}

function blockedAcknowledgement(
  command: ReturnType<typeof deliveredLaunch>['command'],
  leaseId: string,
): ProcessControlAcknowledgement {
  const evidence = {
    target: { installationRef: INSTALLATION_REF },
    preProcessStateVersion: STATE_VERSION,
    postProcessStateVersion: null,
    postObservedAt: null,
    preProcessState: 'unknown' as const,
    postProcessState: 'unknown' as const,
    processRef: null,
    matchedInstallationCount: 0,
    actuatorInvoked: false,
    mutationMayHaveOccurred: false,
    retrySafe: false,
  };
  return {
    protocolVersion: PROCESS_CONTROL_PROTOCOL_VERSION,
    acknowledgementId: randomUUID(),
    commandId: command.commandId,
    correlationId: command.correlationId,
    agentId: command.agentId,
    leaseId,
    sequence: 1,
    commandType: 'LAUNCH_NINJATRADER',
    status: 'blocked',
    outcomeCode: 'INSTALLATION_NOT_ALLOWLISTED',
    occurredAt: '2026-07-21T15:00:20.000Z',
    evidence,
    evidenceHash: hashCanonicalPayload(evidence),
  };
}

function postRequest(path: string, body: unknown): Request {
  return new Request(`${ORIGIN}${path}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer vnm_${'a'.repeat(28)}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.authenticateAgentRequest.mockResolvedValue(IDENTITY);
  mocks.leaseNextCommand.mockResolvedValue(null);
  mocks.recordAcknowledgement.mockResolvedValue({
    acknowledgementRecordId: randomUUID(),
    status: 'blocked',
    duplicate: false,
  });
});

describe('process-control agent Route Handlers', () => {
  it('requires agent authentication and never polls on an auth failure', async () => {
    mocks.authenticateAgentRequest.mockRejectedValueOnce(
      new RuntimeServiceError('UNAUTHORIZED', 'Invalid agent credential'),
    );

    const response = await poll(postRequest('/api/v1/agent/process-control/poll', {}));

    expect(response.status).toBe(401);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(mocks.leaseNextCommand).not.toHaveBeenCalled();
  });

  it('strictly accepts only an empty bounded poll request', async () => {
    const response = await poll(postRequest('/api/v1/agent/process-control/poll', { limit: 1 }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(mocks.leaseNextCommand).not.toHaveBeenCalled();
  });

  it('leases at most one exact process envelope with a process protocol response', async () => {
    const envelope = deliveredLaunch();
    const leaseId = randomUUID();
    mocks.leaseNextCommand.mockResolvedValueOnce({
      envelope,
      leaseId,
      leaseExpiresAt: new Date('2026-07-21T15:00:45.000Z'),
      deliveryAttempt: 1,
    });

    const response = await poll(postRequest('/api/v1/agent/process-control/poll', {}));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(body).toEqual({
      data: {
        protocolVersion: PROCESS_CONTROL_PROTOCOL_VERSION,
        command: {
          envelope,
          leaseId,
          leaseExpiresAt: '2026-07-21T15:00:45.000Z',
          deliveryAttempt: 1,
        },
        serverTime: expect.any(String),
      },
    });
    expect(mocks.leaseNextCommand).toHaveBeenCalledWith(IDENTITY);
  });

  it('requires authentication independently on the acknowledgement endpoint', async () => {
    const envelope = deliveredLaunch();
    const acknowledgement = blockedAcknowledgement(envelope.command, randomUUID());
    mocks.authenticateAgentRequest.mockRejectedValueOnce(
      new RuntimeServiceError('UNAUTHORIZED', 'Invalid agent credential'),
    );

    const response = await acknowledge(
      postRequest(`/api/v1/agent/process-control/commands/${acknowledgement.commandId}/acknowledgements`, acknowledgement),
      { params: Promise.resolve({ commandId: acknowledgement.commandId }) },
    );

    expect(response.status).toBe(401);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(mocks.recordAcknowledgement).not.toHaveBeenCalled();
  });

  it('rejects legacy acknowledgement protocol objects before repository access', async () => {
    const commandId = randomUUID();
    const response = await acknowledge(
      postRequest(`/api/v1/agent/process-control/commands/${commandId}/acknowledgements`, {
        protocolVersion: '1.0',
        commandId,
      }),
      { params: Promise.resolve({ commandId }) },
    );

    expect(response.status).toBe(400);
    expect(mocks.recordAcknowledgement).not.toHaveBeenCalled();
  });

  it('rejects a valid acknowledgement whose strict body ID differs from the path', async () => {
    const envelope = deliveredLaunch();
    const acknowledgement = blockedAcknowledgement(envelope.command, randomUUID());
    const pathCommandId = randomUUID();

    const response = await acknowledge(
      postRequest(`/api/v1/agent/process-control/commands/${pathCommandId}/acknowledgements`, acknowledgement),
      { params: Promise.resolve({ commandId: pathCommandId }) },
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code: 'CONFLICT' });
    expect(mocks.recordAcknowledgement).not.toHaveBeenCalled();
  });

  it('records one strict terminal acknowledgement and returns its exact receipt', async () => {
    const envelope = deliveredLaunch();
    const acknowledgement = blockedAcknowledgement(envelope.command, randomUUID());
    const receipt = {
      acknowledgementRecordId: randomUUID(),
      status: 'blocked',
      duplicate: false,
    };
    mocks.recordAcknowledgement.mockResolvedValueOnce(receipt);

    const response = await acknowledge(
      postRequest(`/api/v1/agent/process-control/commands/${acknowledgement.commandId}/acknowledgements`, acknowledgement),
      { params: Promise.resolve({ commandId: acknowledgement.commandId }) },
    );

    expect(response.status).toBe(202);
    expect(response.headers.get('cache-control')).toBe('no-store');
    await expect(response.json()).resolves.toEqual({ data: receipt });
    expect(mocks.recordAcknowledgement).toHaveBeenCalledWith(IDENTITY, acknowledgement);
  });
});
