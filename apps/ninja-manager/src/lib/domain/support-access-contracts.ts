import { z } from "zod";

import { hashCanonicalPayload } from "./canonical-json";

export const SUPPORT_ACCESS_VERSION = "support-access/1.0" as const;
export const SUPPORT_OTP_DIGITS = 8;
export const SUPPORT_OTP_TTL_MS = 10 * 60 * 1000;
export const SUPPORT_OTP_MAX_FAILED_ATTEMPTS = 5;
export const SUPPORT_CREATE_WINDOW_MS = 15 * 60 * 1000;
export const SUPPORT_CREATE_LIMIT = 5;
export const SUPPORT_STAFF_ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
export const SUPPORT_STAFF_ATTEMPT_LIMIT = 20;

const idempotencyKeySchema = z.string().regex(/^[A-Za-z0-9:._-]{16,200}$/);
const opaqueAccountRefSchema = z.string().regex(/^acct_[a-z0-9]{16,64}$/);
const bearerSecretSchema = z.string().regex(/^[A-Za-z0-9_-]{43,128}$/);

export const supportAccessScopeSchema = z.enum([
  "runtime.read",
  "eod.read",
  "health.read",
]);
export type SupportAccessScope = z.infer<typeof supportAccessScopeSchema>;

const sortedUniqueScopesSchema = z.array(supportAccessScopeSchema).min(1).max(3).refine(
  (values) => values.every((value, index) => index === 0 || values[index - 1] < value),
  "Support scopes must be unique and sorted",
);

const sortedUniqueAccountRefsSchema = z.array(opaqueAccountRefSchema).max(100).refine(
  (values) => values.every((value, index) => index === 0 || values[index - 1] < value),
  "Account references must be unique and sorted",
);

export const supportAccessTargetSchema = z.object({
  agentId: z.uuid(),
  accountRefs: sortedUniqueAccountRefsSchema.default([]),
}).strict();
export type SupportAccessTarget = z.infer<typeof supportAccessTargetSchema>;

export const createSupportChallengeInputSchema = z.object({
  scopes: sortedUniqueScopesSchema,
  targets: z.array(supportAccessTargetSchema).min(1).max(32).refine(
    (values) => values.every((value, index) => index === 0 || values[index - 1].agentId < value.agentId),
    "Support targets must use unique, sorted agent IDs",
  ).refine(
    (values) => values.reduce((total, target) => total + target.accountRefs.length, 0) <= 200,
    "A support challenge may target at most 200 accounts",
  ),
  requestedSessionMinutes: z.number().int().min(5).max(60),
  idempotencyKey: idempotencyKeySchema,
}).strict();
export type CreateSupportChallengeInput = z.infer<typeof createSupportChallengeInputSchema>;

export const redeemSupportChallengeInputSchema = z.object({
  tenantId: z.uuid(),
  challengeId: z.uuid(),
  otp: z.string().regex(/^\d{8}$/),
  idempotencyKey: idempotencyKeySchema,
}).strict();
export type RedeemSupportChallengeInput = z.infer<typeof redeemSupportChallengeInputSchema>;

export const validateSupportGrantInputSchema = z.object({
  tenantId: z.uuid(),
  bearerSecret: bearerSecretSchema,
  scope: supportAccessScopeSchema,
  agentId: z.uuid(),
  accountRef: opaqueAccountRefSchema.optional(),
}).strict();
export type ValidateSupportGrantInput = z.infer<typeof validateSupportGrantInputSchema>;

export const revokeSupportAccessInputSchema = z.discriminatedUnion("targetType", [
  z.object({
    targetType: z.literal("challenge"),
    challengeId: z.uuid(),
    idempotencyKey: idempotencyKeySchema,
  }).strict(),
  z.object({
    targetType: z.literal("session"),
    sessionId: z.uuid(),
    idempotencyKey: idempotencyKeySchema,
  }).strict(),
  z.object({
    targetType: z.literal("tenant_sessions"),
    idempotencyKey: idempotencyKeySchema,
  }).strict(),
]);
export type RevokeSupportAccessInput = z.infer<typeof revokeSupportAccessInputSchema>;

export interface CreatedSupportChallenge {
  readonly challengeId: string;
  readonly scopes: readonly SupportAccessScope[];
  readonly agentCount: number;
  readonly accountCount: number;
  readonly requestedSessionMinutes: number;
  readonly createdAt: string;
  readonly expiresAt: string;
  /** Present exactly once. An idempotent replay returns null. */
  readonly otp: string | null;
  readonly duplicate: boolean;
}

export interface RedeemedSupportGrant {
  readonly sessionId: string;
  readonly challengeId: string;
  readonly scopes: readonly SupportAccessScope[];
  readonly agentCount: number;
  readonly accountCount: number;
  readonly staffUserId: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
  /** Present exactly once. An idempotent replay returns null. */
  readonly bearerSecret: string | null;
  readonly duplicate: boolean;
}

export interface ValidatedSupportGrant {
  readonly sessionId: string;
  readonly challengeId: string;
  readonly tenantId: string;
  readonly staffUserId: string;
  readonly scope: SupportAccessScope;
  readonly agentId: string;
  readonly accountRestricted: boolean;
  readonly expiresAt: string;
}

export function supportChallengeRequestHash(input: CreateSupportChallengeInput): string {
  return hashCanonicalPayload({
    protocolVersion: SUPPORT_ACCESS_VERSION,
    requestedSessionMinutes: input.requestedSessionMinutes,
    scopes: input.scopes,
    targets: input.targets,
  });
}

export function supportRedemptionRequestHash(input: RedeemSupportChallengeInput): string {
  return hashCanonicalPayload({
    protocolVersion: SUPPORT_ACCESS_VERSION,
    challengeId: input.challengeId,
    tenantId: input.tenantId,
  });
}

export function supportRevocationRequestHash(input: RevokeSupportAccessInput): string {
  return hashCanonicalPayload({
    protocolVersion: SUPPORT_ACCESS_VERSION,
    targetType: input.targetType,
    targetId: input.targetType === "challenge"
      ? input.challengeId
      : input.targetType === "session"
        ? input.sessionId
        : null,
  });
}
