import { z } from 'zod';

import { authenticateAgentRequest } from '@/lib/auth/agent';
import { PROCESS_CONTROL_PROTOCOL_VERSION } from '@/lib/domain/process-control-contracts';
import { apiError, readBoundedJson } from '@/lib/http/security';
import { getProcessControlRepository } from '@/lib/repositories/process-control-repository';

const MAX_POLL_BYTES = 1_024;
const pollSchema = z.object({}).strict();
const NO_STORE_HEADERS = { 'Cache-Control': 'no-store' };

export async function POST(request: Request) {
  try {
    const identity = await authenticateAgentRequest(request);
    pollSchema.parse(await readBoundedJson(request, MAX_POLL_BYTES));
    const leased = await getProcessControlRepository().leaseNextCommand(identity);
    const command = leased === null
      ? null
      : {
          ...leased,
          leaseExpiresAt: leased.leaseExpiresAt.toISOString(),
        };
    return Response.json(
      {
        data: {
          protocolVersion: PROCESS_CONTROL_PROTOCOL_VERSION,
          command,
          serverTime: new Date().toISOString(),
        },
      },
      { headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    const response = apiError(error);
    response.headers.set('Cache-Control', 'no-store');
    return response;
  }
}
