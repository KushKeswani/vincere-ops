import { z } from "zod";

import { authorityWriterSchema, deploymentModeSchema } from "@/lib/deployment/contracts";
import { hashCanonicalPayload } from "@/lib/domain/runtime-contracts";

export const SYNC_PROTOCOL_VERSION = "1.0" as const;
export const SYNC_CANONICALIZATION = "RFC8785" as const;

export const portableRecordTypeSchema = z.enum([
  "assignment",
  "audit_evidence",
  "client",
  "operational_case",
  "runtime_observation",
]);
export type PortableRecordType = z.infer<typeof portableRecordTypeSchema>;

const hashSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const positiveSafeInteger = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const nonnegativeSafeInteger = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);

export const portableChangeSchema = z.object({
  recordType: portableRecordTypeSchema,
  recordId: z.uuid(),
  originInstallationId: z.uuid(),
  originMode: deploymentModeSchema,
  recordVersion: positiveSafeInteger,
  baseVersion: nonnegativeSafeInteger.nullable(),
  authority: authorityWriterSchema,
  operation: z.enum(["upsert", "tombstone"]),
  contentHash: hashSchema,
  occurredAt: z.iso.datetime({ offset: true }),
}).strict().superRefine((change, context) => {
  if (change.baseVersion !== null && change.baseVersion >= change.recordVersion) {
    context.addIssue({
      code: "custom",
      path: ["baseVersion"],
      message: "Base version must precede the record version",
    });
  }
});
export type PortableChange = z.infer<typeof portableChangeSchema>;

export const syncMessageUnsignedSchema = z.object({
  protocolVersion: z.literal(SYNC_PROTOCOL_VERSION),
  canonicalization: z.literal(SYNC_CANONICALIZATION),
  messageId: z.uuid(),
  sourceInstallationId: z.uuid(),
  destinationInstallationId: z.uuid().nullable(),
  sequence: positiveSafeInteger,
  change: portableChangeSchema,
  issuedAt: z.iso.datetime({ offset: true }),
}).strict();

export const syncMessageEnvelopeSchema = syncMessageUnsignedSchema.extend({
  envelopeHash: hashSchema,
}).strict();
export type SyncMessageEnvelope = z.infer<typeof syncMessageEnvelopeSchema>;

export function createSyncMessageEnvelope(
  input: z.input<typeof syncMessageUnsignedSchema>,
): SyncMessageEnvelope {
  const unsigned = syncMessageUnsignedSchema.parse(input);
  return syncMessageEnvelopeSchema.parse({
    ...unsigned,
    envelopeHash: hashCanonicalPayload(unsigned),
  });
}

export function parseSyncMessageEnvelope(input: unknown): SyncMessageEnvelope {
  const envelope = syncMessageEnvelopeSchema.parse(input);
  const { envelopeHash, ...unsigned } = envelope;
  if (hashCanonicalPayload(unsigned) !== envelopeHash) {
    throw new Error("Sync message envelope hash does not match its contents");
  }
  return envelope;
}
