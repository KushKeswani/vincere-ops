import { z } from 'zod';

import { authenticateAgentRequest } from '@/lib/auth/agent';
import { parseProcessControlAcknowledgement } from '@/lib/domain/process-control-contracts';
import { RuntimeServiceError } from '@/lib/domain/runtime-errors';
import { apiError, readBoundedJson } from '@/lib/http/security';
import { getProcessControlRepository } from '@/lib/repositories/process-control-repository';

const MAX_ACKNOWLEDGEMENT_BYTES = 65_536;
const commandIdSchema = z.uuid();
const NO_STORE_HEADERS = { 'Cache-Control': 'no-store' };

export async function POST(
  request: Request,
  { params }: { params: Promise<{ commandId: string }> },
) {
  try {
    const identity = await authenticateAgentRequest(request);
    const pathCommandId = commandIdSchema.parse((await params).commandId);
    const body = parseProcessControlAcknowledgement(
      await readBoundedJson(request, MAX_ACKNOWLEDGEMENT_BYTES),
    );
    if (body.commandId !== pathCommandId) {
      throw new RuntimeServiceError('CONFLICT', 'Path command ID does not match process acknowledgement envelope');
    }
    const result = await getProcessControlRepository().recordAcknowledgement(identity, body);
    return Response.json(
      { data: result },
      { status: result.duplicate ? 200 : 202, headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    const response = apiError(error);
    response.headers.set('Cache-Control', 'no-store');
    return response;
  }
}
