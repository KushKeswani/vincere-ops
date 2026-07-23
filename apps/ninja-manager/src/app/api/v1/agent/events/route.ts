import { authenticateAgentRequest } from "@/lib/auth/agent";
import { apiError, readBoundedJson } from "@/lib/http/security";
import { getRuntimeRepository } from "@/lib/repositories/runtime-repository";

const MAX_EVENT_BYTES = 5_000_000;
const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

export async function POST(request: Request) {
  try {
    const identity = await authenticateAgentRequest(request);
    const body = await readBoundedJson(request, MAX_EVENT_BYTES);
    const result = await getRuntimeRepository().recordAgentEvent(identity, body);
    return Response.json(
      { data: result },
      { status: result.duplicate ? 200 : 202, headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    return apiError(error);
  }
}
