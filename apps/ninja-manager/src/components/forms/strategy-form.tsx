"use client";

import { useActionState } from "react";

import { recommendStrategyAction } from "@/app/actions/product";
import { initialActionState } from "@/lib/action-state";
import { ActionMessage } from "@/components/action-message";
import { SubmitButton } from "@/components/submit-button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

function Question({ label, name, options }: { label: string; name: string; options: Array<[string, string]> }) {
  return (
    <div className="space-y-2">
      <Label htmlFor={name}>{label}</Label>
      <Select name={name} required>
        <SelectTrigger id={name} className="w-full"><SelectValue placeholder="Choose one" /></SelectTrigger>
        <SelectContent>{options.map(([value, text]) => <SelectItem key={value} value={value}>{text}</SelectItem>)}</SelectContent>
      </Select>
    </div>
  );
}

interface StrategyFormProps { requestId: string }

export function StrategyForm({ requestId }: StrategyFormProps) {
  const [state, action] = useActionState(recommendStrategyAction, initialActionState);
  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="requestId" value={state.requestId ?? requestId} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Question label="Primary objective" name="objective" options={[["preserve", "Preserve and learn"], ["consistent", "Operate consistently"], ["growth", "Controlled growth"]]} />
        <Question label="Platform experience" name="experience" options={[["new", "New"], ["intermediate", "Intermediate"], ["advanced", "Advanced"]]} />
        <Question label="Drawdown comfort" name="drawdownComfort" options={[["low", "Low"], ["moderate", "Moderate"], ["higher", "Higher, with review"]]} />
        <Question label="Guidance level" name="automationLevel" options={[["guided", "Explain every step"], ["assisted", "Assisted workflow"]]} />
        <Question label="Preferred trading window" name="tradingWindow" options={[["morning", "US morning"], ["afternoon", "US afternoon"], ["flexible", "Flexible"]]} />
      </div>
      <p className="text-sm text-muted-foreground">Recommendations are operational guidance, not promises of performance. Every configuration requires staff approval.</p>
      <ActionMessage state={state} />
      <SubmitButton>Generate safe recommendation</SubmitButton>
    </form>
  );
}
