import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  createSignedLocalRequest,
  localIpcCommandSchema,
  requestSigningInput,
  responseSigningInput,
  sha256Text,
  verifyLocalResponse,
  type LocalIpcCommand,
  type LocalIpcResponse,
} from './local-ipc';

const secret = Buffer.alloc(32, 7);

function signedResponse(requestId: string): LocalIpcResponse {
  const unsigned = {
    protocolVersion: '1.0' as const,
    requestId,
    respondedAt: new Date().toISOString(),
    ok: true,
    code: 'OK' as const,
    payloadJson: '{"addonVersion":"0.1.0"}',
    payloadSha256: sha256Text('{"addonVersion":"0.1.0"}'),
  };
  const signature = `hmac-sha256:${createHmac('sha256', secret)
    .update(responseSigningInput(unsigned), 'utf8').digest('hex')}`;
  return { ...unsigned, signature };
}

describe('local IPC authentication', () => {
  it('creates signed read-only requests and verifies signed responses', () => {
    const request = createSignedLocalRequest('PING', {}, secret);
    expect(request.signature).toMatch(/^hmac-sha256:[a-f0-9]{64}$/);
    expect(verifyLocalResponse(signedResponse(request.requestId), request.requestId, secret).ok).toBe(true);
  });

  it('signs the additive runtime observation v2 read-only command', () => {
    const command: LocalIpcCommand = 'GET_RUNTIME_OBSERVATION_V2';
    const request = createSignedLocalRequest(command, {}, secret);
    const { signature, ...unsigned } = request;
    const expectedSignature = `hmac-sha256:${createHmac('sha256', secret)
      .update(requestSigningInput(unsigned), 'utf8').digest('hex')}`;

    expect(localIpcCommandSchema.parse(command)).toBe(command);
    expect(request.command).toBe(command);
    expect(requestSigningInput(unsigned).split('\n')[4]).toBe(command);
    expect(signature).toBe(expectedSignature);
  });

  it('keeps arbitrary and control commands outside the client allowlist', () => {
    expect(localIpcCommandSchema.safeParse('ARBITRARY_COMMAND').success).toBe(false);
    expect(localIpcCommandSchema.safeParse('ENABLE_ALL_STRATEGIES').success).toBe(false);

    if (false) {
      // @ts-expect-error -- control commands are intentionally unavailable at the client boundary.
      createSignedLocalRequest('ENABLE_ALL_STRATEGIES', {}, secret);
    }
  });

  it('rejects payload tampering', () => {
    const request = createSignedLocalRequest('PING', {}, secret);
    const response = signedResponse(request.requestId);
    expect(() => verifyLocalResponse({ ...response, payloadJson: '{}' }, request.requestId, secret))
      .toThrow('payload hash mismatch');
  });
});
