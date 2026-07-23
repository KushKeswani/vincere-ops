"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import type { ActionState } from "@/app/actions/product";
import {
  evaluateProcessControlPreflight,
  expectedProcessConfirmation,
} from "@/components/process-control/process-control-view-model";
import { requireUser } from "@/lib/auth/session";
import { requireDeploymentCapability } from "@/lib/deployment/server";
import { RuntimeServiceError } from "@/lib/domain/runtime-errors";
import { getProcessControlRepository } from "@/lib/repositories/process-control-repository";
import { getRuntimeRepository } from "@/lib/repositories/runtime-repository";

const requestSchema = z.object({
  agentId: z.uuid(),
  requestId: z.uuid(),
  commandType: z.enum(["LAUNCH_NINJATRADER", "REQUEST_NINJATRADER_QUIT"]),
  confirmation: z.string(),
}).strict();

function safeProcessError(error: unknown): ActionState {
  if (error instanceof RuntimeServiceError) {
    if (error.code === "AGENT_NOT_FOUND") {
      return { status: "error", message: "The selected local installation is no longer available." };
    }
    if (error.code === "CONFLICT" || error.code === "COMMAND_EXPIRED") {
      return { status: "error", message: "Process evidence changed before the request could be queued. Refresh and confirm again." };
    }
    if (error.code === "FORBIDDEN" || error.code === "UNAUTHORIZED") {
      return { status: "error", message: "This local operator is not authorized for process control." };
    }
  }
  return { status: "error", message: "The process request could not be queued safely." };
}

function duplicateSuccess(commandType: "LAUNCH_NINJATRADER" | "REQUEST_NINJATRADER_QUIT"): ActionState {
  return {
    status: "success",
    message: commandType === "LAUNCH_NINJATRADER"
      ? "This exact launch request was already recorded; the original durable command was retained."
      : "This exact graceful-quit request was already recorded; the original durable command was retained.",
  };
}

export async function queueProcessControlAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser(["client"]);
  if (user.role !== "client") {
    return { status: "error", message: "Process control is available only to the local client operator." };
  }
  try {
    requireDeploymentCapability("transport.local");
    requireDeploymentCapability("runtime.queue");
  } catch {
    return { status: "error", message: "Process control is unavailable outside the LOCAL_ONLY dashboard." };
  }

  const allowedFields = ["agentId", "requestId", "commandType", "confirmation"] as const;
  const hasUnexpectedField = Array.from(formData.keys()).some(
    (key) => !allowedFields.includes(key as (typeof allowedFields)[number]) && !key.startsWith("$ACTION_"),
  );
  const values = Object.fromEntries(allowedFields.map((field) => [field, formData.getAll(field)])) as Record<
    (typeof allowedFields)[number],
    FormDataEntryValue[]
  >;
  const parsed = requestSchema.safeParse(Object.fromEntries(
    allowedFields.map((field) => [field, values[field][0]]),
  ));
  if (hasUnexpectedField || allowedFields.some((field) => values[field].length !== 1) || !parsed.success) {
    return { status: "error", message: "Submit one exact local process request and try again." };
  }
  if (parsed.data.confirmation !== expectedProcessConfirmation(parsed.data.commandType)) {
    return {
      status: "error",
      message: `Type ${expectedProcessConfirmation(parsed.data.commandType)} exactly to confirm this one request.`,
    };
  }

  const runtimeRepository = getRuntimeRepository();
  const processRepository = getProcessControlRepository();
  const idempotencyKey = [
    "local-process-control",
    parsed.data.commandType,
    parsed.data.agentId,
    parsed.data.requestId,
  ].join(":");

  try {
    const agents = await runtimeRepository.listAgents(user);
    const agent = agents.find((candidate) => candidate.id === parsed.data.agentId) ?? null;
    if (!agent) return { status: "error", message: "The selected local installation is not authorized." };
    if (!agent.capabilities.includes("process.control")) {
      return { status: "error", message: "The selected companion has not enrolled the process.control capability." };
    }

    const existing = await processRepository.findCommandByIdempotency(user, {
      agentId: agent.id,
      idempotencyKey,
      commandType: parsed.data.commandType,
    });
    if (existing) return duplicateSuccess(parsed.data.commandType);

    const [latestRuntime, commandCounts] = await Promise.all([
      runtimeRepository.getLatestRuntimeObservationV2(user, agent.id),
      processRepository.getCommandSafetyCounts(user, agent.id),
    ]);
    const preflight = evaluateProcessControlPreflight({ agent, latestRuntime, commandCounts });
    const gate = parsed.data.commandType === "LAUNCH_NINJATRADER" ? preflight.launch : preflight.quit;
    if (!gate.ready || !gate.approvalInput || gate.approvalInput.commandType !== parsed.data.commandType) {
      return { status: "error", message: gate.reason };
    }

    const approval = await processRepository.createApproval(user, gate.approvalInput);
    const queued = await processRepository.enqueueApprovedCommand(user, {
      agentId: agent.id,
      approvalId: approval.approvalId,
      idempotencyKey,
    });
    try {
      revalidatePath("/client");
    } catch {
      console.warn("Client dashboard revalidation failed after a committed process request");
    }
    if (queued.duplicate) return duplicateSuccess(parsed.data.commandType);
    return {
      status: "success",
      message: parsed.data.commandType === "LAUNCH_NINJATRADER"
        ? "Launch request queued through the durable companion. No direct operating-system call was made by the dashboard."
        : "Graceful-quit request queued through the durable companion. Force-kill, order, position, and strategy actions remain unavailable.",
    };
  } catch (error) {
    // A concurrent retry can win after our first idempotency read. Preserve the
    // original request result instead of creating another command.
    if (error instanceof RuntimeServiceError && error.code === "CONFLICT") {
      try {
        const existing = await processRepository.findCommandByIdempotency(user, {
          agentId: parsed.data.agentId,
          idempotencyKey,
          commandType: parsed.data.commandType,
        });
        if (existing) return duplicateSuccess(parsed.data.commandType);
      } catch {
        // Fall through to the non-sensitive error below.
      }
    }
    if (!(error instanceof RuntimeServiceError)) console.error("Process control action failed safely");
    return safeProcessError(error);
  }
}
