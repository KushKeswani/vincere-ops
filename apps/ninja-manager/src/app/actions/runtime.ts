"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import type { ActionState } from "@/app/actions/product";
import { requireUser } from "@/lib/auth/session";
import { requireDeploymentCapability } from "@/lib/deployment/server";
import {
  RUNTIME_PROTOCOL_VERSION,
  readOnlyCommandEnvelopeSchema,
} from "@/lib/domain/runtime-contracts";
import { RuntimeServiceError } from "@/lib/domain/runtime-errors";
import { getRuntimeRepository } from "@/lib/repositories/runtime-repository";

const discoveryRequestSchema = z.object({
  agentId: z.uuid(),
  requestId: z.uuid(),
  expectedStateVersion: z.union([
    z.string().regex(/^sha256:[a-f0-9]{64}$/),
    z.literal(""),
  ]),
}).strict();

export async function queueRuntimeDiscoveryAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser(["staff", "client"]);
  const localOperator = user.role === "client";
  try {
    requireDeploymentCapability(localOperator ? "transport.local" : "fleet.runtime");
    requireDeploymentCapability("runtime.queue");
  } catch {
    return { status: "error", message: "Read-only runtime discovery is unavailable in this deployment mode." };
  }
  const parsed = discoveryRequestSchema.safeParse({
    agentId: formData.get("agentId"),
    requestId: formData.get("requestId"),
    expectedStateVersion: formData.get("expectedStateVersion"),
  });
  if (!parsed.success) {
    return {
      status: "error",
      message: parsed.error.issues[0]?.message ?? "Check the discovery request and try again.",
    };
  }

  const issuedAt = new Date();
  const expectedStateVersion = parsed.data.expectedStateVersion || null;
  const command = readOnlyCommandEnvelopeSchema.parse({
    protocolVersion: RUNTIME_PROTOCOL_VERSION,
    commandId: randomUUID(),
    correlationId: randomUUID(),
    agentId: parsed.data.agentId,
    idempotencyKey: (localOperator ? "local" : "staff") + "-runtime-refresh:" + parsed.data.agentId + ":" + parsed.data.requestId,
    commandType: "DISCOVER_RUNTIME_STATE",
    issuedAt: issuedAt.toISOString(),
    expiresAt: new Date(issuedAt.getTime() + 2 * 60 * 1000).toISOString(),
    expectedStateVersion,
    approvalId: null,
    dryRun: true,
    payload: {
      include: ["accounts", "strategies"],
      forceFullSnapshot: true,
      reasonCode: "STAFF_RUNTIME_REFRESH",
    },
  });

  let result: Awaited<ReturnType<ReturnType<typeof getRuntimeRepository>["enqueueReadOnlyCommand"]>>;
  try {
    result = await getRuntimeRepository().enqueueReadOnlyCommand(user, command);
  } catch (error) {
    if (error instanceof RuntimeServiceError) {
      return { status: "error", message: error.message };
    }
    console.error("Runtime discovery action failed");
    return { status: "error", message: "The read-only discovery request could not be queued." };
  }

  const refreshPath = localOperator ? "/client" : "/staff/runtime";
  try {
    revalidatePath(refreshPath);
  } catch {
    console.warn("Runtime cache revalidation failed after a committed queue operation", { path: refreshPath });
  }
  return {
    status: "success",
    message: result.duplicate
      ? "This exact read-only discovery request was already queued; the original command was retained."
      : "Read-only discovery queued. No strategy, order, account, or NinjaTrader setting was changed.",
  };
}
