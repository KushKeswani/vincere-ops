import { randomUUID } from 'node:crypto';

import { z } from 'zod';

import {
  agentEventSchema,
  commandAcknowledgementSchema,
  eventEnvelopeHash,
  hashCanonicalPayload,
  parseDeliveredReadOnlyCommandEnvelope,
  RUNTIME_PROTOCOL_VERSION,
  type AgentEvent,
  type CommandAcknowledgement,
} from '@/lib/domain/runtime-contracts';
import {
  deliveredProcessControlCommandSchema,
  parseProcessControlAcknowledgement,
  PROCESS_CONTROL_PROTOCOL_VERSION,
  processControlAcknowledgementSchema,
  processControlOutcomeStatusSchema,
  type ProcessControlAcknowledgement,
} from '@/lib/domain/process-control-contracts';

const pollResponseSchema = z.object({
  data: z.object({
    protocolVersion: z.literal(RUNTIME_PROTOCOL_VERSION),
    commands: z.array(z.object({
      envelope: z.unknown(),
      leaseId: z.uuid(),
      leaseExpiresAt: z.iso.datetime({ offset: true }),
      deliveryAttempt: z.number().int().positive(),
    }).strict()).max(10),
    serverTime: z.iso.datetime({ offset: true }),
  }).strict(),
}).strict();

const processControlDeliverySchema = z.object({
  envelope: deliveredProcessControlCommandSchema,
  leaseId: z.uuid(),
  leaseExpiresAt: z.iso.datetime({ offset: true }),
  deliveryAttempt: z.literal(1),
}).strict();

const processControlPollResponseSchema = z.object({
  data: z.object({
    protocolVersion: z.literal(PROCESS_CONTROL_PROTOCOL_VERSION),
    command: processControlDeliverySchema.nullable(),
    serverTime: z.iso.datetime({ offset: true }),
  }).strict(),
}).strict();

const processControlAcknowledgementResponseSchema = z.object({
  data: z.object({
    acknowledgementRecordId: z.uuid(),
    status: processControlOutcomeStatusSchema,
    duplicate: z.boolean(),
  }).strict(),
}).strict();

const PROCESS_CONTROL_HTTP_TIMEOUT_MS = 65_000;

export interface LeasedAgentCommand {
  envelope: ReturnType<typeof parseDeliveredReadOnlyCommandEnvelope>;
  leaseId: string;
  leaseExpiresAt: string;
  deliveryAttempt: number;
}

export interface LeasedProcessControlAgentCommand {
  envelope: z.infer<typeof deliveredProcessControlCommandSchema>;
  leaseId: string;
  leaseExpiresAt: string;
  deliveryAttempt: 1;
  /**
   * Absolute deadline on the companion's monotonic clock. This is anchored before
   * the poll request so HTTP response travel consumes, rather than extends, the
   * server-authoritative lease/command window.
   */
  serverDeadlineMonotonicMs: number;
}

export interface ProcessControlAcknowledgementReceipt {
  acknowledgementRecordId: string;
  status: z.infer<typeof processControlOutcomeStatusSchema>;
  duplicate: boolean;
}

export class AgentApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(message);
  }
}

export class AgentApiClient {
  private readonly baseUrl: URL;

  constructor(
    baseUrl: string,
    private readonly token: string,
    private readonly monotonicNow: () => number = () => performance.now(),
  ) {
    this.baseUrl = new URL(baseUrl);
    if (this.baseUrl.protocol !== 'https:' && !(
      this.baseUrl.protocol === 'http:' && this.baseUrl.hostname === '127.0.0.1'
    )) {
      throw new Error('Agent API requires HTTPS except for exact 127.0.0.1 loopback development');
    }
    if (!/^vnm_[A-Za-z0-9_-]{28,196}$/.test(token)) throw new Error('Agent token format is invalid');
  }

  async postEvent(event: AgentEvent): Promise<void> {
    await this.post('/api/v1/agent/events', agentEventSchema.parse(event));
  }

  async poll(limit = 1): Promise<LeasedAgentCommand[]> {
    const parsed = pollResponseSchema.parse(await this.post('/api/v1/agent/commands/poll', { limit }));
    return parsed.data.commands.map((delivery) => ({
      ...delivery,
      envelope: parseDeliveredReadOnlyCommandEnvelope(delivery.envelope),
    }));
  }

  async acknowledge(acknowledgement: CommandAcknowledgement): Promise<void> {
    const parsed = commandAcknowledgementSchema.parse(acknowledgement);
    await this.post(
      `/api/v1/agent/commands/${encodeURIComponent(parsed.commandId)}/acknowledgements`,
      parsed,
    );
  }

