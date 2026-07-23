"use client";

import { useActionState } from "react";

import { recordDeploymentAction } from "@/app/actions/product";
import { initialActionState } from "@/lib/action-state";
import { ActionMessage } from "@/components/action-message";
import { SubmitButton } from "@/components/submit-button";

interface DeploymentFormProps { configurationId: string; requestId: string }

export function DeploymentForm({ configurationId, requestId }: DeploymentFormProps) {
  const [state, action] = useActionState(recordDeploymentAction, initialActionState);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="requestId" value={state.requestId ?? requestId} />
      <input type="hidden" name="configurationId" value={configurationId} />
      <ActionMessage state={state} />
      <SubmitButton>Record deployment</SubmitButton>
    </form>
  );
}
