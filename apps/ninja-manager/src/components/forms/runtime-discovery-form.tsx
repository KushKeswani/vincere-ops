"use client";

import { useActionState } from "react";

import { queueRuntimeDiscoveryAction } from "@/app/actions/runtime";
import { ActionMessage } from "@/components/action-message";
import { SubmitButton } from "@/components/submit-button";
import { initialActionState } from "@/lib/action-state";

interface RuntimeDiscoveryFormProps {
  agentId: string;
  expectedStateVersion: string | null;
  requestId: string;
  disabled?: boolean;
}

export function RuntimeDiscoveryForm({
  agentId,
  expectedStateVersion,
  requestId,
  disabled = false,
}: RuntimeDiscoveryFormProps) {
  const [state, action] = useActionState(queueRuntimeDiscoveryAction, initialActionState);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="agentId" value={agentId} />
      <input type="hidden" name="expectedStateVersion" value={expectedStateVersion ?? ""} />
      <input type="hidden" name="requestId" value={requestId} />
      <ActionMessage state={state} />
      <SubmitButton disabled={disabled}>
        Queue read-only discovery
      </SubmitButton>
      <p className="text-xs text-muted-foreground">
        Expires in two minutes. Repeated submission of this request is idempotent.
      </p>
    </form>
  );
}

