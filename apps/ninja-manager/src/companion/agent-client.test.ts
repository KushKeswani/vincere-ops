import { randomUUID } from 'node:crypto';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createDeliveredProcessControlCommand,
  PROCESS_CONTROL_PROTOCOL_VERSION,
  processControlApprovalIntentHash,
  type ProcessControlAcknowledgement,
  type ProcessControlCommand,
} from '@/lib/domain/process-control-contracts';
import { hashCanonicalPayload } from '@/lib/domain/runtime-contracts';

import { AgentApiClient } from './agent-client';

const BASE_URL = 'https://ninja-manager.test/';
const TOKEN = `vnm_${'a'.repeat(28)}`;
const ISSUED_AT = '2026-07-21T15:00:00.000Z';
const INSTALLATION_REF = `install_${'a'.repeat(32)}`;
const STATE_VERSION = `sha256:${'1'.repeat(64)}`;

function deliveredLaunch() {
  const command: ProcessControlCommand = {
    protocolVersion: PROCESS_CONTROL_PROTOCOL_VERSION,
    commandType: 'LAUNCH_NINJATRADER',
    commandId: randomUUID(),
    correlationId: randomUUID(),
    agentId: randomUUID(),
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

function blockedLaunchAcknowledgement(
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

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('AgentApiClient process-control transport', () => {
  it('round-trips one strict process command on its separate endpoint', async () => {
    const envelope = deliveredLaunch();
    const delivery = {
      envelope,
      leaseId: randomUUID(),
      leaseExpiresAt: '2026-07-21T15:00:45.000Z',
      deliveryAttempt: 1 as const,
    };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      data: {
        protocolVersion: PROCESS_CONTROL_PROTOCOL_VERSION,
        command: delivery,
        serverTime: '2026-07-21T15:00:01.000Z',
      },
    }));
    vi.stubGlobal('fetch', fetchMock);
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    const monotonicNow = vi.fn()
      .mockReturnValueOnce(1_000)
      .mockReturnValueOnce(1_250);

    await expect(
      new AgentApiClient(BASE_URL, TOKEN, monotonicNow).pollProcessControl(),
    ).resolves.toEqual({
      ...delivery,
      serverDeadlineMonotonicMs: 45_000,
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [target, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(target.href).toBe(`${BASE_URL}api/v1/agent/process-control/poll`);
    expect(init.body).toBe('{}');
    expect(init.cache).toBe('no-store');
    expect(timeout).toHaveBeenCalledWith(65_000);
  });

  it('uses the earlier lease expiry and charges response travel against server TTL', async () => {
    const envelope = deliveredLaunch();
    const delivery = {
      envelope,
      leaseId: randomUUID(),
      leaseExpiresAt: '2026-07-21T15:00:20.000Z',
      deliveryAttempt: 1 as const,
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
      data: {
        protocolVersion: PROCESS_CONTROL_PROTOCOL_VERSION,
        command: delivery,
        serverTime: '2026-07-21T15:00:01.000Z',
      },
    })));
    const monotonicNow = vi.fn()
      .mockReturnValueOnce(2_000)
      .mockReturnValueOnce(2_500);

    await expect(
      new AgentApiClient(BASE_URL, TOKEN, monotonicNow).pollProcessControl(),
    ).resolves.toMatchObject({
      leaseId: delivery.leaseId,
      serverDeadlineMonotonicMs: 21_000,
    });
  });

  it('rejects a command whose server TTL elapsed during the poll response', async () => {
    const envelope = deliveredLaunch();
    const delivery = {
      envelope,
      leaseId: randomUUID(),
      leaseExpiresAt: '2026-07-21T15:00:45.000Z',
      deliveryAttempt: 1 as const,
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
      data: {
        protocolVersion: PROCESS_CONTROL_PROTOCOL_VERSION,
        command: delivery,
        serverTime: '2026-07-21T15:00:01.000Z',
      },
    })));
    const monotonicNow = vi.fn()
      .mockReturnValueOnce(1_000)
      .mockReturnValueOnce(45_000);

    await expect(
      new AgentApiClient(BASE_URL, TOKEN, monotonicNow).pollProcessControl(),
    ).rejects.toThrow(/elapsed before receipt/);
  });

  it('rejects missing, out-of-order, and expired server timing', async () => {
    const envelope = deliveredLaunch();
    const delivery = {
      envelope,
      leaseId: randomUUID(),
      leaseExpiresAt: '2026-07-21T15:00:45.000Z',
      deliveryAttempt: 1 as const,
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        data: {
          protocolVersion: PROCESS_CONTROL_PROTOCOL_VERSION,
          command: delivery,
        },
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: {
          protocolVersion: PROCESS_CONTROL_PROTOCOL_VERSION,
          command: delivery,
          serverTime: '2026-07-21T14:59:59.000Z',
        },
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: {
          protocolVersion: PROCESS_CONTROL_PROTOCOL_VERSION,
          command: delivery,
          serverTime: '2026-07-21T15:00:45.000Z',
        },
      }));
    vi.stubGlobal('fetch', fetchMock);
    const client = new AgentApiClient(BASE_URL, TOKEN, () => 1_000);

    await expect(client.pollProcessControl()).rejects.toThrow();
    await expect(client.pollProcessControl()).rejects.toThrow(/invalid or expired/);
    await expect(client.pollProcessControl()).rejects.toThrow(/invalid or expired/);
  });

  it('returns null and rejects legacy read-only poll envelopes', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        data: {
          protocolVersion: PROCESS_CONTROL_PROTOCOL_VERSION,
          command: null,
          serverTime: '2026-07-21T15:00:01.000Z',
        },
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: {
          protocolVersion: '1.0',
          commands: [],
          serverTime: '2026-07-21T15:00:01.000Z',
        },
      }));
    vi.stubGlobal('fetch', fetchMock);
    const client = new AgentApiClient(BASE_URL, TOKEN);

    await expect(client.pollProcessControl()).resolves.toBeNull();
    await expect(client.pollProcessControl()).rejects.toThrow();
  });

  it('posts a strict process acknowledgement and parses its receipt', async () => {
    const envelope = deliveredLaunch();
    const leaseId = randomUUID();
    const acknowledgement = blockedLaunchAcknowledgement(envelope.command, leaseId);
    const receipt = {
      acknowledgementRecordId: randomUUID(),
      status: 'blocked',
      duplicate: false,
    };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: receipt }, 202));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      new AgentApiClient(BASE_URL, TOKEN).acknowledgeProcessControl(acknowledgement),
    ).resolves.toEqual(receipt);

    const [target, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(target.pathname).toBe(
      `/api/v1/agent/process-control/commands/${acknowledgement.commandId}/acknowledgements`,
    );
    expect(JSON.parse(String(init.body))).toEqual(acknowledgement);
  });

  it('rejects a read-only acknowledgement before any process API call', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const legacy = {
      protocolVersion: '1.0',
      commandId: randomUUID(),
    };

    await expect(
      new AgentApiClient(BASE_URL, TOKEN).acknowledgeProcessControl(
        legacy as unknown as ProcessControlAcknowledgement,
      ),
    ).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('preserves the legacy read-only poll wire path, body, and 15 second timeout', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      data: {
        protocolVersion: '1.0',
        commands: [],
        serverTime: '2026-07-21T15:00:01.000Z',
      },
    }));
    vi.stubGlobal('fetch', fetchMock);
    const timeout = vi.spyOn(AbortSignal, 'timeout');

    await expect(new AgentApiClient(BASE_URL, TOKEN).poll()).resolves.toEqual([]);

    const [target, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(target.pathname).toBe('/api/v1/agent/commands/poll');
    expect(init.body).toBe(JSON.stringify({ limit: 1 }));
    expect(timeout).toHaveBeenCalledWith(15_000);
  });
});
