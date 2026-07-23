"use client";

import { useActionState } from "react";

import { simulateHealthFailureAction } from "@/app/actions/product";
import { initialActionState } from "@/lib/action-state";
import { ActionMessage } from "@/components/action-message";
import { SubmitButton } from "@/components/submit-button";

interface SimulationFormProps { clientId?: string; requestId: string }

export function SimulationForm({ clientId, requestId }: SimulationFormProps) {
  const [state, action] = useActionState(simulateHealthFailureAction, initialActionState);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="requestId" value={state.requestId ?? requestId} />
      {clientId && <input type="hidden" name="clientId" value={clientId} />}
      <ActionMessage state={state} />
      <SubmitButton variant="outline">Simulate VPS failure</SubmitButton>
    </form>
  );
}
