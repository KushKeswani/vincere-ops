import { describe, expect, it } from "vitest";

import { recommendStrategy } from "./strategy-engine";

describe("recommendStrategy", () => {
  it("selects the controlled strategy for a new client", () => {
    const result = recommendStrategy({ objective: "consistent", experience: "new", drawdownComfort: "moderate", automationLevel: "guided", tradingWindow: "morning" }, 50_000);
    expect(result.strategySlug).toBe("vincere-steady");
    expect(result.configuration.contracts).toBe(1);
    expect(result.configuration.automationMode).toBe("approval-required");
    expect(result.configuration.killSwitchEnabled).toBe(true);
    expect(result.validation.valid).toBe(true);
  });

  it("allows measured scaling only for a larger experienced profile", () => {
    const result = recommendStrategy({ objective: "growth", experience: "advanced", drawdownComfort: "moderate", automationLevel: "assisted", tradingWindow: "afternoon" }, 150_000);
    expect(result.strategySlug).toBe("vincere-balanced");
    expect(result.configuration.contracts).toBe(2);
    expect(result.configuration.maxConcurrentAccounts).toBe(3);
    expect(result.configuration.session).toBe("US afternoon");
  });

  it("adds an explicit warning without promising returns", () => {
    const result = recommendStrategy({ objective: "growth", experience: "advanced", drawdownComfort: "higher", automationLevel: "assisted", tradingWindow: "flexible" }, 100_000);
    expect(result.validation.checks.some((check) => check.status === "warning")).toBe(true);
    expect(result.validation.checks.map((check) => check.message).join(" ")).not.toMatch(/guarantee|expected profit/i);
  });
});
