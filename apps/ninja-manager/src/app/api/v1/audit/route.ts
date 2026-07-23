import { getCurrentUser } from "@/lib/auth/session";
import { getNinjaRepository } from "@/lib/repositories/ninja-repository";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const repository = getNinjaRepository();
  const client = user.role === "client" ? await repository.getClientForUser(user) : null;
  const events = await repository.listAudit(user, client?.id);
  return Response.json(
    { data: events.map((event) => ({
      id: event.id,
      action: event.action,
      entityType: event.entity_type,
      entityId: event.entity_id,
      metadata: event.metadata,
      actor: event.actor_name,
      actorSubjectId: event.actor_subject_id,
      originInstallationId: event.origin_installation_id,
      eventVersion: event.event_version,
      evidenceHash: event.evidence_hash,
      legacyUnverified: event.legacy_unverified,
      occurredAt: event.created_at,
    })) },
    { headers: { "Cache-Control": "no-store" } },
  );
}
