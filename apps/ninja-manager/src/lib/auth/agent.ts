import "server-only";

import { RuntimeServiceError } from "@/lib/domain/runtime-errors";
import { getRuntimeRepository, type AgentIdentity } from "@/lib/repositories/runtime-repository";

export async function authenticateAgentRequest(request: Request): Promise<AgentIdentity> {
  const authorization = request.headers.get("authorization");
  const match = authorization?.match(/^Bearer ([A-Za-z0-9_-]{32,200})$/);
  if (!match) throw new RuntimeServiceError("UNAUTHORIZED", "A valid agent bearer credential is required");
  const identity = await getRuntimeRepository().authenticateAgentToken(match[1]);
  if (!identity) throw new RuntimeServiceError("UNAUTHORIZED", "Agent credential is invalid, expired, or revoked");
  return identity;
}
