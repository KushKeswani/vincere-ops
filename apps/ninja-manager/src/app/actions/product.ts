"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";

import { requireUser } from "@/lib/auth/session";
import {
  createClientSchema,
  clientAccessSchema,
  deploymentSchema,
  incidentActionSchema,
  killSwitchSchema,
  onboardingSchema,
  requestIdSchema,
  reviewApprovalSchema,
  simulationSchema,
  tradingAccountSchema,
} from "@/lib/domain/schemas";
import {
  EmailIdentityConflictError,
  IdempotencyConflictError,
  getNinjaRepository,
} from "@/lib/repositories/ninja-repository";

export interface ActionState {
  status: "idle" | "error" | "success";
  message: string;
  values?: Record<string, string>;
  requestId?: string;
}

function firstIssue(
  error: { issues: Array<{ message: string }> },
  values?: Record<string, string>,
  requestId?: string,
): ActionState {
  return { status: "error", message: error.issues[0]?.message ?? "Check the form and try again.", values, requestId };
}

async function runAction(
  operation: () => Promise<string>,
  paths: string[],
  requestId: string,
  errorValues?: Record<string, string>,
): Promise<ActionState> {
  let message: string;
  try {
    message = await operation();
  } catch (error) {
    if (error instanceof IdempotencyConflictError) {
      return {
        status: "error",
        message: `Request conflict: ${error.message}. Review the form and submit again.`,
        values: errorValues,
        requestId: randomUUID(),
      };
    }
    if (error instanceof EmailIdentityConflictError) {
      return {
        status: "error",
        message: error.message,
        values: errorValues,
        requestId,
      };
    }
    console.error("Ninja Manager action failed safely");
    return {
      status: "error",
      message: "The operation could not be completed. Retry with the same request ID.",
      values: errorValues,
      requestId,
    };
  }

  for (const path of paths) {
    try {
      revalidatePath(path);
    } catch {
      console.warn("Ninja Manager cache revalidation failed after a committed operation", { path });
    }
  }
  return { status: "success", message, requestId: randomUUID() };
}

export async function createClientAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser(["staff"]);
  const values = {
    name: String(formData.get("name") ?? ""),
    email: String(formData.get("email") ?? ""),
    phone: String(formData.get("phone") ?? ""),
    timezone: String(formData.get("timezone") ?? "America/New_York"),
  };
  const requestId = requestIdSchema.safeParse(formData.get("requestId"));
  if (!requestId.success) return firstIssue(requestId.error, values);
  const parsed = createClientSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return firstIssue(parsed.error, values, requestId.data);
  return runAction(async () => {
    await getNinjaRepository().createClient(user, parsed.data, requestId.data);
    return "Client created. Share the temporary password through an approved secure channel.";
  }, ["/staff", "/staff/clients"], requestId.data, values);
}

export async function completeOnboardingAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser(["client"]);
  const requestId = requestIdSchema.safeParse(formData.get("requestId"));
  if (!requestId.success) return firstIssue(requestId.error);
  const parsed = onboardingSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return firstIssue(parsed.error, undefined, requestId.data);
  return runAction(async () => {
    await getNinjaRepository().completeOnboarding(user, parsed.data.phone, parsed.data.timezone, requestId.data);
    return "Onboarding profile completed.";
  }, ["/client", "/client/setup"], requestId.data);
}

export async function addAccountAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser(["client"]);
  const requestId = requestIdSchema.safeParse(formData.get("requestId"));
  if (!requestId.success) return firstIssue(requestId.error);
  const parsed = tradingAccountSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return firstIssue(parsed.error, undefined, requestId.data);
  return runAction(async () => {
    await getNinjaRepository().addAccountAndEnvironment(user, parsed.data, requestId.data);
    return "Account and environment registered. Only the final four account characters were retained.";
  }, ["/client", "/client/setup", "/client/strategy"], requestId.data);
}

export async function reviewApprovalAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser(["staff"]);
  const requestId = requestIdSchema.safeParse(formData.get("requestId"));
  if (!requestId.success) return firstIssue(requestId.error);
  const parsed = reviewApprovalSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return firstIssue(parsed.error, undefined, requestId.data);
  return runAction(async () => {
    await getNinjaRepository().reviewApproval(user, parsed.data.approvalId, parsed.data.decision, parsed.data.notes, requestId.data);
    return `Configuration ${parsed.data.decision}.`;
  }, ["/staff", "/staff/approvals", "/client/strategy"], requestId.data);
}

export async function recordDeploymentAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser(["client"]);
  const requestId = requestIdSchema.safeParse(formData.get("requestId"));
  if (!requestId.success) return firstIssue(requestId.error);
  const parsed = deploymentSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return firstIssue(parsed.error, undefined, requestId.data);
  return runAction(async () => {
    await getNinjaRepository().recordDeployment(user, parsed.data.configurationId, requestId.data);
    return "Deployment status recorded. Ninja Manager did not place or execute any trade.";
  }, ["/client", "/client/strategy"], requestId.data);
}

export async function simulateHealthFailureAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser(["staff", "client"]);
  const requestId = requestIdSchema.safeParse(formData.get("requestId"));
  if (!requestId.success) return firstIssue(requestId.error);
  const rawClientId = String(formData.get("clientId") ?? "").trim();
  const parsed = simulationSchema.safeParse({ clientId: rawClientId || undefined });
  if (!parsed.success) return firstIssue(parsed.error, undefined, requestId.data);
  if (user.role === "client" && parsed.data.clientId) return { status: "error", message: "Clients cannot simulate another client's environment.", requestId: requestId.data };
  return runAction(async () => {
    await getNinjaRepository().simulateHealthFailure(user, parsed.data.clientId, requestId.data);
    return "Safe offline simulation created an incident. No live client system was changed.";
  }, ["/client", "/client/activity", "/staff", "/staff/incidents"], requestId.data);
}

export async function updateIncidentAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser(["staff"]);
  const requestId = requestIdSchema.safeParse(formData.get("requestId"));
  if (!requestId.success) return firstIssue(requestId.error);
  const parsed = incidentActionSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return firstIssue(parsed.error, undefined, requestId.data);
  return runAction(async () => {
    await getNinjaRepository().updateIncident(user, parsed.data.incidentId, parsed.data.action, requestId.data);
    return parsed.data.action === "resolve" ? "Incident resolved." : "Resolution workflow advanced.";
  }, ["/staff", "/staff/incidents", "/client/activity"], requestId.data);
}

export async function setKillSwitchAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser(["staff"]);
  const requestId = requestIdSchema.safeParse(formData.get("requestId"));
  if (!requestId.success) return firstIssue(requestId.error);
  const parsed = killSwitchSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return firstIssue(parsed.error, undefined, requestId.data);
  const enabled = parsed.data.enabled === "true";
  return runAction(async () => {
    await getNinjaRepository().setKillSwitch(user, enabled, requestId.data);
    return enabled ? "Global operational kill switch enabled." : "Global operational kill switch disabled.";
  }, ["/staff", "/client"], requestId.data);
}

export async function setClientAccessAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser(["staff"]);
  const requestId = requestIdSchema.safeParse(formData.get("requestId"));
  if (!requestId.success) return firstIssue(requestId.error);
  const parsed = clientAccessSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return firstIssue(parsed.error, undefined, requestId.data);
  const enabled = parsed.data.enabled === "true";
  return runAction(async () => {
    await getNinjaRepository().setClientAccess(user, parsed.data.clientId, enabled, requestId.data);
    return enabled ? "Client access enabled." : "Client access disabled and active sessions will no longer authorize future requests.";
  }, ["/staff", "/staff/clients"], requestId.data);
}
