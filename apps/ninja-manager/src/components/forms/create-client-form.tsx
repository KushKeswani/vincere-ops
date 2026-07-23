"use client";

import { useActionState } from "react";

import { createClientAction } from "@/app/actions/product";
import { initialActionState } from "@/lib/action-state";
import { ActionMessage } from "@/components/action-message";
import { SubmitButton } from "@/components/submit-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface CreateClientFormProps { requestId: string }

export function CreateClientForm({ requestId }: CreateClientFormProps) {
  const [state, action] = useActionState(createClientAction, initialActionState);
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="requestId" value={state.requestId ?? requestId} />
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2"><Label htmlFor="name">Client name</Label><Input key={state.values?.name} id="name" name="name" defaultValue={state.values?.name} required /></div>
        <div className="space-y-2"><Label htmlFor="email">Email</Label><Input key={state.values?.email} id="email" name="email" type="email" defaultValue={state.values?.email} required /></div>
        <div className="space-y-2"><Label htmlFor="phone">Phone</Label><Input key={state.values?.phone} id="phone" name="phone" type="tel" defaultValue={state.values?.phone} /></div>
        <div className="space-y-2"><Label htmlFor="timezone">Timezone</Label><Input key={state.values?.timezone} id="timezone" name="timezone" defaultValue={state.values?.timezone ?? "America/New_York"} required /></div>
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="temporaryPassword">Temporary password</Label>
          <Input id="temporaryPassword" name="temporaryPassword" type="password" autoComplete="new-password" required />
          <p className="text-xs text-muted-foreground">At least 12 characters with upper/lowercase, a number, and a symbol.</p>
        </div>
      </div>
      <ActionMessage state={state} />
      <SubmitButton>Create client</SubmitButton>
    </form>
  );
}
