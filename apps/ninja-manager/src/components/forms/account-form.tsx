"use client";

import { useActionState } from "react";

import { addAccountAction } from "@/app/actions/product";
import { initialActionState } from "@/lib/action-state";
import { ActionMessage } from "@/components/action-message";
import { SubmitButton } from "@/components/submit-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface AccountFormProps { requestId: string }

export function AccountForm({ requestId }: AccountFormProps) {
  const [state, action] = useActionState(addAccountAction, initialActionState);
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="requestId" value={state.requestId ?? requestId} />
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2"><Label htmlFor="provider">Prop firm / provider</Label><Input id="provider" name="provider" placeholder="Apex" required /></div>
        <div className="space-y-2"><Label htmlFor="label">Account label</Label><Input id="label" name="label" placeholder="Primary evaluation" required /></div>
        <div className="space-y-2"><Label htmlFor="accountIdentifier">Account identifier</Label><Input id="accountIdentifier" name="accountIdentifier" required /><p className="text-xs text-muted-foreground">Only the final four characters are stored.</p></div>
        <div className="space-y-2"><Label htmlFor="accountSize">Account size</Label><Input id="accountSize" name="accountSize" type="number" min="1000" step="1000" required /></div>
        <div className="space-y-2"><Label htmlFor="ruleProfile">Rule profile</Label><Input id="ruleProfile" name="ruleProfile" placeholder="Standard trailing drawdown" required /></div>
        <div className="space-y-2"><Label htmlFor="vpsProvider">VPS provider</Label><Input id="vpsProvider" name="vpsProvider" placeholder="Vultr" required /></div>
        <div className="space-y-2"><Label htmlFor="vpsRegion">VPS region</Label><Input id="vpsRegion" name="vpsRegion" placeholder="New Jersey" required /></div>
        <div className="space-y-2"><Label htmlFor="ninjaVersion">NinjaTrader version</Label><Input id="ninjaVersion" name="ninjaVersion" placeholder="8.1" required /></div>
      </div>
      <ActionMessage state={state} />
      <SubmitButton>Register account and environment</SubmitButton>
    </form>
  );
}
