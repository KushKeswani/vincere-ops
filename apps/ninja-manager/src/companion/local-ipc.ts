import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import net from 'node:net';

import { z } from 'zod';

export const LOCAL_IPC_PROTOCOL_VERSION = '1.0' as const;
export const DEFAULT_PIPE_NAME = 'VincereNinjaManager.v1';
export const MAX_LOCAL_IPC_BYTES = 5 * 1024 * 1024;

export const LOCAL_IPC_READ_ONLY_COMMANDS = [
  'PING',
  'GET_CAPABILITIES',
  'GET_RUNTIME_SNAPSHOT',
  'GET_RUNTIME_OBSERVATION_V2',
] as const;

export const localIpcCommandSchema = z.enum(LOCAL_IPC_READ_ONLY_COMMANDS);

export type LocalIpcCommand = z.infer<typeof localIpcCommandSchema>;

export interface LocalIpcRequest {
  protocolVersion: typeof LOCAL_IPC_PROTOCOL_VERSION;
  requestId: string;
  issuedAt: string;
  nonce: string;
  command: LocalIpcCommand;
  payloadJson: string;
  payloadSha256: string;
  signature: string;
}

const responseSchema = z.object({
  protocolVersion: z.literal(LOCAL_IPC_PROTOCOL_VERSION),
  requestId: z.uuid(),
  respondedAt: z.iso.datetime({ offset: true }),
  ok: z.boolean(),
  code: z.enum([
    'OK',
    'INVALID_REQUEST',
    'UNAUTHORIZED',
    'REPLAY',
    'CLOCK_SKEW',
    'UNSUPPORTED_COMMAND',
    'SECRET_UNAVAILABLE',
    'INTERNAL_ERROR',
  ]),
  payloadJson: z.string().max(MAX_LOCAL_IPC_BYTES),
  payloadSha256: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  signature: z.string().regex(/^hmac-sha256:[a-f0-9]{64}$/),
}).strict();

export type LocalIpcResponse = z.infer<typeof responseSchema>;

export function sha256Text(value: string): string {
  return `sha256:${createHash('sha256').update(value, 'utf8').digest('hex')}`;
}

function hmac(secret: Buffer, value: string): string {
  return `hmac-sha256:${createHmac('sha256', secret).update(value, 'utf8').digest('hex')}`;
}

function secureEquals(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, 'utf8');
  const rightBytes = Buffer.from(right, 'utf8');
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

export function requestSigningInput(request: Omit<LocalIpcRequest, 'signature'>): string {
  return [
    request.protocolVersion,
    request.requestId,
    request.issuedAt,
    request.nonce,
    request.command,
    request.payloadSha256,
  ].join('\n');
}

export function responseSigningInput(response: Omit<LocalIpcResponse, 'signature'>): string {
  return [
    response.protocolVersion,
    response.requestId,
    response.respondedAt,
    String(response.ok).toLowerCase(),
    response.code,
    response.payloadSha256,
  ].join('\n');
}

export function createSignedLocalRequest(
  command: LocalIpcCommand,
  payload: unknown,
  secret: Buffer,
  now = new Date(),
): LocalIpcRequest {
  if (secret.length !== 32) throw new Error('Local IPC secret must contain exactly 32 bytes');
  localIpcCommandSchema.parse(command);
  const payloadJson = JSON.stringify(payload);
  const unsigned = {
    protocolVersion: LOCAL_IPC_PROTOCOL_VERSION,
    requestId: randomUUID(),
    issuedAt: now.toISOString(),
    nonce: randomBytes(16).toString('base64url'),
    command,
    payloadJson,
    payloadSha256: sha256Text(payloadJson),
  } satisfies Omit<LocalIpcRequest, 'signature'>;
  return { ...unsigned, signature: hmac(secret, requestSigningInput(unsigned)) };
}

export function verifyLocalResponse(
  input: unknown,
  requestId: string,
  secret: Buffer,
  now = new Date(),
): LocalIpcResponse {
  const response = responseSchema.parse(input);
  if (response.requestId !== requestId) throw new Error('Local IPC response request ID mismatch');
  if (Math.abs(now.getTime() - Date.parse(response.respondedAt)) > 30_000) {
    throw new Error('Local IPC response timestamp is outside the 30-second safety window');
  }
  if (sha256Text(response.payloadJson) !== response.payloadSha256) {
    throw new Error('Local IPC response payload hash mismatch');
  }
  const { signature, ...unsigned } = response;
  const expected = hmac(secret, responseSigningInput(unsigned));
  if (!secureEquals(signature, expected)) throw new Error('Local IPC response signature mismatch');
  return response;
}

export async function sendLocalIpcCommand<T>(input: {
  command: LocalIpcCommand;
  payload?: unknown;
  secret: Buffer;
  pipeName?: string;
  timeoutMs?: number;
  now?: Date;
}): Promise<{ response: LocalIpcResponse; payload: T }> {
  const pipeName = input.pipeName ?? DEFAULT_PIPE_NAME;
  if (!/^[A-Za-z0-9._-]{3,80}$/.test(pipeName)) throw new Error('Local IPC pipe name is invalid');
  const timeoutMs = input.timeoutMs ?? 10_000;
  const request = createSignedLocalRequest(input.command, input.payload ?? {}, input.secret, input.now);
  const responseText = await exchangeLine(`\\\\.\\pipe\\${pipeName}`, JSON.stringify(request), timeoutMs);
  const response = verifyLocalResponse(JSON.parse(responseText) as unknown, request.requestId, input.secret);
  if (!response.ok) throw new Error(`NinjaTrader Add-On rejected ${input.command}: ${response.code}`);
  return { response, payload: JSON.parse(response.payloadJson) as T };
}

async function exchangeLine(pipePath: string, requestLine: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(pipePath);
    const chunks: Buffer[] = [];
    let byteCount = 0;
    let settled = false;

    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      reject(error);
    };

    socket.setTimeout(timeoutMs);
    socket.once('connect', () => socket.write(`${requestLine}\n`, 'utf8'));
    socket.on('data', (chunk: Buffer) => {
      byteCount += chunk.length;
      if (byteCount > MAX_LOCAL_IPC_BYTES) return fail(new Error('Local IPC response exceeded 5 MiB'));
      chunks.push(chunk);
      const combined = Buffer.concat(chunks);
      const newline = combined.indexOf(0x0a);
      if (newline < 0) return;
      if (settled) return;
      settled = true;
      socket.end();
      resolve(combined.subarray(0, newline).toString('utf8').replace(/^\uFEFF/, '').trim());
    });
    socket.once('timeout', () => fail(new Error(`Local IPC timed out after ${timeoutMs} ms`)));
    socket.once('error', (error) => fail(error));
    socket.once('end', () => {
      if (!settled) fail(new Error('Local IPC closed before returning a complete line'));
    });
  });
}
