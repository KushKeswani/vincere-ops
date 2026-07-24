import { describe, expect, it } from "vitest";

import {
  clientAccessSchema, createClientSchema, deploymentSchema, incidentActionSchema, killSwitchSchema, onboardingSchema,
  reviewApprovalSchema, signInSchema, simulationSchema, tradingAccountSchema,
} from "./schemas";

describe("inbound data contracts", () => {
  it("normalizes valid identity and client inputs", () => {
    expect(signInSchema.parse({ email: " TEST@Example.com ", password: "LongPassword!1" }).email).toBe("test@example.com");
    expect(createClientSchema.parse({ name: "Jamie", email: "jamie@example.com", temporaryPassword: "StrongPassword!1", timezone: "America/New_York" }).timezone).toBe("America/New_York");
  });

  it("requires explicit risk acknowledgement and complete environment data", () => {
    expect(onboardingSchema.safeParse({ phone: "5550101234", timezone: "America/New_York", riskAcknowledged: "off" }).success).toBe(false);
    const account = tradingAccountSchema.parse({ provider: "Apex", label: "Primary", accountIdentifier: "ABC1234", accountSize: "50000", ruleProfile: "Trailing", vpsProvider: "Vultr", vpsRegion: "NJ", ninjaVersion: "8.1" });
    expect(account.accountSize).toBe(50_000);
  });

  it("accepts only defined strategy, approval, incident, and safety actions", () => {
    const uuid = "10000000-0000-4000-8000-000000000001";
    expect(reviewApprovalSchema.parse({ approvalId: uuid, decision: "approved" }).decision).toBe("approved");
    expect(incidentActionSchema.parse({ incidentId: uuid, action: "resolve" }).action).toBe("resolve");
    expect(deploymentSchema.parse({ configurationId: uuid }).configurationId).toBe(uuid);
    expect(simulationSchema.parse({ clientId: uuid }).clientId).toBe(uuid);
    expect(killSwitchSchema.parse({ enabled: "true" }).enabled).toBe("true");
    expect(killSwitchSchema.safeParse({ enabled: "maybe" }).success).toBe(false);
    expect(clientAccessSchema.parse({ clientId: uuid, enabled: "false" }).enabled).toBe("false");
  });
});
