import type {
  GeneratedStrategyConfiguration,
  StrategyQuestionnaire,
  ValidationResult,
} from "./types";

export interface StrategyRecommendation {
  strategySlug: string;
  explanation: string;
  configuration: GeneratedStrategyConfiguration;
  validation: ValidationResult;
}

export function recommendStrategy(
  questionnaire: StrategyQuestionnaire,
  accountSize: number,
): StrategyRecommendation {
  const conservative =
    questionnaire.objective === "preserve" ||
    questionnaire.drawdownComfort === "low" ||
    questionnaire.experience === "new";
  const strategySlug = conservative ? "vincere-steady" : "vincere-balanced";
  const contracts = accountSize >= 100_000 && !conservative ? 2 : 1;
  const dailyLossLimit = Math.round(accountSize * (conservative ? 0.005 : 0.008));
  const configuration: GeneratedStrategyConfiguration = {
    contracts,
    dailyLossLimit,
    maxConcurrentAccounts: questionnaire.experience === "advanced" ? 3 : 1,
    session: questionnaire.tradingWindow === "afternoon" ? "US afternoon" : "US morning",
    automationMode: "approval-required",
    killSwitchEnabled: true,
  };
  const checks: ValidationResult["checks"] = [
    { key: "account-size", status: "pass", message: `Configuration is sized against the $${accountSize.toLocaleString()} account.` },
    { key: "approval-gate", status: "pass", message: "Deployment cannot be recorded until a staff member approves this version." },
    { key: "kill-switch", status: "pass", message: "The configuration includes an enabled operational kill switch." },
  ];
  if (questionnaire.drawdownComfort === "higher") {
    checks.push({ key: "risk-review", status: "warning", message: "Higher drawdown comfort still requires staff review and does not imply expected returns." });
  }
  return {
    strategySlug,
    explanation: conservative
      ? "Vincere Steady emphasizes simpler operation, one-contract sizing, and tighter daily limits while you build confidence."
      : "Vincere Balanced fits an experienced client seeking consistent operation with measured capacity for growth.",
    configuration,
    validation: { valid: true, checks },
  };
}
