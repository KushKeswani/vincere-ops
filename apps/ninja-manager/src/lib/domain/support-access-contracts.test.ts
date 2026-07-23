import { describe, expect, it } from "vitest";

import {
  createSupportChallengeInputSchema,
  redeemSupportChallengeInputSchema,
  revokeSupportAccessInputSchema,
  supportChallengeRequestHash,
  supportRedemptionRequestHash,
  validateSupportGrantInputSchema,
} from "./support-access-contracts";

const tenantId = "10000000-0000-4000-8000-000000000001";
const agentId = "30000000-0000-4000-8000-000000000001";
const accountRef = `acct_${"a".repeat(32)}`;

function challengeInput() {
  return {
    scopes: ["eod.read", "runtime.read"] as Array<"eod.read" | "runtime.read">,
    targets: [{ agentId, accountRefs: [accountRef] }],
    requestedSessionMinutes: 30,
    idempotencyKey: "support:create:0001",
  };
}

describe("support access contracts", () => {
  it("accepts only the three bounded read scopes and exact sorted targets", () => {
    expect(createSupportChallengeInputSchema.parse(challengeInput())).toEqual(challengeInput());
    for (const scope of ["process.control", "strategy.enable", "connection.reconnect", "orders.read", "*"]) {
      expect(() => createSupportChallengeInputSchema.parse({
        ...challengeInput(),
        scopes: [scope],
      })).toThrow();
    }
    expect(() => createSupportChallengeInputSchema.parse({
      ...challengeInput(),
      targets: [{ agentId: "*", accountRefs: [] }],
    })).toThrow();
  });

  it("requires unique sorted scopes, agents, and account references", () => {
    expect(() => createSupportChallengeInputSchema.parse({
      ...challengeInput(),
      scopes: ["runtime.read", "eod.read"],
    })).toThrow();
    expect(() => createSupportChallengeInputSchema.parse({
      ...challengeInput(),
      targets: [challengeInput().targets[0], challengeInput().targets[0]],
    })).toThrow();
    expect(() => createSupportChallengeInputSchema.parse({
      ...challengeInput(),
      targets: [{ agentId, accountRefs: [accountRef, accountRef] }],
    })).toThrow();
  });

  it("bounds session duration and OTP format", () => {
    expect(() => createSupportChallengeInputSchema.parse({
      ...challengeInput(),
      requestedSessionMinutes: 4,
    })).toThrow();
    expect(() => createSupportChallengeInputSchema.parse({
      ...challengeInput(),
      requestedSessionMinutes: 61,
    })).toThrow();
    expect(redeemSupportChallengeInputSchema.parse({
      tenantId,
      challengeId: "50000000-0000-4000-8000-000000000001",
      otp: "01234567",
      idempotencyKey: "support:redeem:0001",
    }).otp).toBe("01234567");
    expect(() => redeemSupportChallengeInputSchema.parse({
      tenantId,
      challengeId: "50000000-0000-4000-8000-000000000001",
      otp: "1234567",
      idempotencyKey: "support:redeem:0001",
    })).toThrow();
  });

  it("requires exact tenant, scope, agent, token, and optional opaque account target", () => {
    const value = {
      tenantId,
      bearerSecret: "x".repeat(43),
      scope: "runtime.read" as const,
      agentId,
      accountRef,
    };
    expect(validateSupportGrantInputSchema.parse(value)).toEqual(value);
    expect(() => validateSupportGrantInputSchema.parse({ ...value, accountRef: "account-1234" })).toThrow();
    expect(() => validateSupportGrantInputSchema.parse({ ...value, bearerSecret: "short" })).toThrow();
  });

  it("defines client revocation targets without a staff grant or extension operation", () => {
    expect(revokeSupportAccessInputSchema.parse({
      targetType: "tenant_sessions",
      idempotencyKey: "support:revoke:0001",
    })).toEqual({ targetType: "tenant_sessions", idempotencyKey: "support:revoke:0001" });
    expect(() => revokeSupportAccessInputSchema.parse({
      targetType: "extend",
      sessionId: "50000000-0000-4000-8000-000000000001",
      idempotencyKey: "support:extend:0001",
    })).toThrow();
  });

  it("hashes challenge semantics and never includes OTP material in redemption hashes", () => {
    expect(supportChallengeRequestHash(challengeInput())).toMatch(/^sha256:[a-f0-9]{64}$/);
    const first = supportRedemptionRequestHash({
      tenantId,
      challengeId: "50000000-0000-4000-8000-000000000001",
      otp: "00000001",
      idempotencyKey: "support:redeem:0001",
    });
    const second = supportRedemptionRequestHash({
      tenantId,
      challengeId: "50000000-0000-4000-8000-000000000001",
      otp: "99999999",
      idempotencyKey: "support:redeem:0002",
    });
    expect(first).toBe(second);
  });
});
