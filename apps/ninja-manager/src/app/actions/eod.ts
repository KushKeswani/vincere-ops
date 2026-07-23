"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import type { ActionState } from "@/app/actions/product";
import { isRuntimeObservationCaptureReady } from "@/components/eod/eod-snapshot-view-model";
import { requireUser } from "@/lib/auth/session";
import { requireDeploymentCapability } from "@/lib/deployment/server";
import { RuntimeServiceError } from "@/lib/domain/runtime-errors";
import { getEodSnapshotRepository } from "@/lib/repositories/eod-snapshot-repository";
import { getRuntimeRepository } from "@/lib/repositories/runtime-repository";

const captureRequestSchema = z.object({
  agentId: z.uuid(),
  requestId: z.uuid(),
}).strict();

function safeCaptureError(error: unknown): ActionState {
  if (error instanceof RuntimeServiceError) {
    if (error.code === "FORBIDDEN") {
      return { status: "error", message: "EOD evidence is private and available only in the local operator dashboard." };
    }
    if (error.code === "AGENT_NOT_FOUND") {
      return { status: "error", message: "The selected local installation is no longer available." };
    }
    if (error.code === "CONFLICT") {
      return { status: "error", message: "Fresh Runtime v2 evidence could not be captured. Refresh the runtime observation and try again." };
    }
  }
  return { status: "error", message: "The EOD snapshot could not be captured safely." };
}

export async function captureEodSnapshotAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser(["client"]);
  try {
    requireDeploymentCapability("transport.local");
  } catch {
    return { status: "error", message: "EOD capture is available only from the local operator dashboard." };
  }

  const agentIds = formData.getAll("agentId");
  const requestIds = formData.getAll("requestId");
  const hasUnexpectedField = Array.from(formData.keys()).some(
    (key) => key !== "agentId" && key !== "requestId" && !key.startsWith("$ACTION_"),
  );
  const parsed = captureRequestSchema.safeParse({
    agentId: agentIds[0],
    requestId: requestIds[0],
  });
  if (agentIds.length !== 1 || requestIds.length !== 1 || hasUnexpectedField || !parsed.success) {
    return { status: "error", message: "Choose an authorized local installation and try again." };
  }

  try {
    const latest = await getRuntimeRepository().getLatestRuntimeObservationV2(user, parsed.data.agentId);
    if (!isRuntimeObservationCaptureReady(latest)) {
      return { status: "error", message: "A fresh authenticated Runtime v2 observation is required before capture." };
    }
    const result = await getEodSnapshotRepository().captureManualSnapshot(user, {
      agentId: parsed.data.agentId,
      sourceEventId: latest.eventId,
      idempotencyKey: `eod:manual:${parsed.data.requestId}`,
    });

    try {
      revalidatePath("/client/activity");
    } catch {
      console.warn("EOD activity revalidation failed after a committed capture");
    }
    return {
      status: "success",
      message: result.duplicate
        ? "This exact EOD capture request was already completed; the original immutable snapshot was retained."
        : "EOD snapshot captured from fresh authenticated Runtime v2 evidence. No NinjaTrader operation was performed.",
    };
  } catch (error) {
    if (!(error instanceof RuntimeServiceError)) console.error("EOD snapshot action failed safely");
    return safeCaptureError(error);
  }
}
