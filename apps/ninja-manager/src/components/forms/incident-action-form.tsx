"use client";

import { useActionState } from "react";

import { updateIncidentAction } from "@/app/actions/product";
import { initialActionState } from "@/lib/action-state";
import { ActionMessage } from "@/components/action-message";

interface IncidentActionFormProps { incidentId: string; canAdvance: boolean; requestId: string }

export function IncidentActionForm({ incidentId, canAdvance, requestId }: IncidentActionFormProps) {
  const [state, action, pending] = useActionState(updateIncidentAction, initialActionState);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="requestId" value={state.requestId ?? requestId} />
      <input type="hidden" name="incidentId" value={incidentId} />
      <ActionMessage state={state} />
      <div className="flex gap-2">
        {canAdvance && <button disabled={pending} type="submit" name="action" value="advance" className="inline-flex h-9 items-center rounded-md border px-4 text-sm font-medium hover:bg-accent">Next step</button>}
        <button disabled={pending} type="submit" name="action" value="resolve" className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90">Resolve</button>
      </div>
    </form>
  );
}
