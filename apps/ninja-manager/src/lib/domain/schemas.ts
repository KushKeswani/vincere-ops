import { z } from "zod";

export const requestIdSchema = z.string().uuid("A valid request ID is required");

export const signInSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email("Enter a valid email address")),
  password: z.string().min(10, "Password must be at least 10 characters"),
});

export const createClientSchema = z.object({
  name: z.string().trim().min(2).max(100),
  email: z.string().trim().toLowerCase().pipe(z.email()),
  temporaryPassword: z.string().min(12).max(100)
    .regex(/[A-Z]/, "Include an uppercase letter")
    .regex(/[a-z]/, "Include a lowercase letter")
    .regex(/[0-9]/, "Include a number")
    .regex(/[^A-Za-z0-9]/, "Include a symbol"),
  phone: z.string().trim().max(30).optional(),
  timezone: z.string().trim().min(3).max(80).default("America/New_York"),
});

export const onboardingSchema = z.object({
  phone: z.string().trim().min(7).max(30),
  timezone: z.string().trim().min(3).max(80),
  riskAcknowledged: z.literal("on", {
    error: "You must acknowledge the operational and trading risks",
  }),
});

export const tradingAccountSchema = z.object({
  provider: z.string().trim().min(2).max(80),
  label: z.string().trim().min(2).max(80),
  accountIdentifier: z.string().trim().min(4).max(100),
  accountSize: z.coerce.number().int().min(1000).max(10_000_000),
  ruleProfile: z.string().trim().min(2).max(120),
  vpsProvider: z.string().trim().min(2).max(80),
  vpsRegion: z.string().trim().min(2).max(80),
  ninjaVersion: z.string().trim().min(2).max(40),
});

export const questionnaireSchema = z.object({
  objective: z.enum(["preserve", "consistent", "growth"]),
  experience: z.enum(["new", "intermediate", "advanced"]),
  drawdownComfort: z.enum(["low", "moderate", "higher"]),
  automationLevel: z.enum(["guided", "assisted"]),
  tradingWindow: z.enum(["morning", "afternoon", "flexible"]),
});

export const reviewApprovalSchema = z.object({
  approvalId: z.string().uuid(),
  decision: z.enum(["approved", "rejected"]),
  notes: z.string().trim().max(500).optional(),
});

export const incidentActionSchema = z.object({
  incidentId: z.string().uuid(),
  action: z.enum(["advance", "resolve"]),
});

export const deploymentSchema = z.object({ configurationId: z.string().uuid() });

export const simulationSchema = z.object({ clientId: z.string().uuid().optional() });

export const killSwitchSchema = z.object({ enabled: z.enum(["true", "false"]) });

export const clientAccessSchema = z.object({
  clientId: z.string().uuid(),
  enabled: z.enum(["true", "false"]),
});
