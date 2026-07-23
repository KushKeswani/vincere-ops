"use client";

import { useActionState } from "react";

import { setClientAccessAction } from "@/app/actions/product";
import { initialActionState } from "@/lib/action-state";
import { ActionMessage } from "@/components/action-message";

interface ClientAccessFormProps { clientId: string; enabled: boolean; requestId: string }

export function ClientAccessForm({ clientId, enabled, requestId }: ClientAccessFormProps) {
  const [state, action, pending] = useActionState(setClientAccessAction, initialActionState);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="requestId" value={state.requestId ?? requestId} />
      <input type="hidden" name="clientId" value={clientId} />
      <input type="hidden" name="enabled" value={String(!enabled)} />
      <ActionMessage state={state} />
      <button disabled={pending} type="submit" className="text-sm font-medium text-primary hover:underline">
        {pending ? "Working…" : enabled ? "Disable access" : "Enable access"}
      </button>
    </form>
  );
}
