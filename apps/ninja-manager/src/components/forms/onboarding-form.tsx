"use client";

import { useActionState } from "react";

import { completeOnboardingAction } from "@/app/actions/product";
import { initialActionState } from "@/lib/action-state";
import { ActionMessage } from "@/components/action-message";
import { SubmitButton } from "@/components/submit-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface OnboardingFormProps { phone: string; timezone: string; requestId: string }

export function OnboardingForm({ phone, timezone, requestId }: OnboardingFormProps) {
  const [state, action] = useActionState(completeOnboardingAction, initialActionState);
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="requestId" value={state.requestId ?? requestId} />
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2"><Label htmlFor="phone">Phone</Label><Input id="phone" name="phone" type="tel" defaultValue={phone} required /></div>
        <div className="space-y-2"><Label htmlFor="timezone">Reporting timezone</Label><Input id="timezone" name="timezone" defaultValue={timezone} required /></div>
      </div>
      <label className="flex items-start gap-3 rounded-md border p-4 text-sm">
        <input name="riskAcknowledged" type="checkbox" className="mt-1 size-4" required />
        <span>I understand automated systems can lose money, do not guarantee returns, and that strategy activation requires review.</span>
      </label>
      <ActionMessage state={state} />
      <SubmitButton>Complete onboarding</SubmitButton>
    </form>
  );
}
