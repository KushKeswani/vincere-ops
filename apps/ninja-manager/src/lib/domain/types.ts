export type UserRole = "staff" | "client";
export type HealthStatus = "healthy" | "degraded" | "offline";
export type ConfigurationStatus =
  | "draft"
  | "pending_approval"
  | "approved"
  | "deployment_recorded"
  | "rolled_back"
  | "rejected";

export interface AuthenticatedUser {
  id: string;
  organizationId: string;
  email: string;
  name: string;
  role: UserRole;
}

export interface StrategyQuestionnaire {
  objective: "preserve" | "consistent" | "growth";
  experience: "new" | "intermediate" | "advanced";
  drawdownComfort: "low" | "moderate" | "higher";
  automationLevel: "guided" | "assisted";
  tradingWindow: "morning" | "afternoon" | "flexible";
}

export interface GeneratedStrategyConfiguration {
  contracts: number;
  dailyLossLimit: number;
  maxConcurrentAccounts: number;
  session: string;
  automationMode: "approval-required";
  killSwitchEnabled: boolean;
}

export interface ValidationResult {
  valid: boolean;
  checks: Array<{ key: string; status: "pass" | "warning"; message: string }>;
}

export interface ConnectorHealthResult {
  connector: "ninjatrader" | "vps" | "discord" | "ghl" | "n8n";
  status: HealthStatus;
  summary: string;
  details: Record<string, string | number | boolean>;
}
