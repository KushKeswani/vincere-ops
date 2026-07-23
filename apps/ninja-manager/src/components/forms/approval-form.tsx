"use client";

import { useActionState } from "react";

import { reviewApprovalAction } from "@/app/actions/product";
import { initialActionState } from "@/lib/action-state";
import { ActionMessage } from "@/components/action-message";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

interface ApprovalFormProps { approvalId: string; requestId: string }

export function ApprovalForm({ approvalId, requestId }: ApprovalFormProps) {
  const [state, action, pending] = useActionState(reviewApprovalAction, initialActionState);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="requestId" value={state.requestId ?? requestId} />
      <input type="hidden" name="approvalId" value={approvalId} />
      <div className="space-y-2"><Label htmlFor={`notes-${approvalId}`}>Review notes</Label><Textarea id={`notes-${approvalId}`} name="notes" placeholder="Record what you verified." /></div>
      <ActionMessage state={state} />
      <div className="flex gap-2">
        <button type="submit" name="decision" value="approved" disabled={pending} aria-disabled={pending} className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90">Approve</button>
        <button type="submit" name="decision" value="rejected" disabled={pending} aria-disabled={pending} className="inline-flex h-9 items-center justify-center rounded-md border px-4 text-sm font-medium hover:bg-accent">Reject</button>
      </div>
    </form>
  );
}
