import { describe, expect, it } from "vitest";

import {
  createSyncMessageEnvelope,
  parseSyncMessageEnvelope,
  portableChangeSchema,
} from "./sync-contracts";

const change = {
  recordType: "client" as const,
  recordId: "10000000-0000-4000-8000-000000000001",
  originInstallationId: "20000000-0000-4000-8000-000000000001",
  originMode: "LOCAL_ONLY" as const,
  recordVersion: 1,
  baseVersion: null,
  authority: "local_installation" as const,
  operation: "upsert" as const,
  contentHash: "sha256:" + "a".repeat(64),
  occurredAt: "2026-07-13T20:00:00.000Z",
};

describe("portable sync contracts", () => {
  it("creates and verifies a content-bound strict envelope", () => {
    const envelope = createSyncMessageEnvelope({
      protocolVersion: "1.0",
      canonicalization: "RFC8785",
      messageId: "30000000-0000-4000-8000-000000000001",
      sourceInstallationId: change.originInstallationId,
      destinationInstallationId: null,
      sequence: 1,
      change,
      issuedAt: "2026-07-13T20:00:01.000Z",
    });
    expect(parseSyncMessageEnvelope(envelope)).toEqual(envelope);
    expect(() => parseSyncMessageEnvelope({
      ...envelope,
      change: { ...envelope.change, recordVersion: 2 },
    })).toThrow("hash");
  });

  it("rejects arbitrary or secret-bearing payload fields at the contract boundary", () => {
    expect(() => portableChangeSchema.parse({
      ...change,
      payload: { password: "not-allowed" },
    })).toThrow();
    expect(() => portableChangeSchema.parse({
      ...change,
      baseVersion: 1,
    })).toThrow("Base version");
  });
});
