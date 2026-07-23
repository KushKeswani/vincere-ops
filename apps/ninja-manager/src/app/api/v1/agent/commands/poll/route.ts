import { z } from "zod";

import { authenticateAgentRequest } from "@/lib/auth/agent";
import { apiError, readBoundedJson } from "@/lib/http/security";
import { getRuntimeRepository } from "@/lib/repositories/runtime-repository";

const pollSchema = z.object({
  limit: z.number().int().min(1).max(10).default(5),
}).strict();

export async function POST(request: Request) {
  try {
    const identity = await authenticateAgentRequest(request);
    const body = pollSchema.parse(await readBoundedJson(request, 8_192));
    const commands = await getRuntimeRepository().leaseCommands(identity, body.limit);
    return Response.json(
      {
        data: {
          protocolVersion: identity.protocolVersion,
          commands,
          serverTime: new Date().toISOString(),
        },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return apiError(error);
  }
}
