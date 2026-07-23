import { getCurrentUser } from "@/lib/auth/session";
import { createClientSchema, requestIdSchema } from "@/lib/domain/schemas";
import { apiError, assertSameOrigin } from "@/lib/http/security";
import { IdempotencyConflictError, getNinjaRepository } from "@/lib/repositories/ninja-repository";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role !== "staff") return Response.json({ error: "Forbidden" }, { status: 403 });
  const clients = await getNinjaRepository().listClients(user);
  return Response.json({ data: clients.map((client) => ({ id: client.id, name: client.display_name, email: client.email, onboardingStatus: client.onboarding_status, timezone: client.timezone })) });
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await getCurrentUser();
    if (!user) throw new Error("Unauthorized");
    if (user.role !== "staff") throw new Error("Forbidden");
    const requestId = requestIdSchema.parse(request.headers.get("Idempotency-Key") ?? "");
    const parsed = createClientSchema.parse(await request.json());
    const id = await getNinjaRepository().createClient(user, parsed, requestId);
    return Response.json({ data: { id } }, { status: 201 });
  } catch (error) {
    if (error instanceof IdempotencyConflictError) {
      return Response.json({ error: error.message, code: "IDEMPOTENCY_CONFLICT" }, { status: 409 });
    }
    return apiError(error);
  }
}
