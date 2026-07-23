import { describe, expect, it } from "vitest";

import { AUDIT_EVENT_VERSION, auditEvidenceHash } from "./audit-evidence";

describe("canonical audit evidence", () => {
  it("binds every durable evidence field", () => {
    const evidence = {
      eventId: "10000000-0000-4000-8000-000000000001",
      eventVersion: AUDIT_EVENT_VERSION,
      organizationId: "20000000-0000-4000-8000-000000000001",
      actorSubjectId: "user:30000000-0000-4000-8000-000000000001",
      action: "entity.updated",
      entityType: "entity",
      entityId: "40000000-0000-4000-8000-000000000001",
      metadata: { state: "ready" },
      originInstallationId: "50000000-0000-4000-8000-000000000001",
      occurredAt: "2026-07-14T12:00:00.000Z",
    };
    const baseline = auditEvidenceHash(evidence);
    for (const changed of [
      { ...evidence, actorSubjectId: "agent:changed" },
      { ...evidence, action: "entity.deleted" },
      { ...evidence, entityId: "changed" },
      { ...evidence, metadata: { state: "changed" } },
      { ...evidence, originInstallationId: null },
      { ...evidence, occurredAt: "2026-07-14T12:00:01.000Z" },
    ]) {
      expect(auditEvidenceHash(changed)).not.toBe(baseline);
    }
  });
});