  async pollProcessControl(): Promise<LeasedProcessControlAgentCommand | null> {
    const requestStartedMonotonicMs = this.readMonotonicClock();
    const parsed = processControlPollResponseSchema.parse(
      await this.postProcessControl('/api/v1/agent/process-control/poll', {}),
    );
    const responseReceivedMonotonicMs = this.readMonotonicClock();
    if (responseReceivedMonotonicMs < requestStartedMonotonicMs) {
      throw new Error('Process-control monotonic clock moved backwards');
    }
    if (!parsed.data.command) return null;

    const serverTimeMs = Date.parse(parsed.data.serverTime);
    const commandIssuedAtMs = Date.parse(parsed.data.command.envelope.command.issuedAt);
    const commandExpiresAtMs = Date.parse(parsed.data.command.envelope.command.expiresAt);
    const leaseExpiresAtMs = Date.parse(parsed.data.command.leaseExpiresAt);
    const serverDeadlineWallMs = Math.min(commandExpiresAtMs, leaseExpiresAtMs);
    if (
      !Number.isFinite(serverTimeMs)
      || !Number.isFinite(commandIssuedAtMs)
      || !Number.isFinite(commandExpiresAtMs)
      || !Number.isFinite(leaseExpiresAtMs)
      || commandIssuedAtMs > serverTimeMs
      || serverTimeMs >= serverDeadlineWallMs
    ) {
      throw new Error('Process-control server timing is invalid or expired');
    }

    const serverDeadlineMonotonicMs = requestStartedMonotonicMs
      + (serverDeadlineWallMs - serverTimeMs);
    if (
      !Number.isFinite(serverDeadlineMonotonicMs)
      || serverDeadlineMonotonicMs <= responseReceivedMonotonicMs
    ) {
      throw new Error('Process-control server deadline elapsed before receipt');
    }
    return { ...parsed.data.command, serverDeadlineMonotonicMs };
  }

  async acknowledgeProcessControl(
    acknowledgement: ProcessControlAcknowledgement,
  ): Promise<ProcessControlAcknowledgementReceipt> {
    const parsedAcknowledgement = parseProcessControlAcknowledgement(acknowledgement);
    const response = processControlAcknowledgementResponseSchema.parse(await this.postProcessControl(
      `/api/v1/agent/process-control/commands/${encodeURIComponent(parsedAcknowledgement.commandId)}/acknowledgements`,
      processControlAcknowledgementSchema.parse(parsedAcknowledgement),
    ));
    return response.data;
  }

  private async post(pathname: string, body: unknown): Promise<unknown> {
    const target = new URL(pathname, this.baseUrl);
    const response = await fetch(target, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
      cache: 'no-store',
      signal: AbortSignal.timeout(15_000),
    });
    const text = await response.text();
    if (!response.ok) throw new AgentApiError(`Agent API returned HTTP ${response.status}`, response.status, text.slice(0, 2_048));
    return text ? JSON.parse(text) as unknown : {};
  }

  private async postProcessControl(pathname: string, body: unknown): Promise<unknown> {
    const target = new URL(pathname, this.baseUrl);
    const response = await fetch(target, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
      cache: 'no-store',
      signal: AbortSignal.timeout(PROCESS_CONTROL_HTTP_TIMEOUT_MS),
    });
    const text = await response.text();
    if (!response.ok) throw new AgentApiError(`Agent API returned HTTP ${response.status}`, response.status, text.slice(0, 2_048));
    return text ? JSON.parse(text) as unknown : {};
  }

  private readMonotonicClock(): number {
    const milliseconds = this.monotonicNow();
    if (!Number.isFinite(milliseconds) || milliseconds < 0) {
      throw new Error('Process-control monotonic clock is invalid');
    }
    return milliseconds;
  }
}

export function buildAgentEvent(input: {
  agentId: string;
  sequence: number;
  eventType: AgentEvent['eventType'];
  payload: AgentEvent['payload'];
  correlationId?: string | null;
  causationId?: string | null;
  eventId?: string;
  occurredAt?: string;
}): AgentEvent {
  const unsigned = {
    protocolVersion: RUNTIME_PROTOCOL_VERSION,
    eventId: input.eventId ?? randomUUID(),
    agentId: input.agentId,
    sequence: input.sequence,
    eventType: input.eventType,
    correlationId: input.correlationId ?? null,
    causationId: input.causationId ?? null,
    occurredAt: input.occurredAt ?? new Date().toISOString(),
    payloadHash: hashCanonicalPayload(input.payload),
    payload: input.payload,
  } as Omit<AgentEvent, 'envelopeHash'>;
  return agentEventSchema.parse({ ...unsigned, envelopeHash: eventEnvelopeHash(unsigned) });
}

export function buildAcknowledgement(input: Omit<CommandAcknowledgement, 'acknowledgementId' | 'evidenceHash' | 'protocolVersion'>): CommandAcknowledgement {
  return commandAcknowledgementSchema.parse({
    protocolVersion: RUNTIME_PROTOCOL_VERSION,
    acknowledgementId: randomUUID(),
    ...input,
    evidenceHash: hashCanonicalPayload(input.evidence),
  });
}
