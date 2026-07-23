"use client";

import { useActionState } from "react";

import { setKillSwitchAction } from "@/app/actions/product";
import { initialActionState } from "@/lib/action-state";
import { ActionMessage } from "@/components/action-message";
import { SubmitButton } from "@/components/submit-button";

interface KillSwitchFormProps { enabled: boolean; requestId: string }

export function KillSwitchForm({ enabled, requestId }: KillSwitchFormProps) {
  const [state, action] = useActionState(setKillSwitchAction, initialActionState);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="requestId" value={state.requestId ?? requestId} />
      <input type="hidden" name="enabled" value={String(!enabled)} />
      <ActionMessage state={state} />
      <SubmitButton variant={enabled ? "outline" : "destructive"}>{enabled ? "Restore operations" : "Enable kill switch"}</SubmitButton>
    </form>
  );
}
