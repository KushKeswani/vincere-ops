import { z } from "zod";

import { getCurrentUser } from "@/lib/auth/session";
import { getConnector } from "@/lib/connectors";
import { apiError, assertSameOrigin } from "@/lib/http/security";
import { getNinjaRepository } from "@/lib/repositories/ninja-repository";

const connectorSchema = z.enum(["ninjatrader", "vps", "discord", "ghl", "n8n"]);

export async function POST(request: Request, { params }: { params: Promise<{ connector: string }> }) {
  try {
    assertSameOrigin(request);
    const user = await getCurrentUser();
    if (!user) throw new Error("Unauthorized");
    const connector = connectorSchema.parse((await params).connector);
    const body = z.object({ clientId: z.string().uuid().optional(), simulatedStatus: z.enum(["healthy", "degraded", "offline"]).default("healthy") }).parse(await request.json().catch(() => ({})));
    let clientId = body.clientId;
    if (user.role === "client") {
      if (body.clientId) throw new Error("Forbidden");
      clientId = (await getNinjaRepository().getClientForUser(user))?.id;
    }
    if (!clientId) throw new Error("Client not found.");
    const result = await getConnector(connector, body.simulatedStatus).checkHealth(clientId);
    return Response.json({ data: result, simulation: true });
  } catch (error) {
    return apiError(error);
  }
}
