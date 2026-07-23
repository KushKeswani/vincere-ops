import { authenticateAgentRequest } from "@/lib/auth/agent";
import { commandAcknowledgementSchema } from "@/lib/domain/runtime-contracts";
import { RuntimeServiceError } from "@/lib/domain/runtime-errors";
import { apiError, readBoundedJson } from "@/lib/http/security";
import { getRuntimeRepository } from "@/lib/repositories/runtime-repository";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ commandId: string }> },
) {
  try {
    const identity = await authenticateAgentRequest(request);
    const body = commandAcknowledgementSchema.parse(await readBoundedJson(request, 262_144));
    if (body.commandId !== (await params).commandId) {
      throw new RuntimeServiceError("CONFLICT", "Path command ID does not match acknowledgement envelope");
    }
    const result = await getRuntimeRepository().recordAcknowledgement(identity, body);
    return Response.json(
      { data: result },
      { status: result.duplicate ? 200 : 202, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return apiError(error);
  }
}
