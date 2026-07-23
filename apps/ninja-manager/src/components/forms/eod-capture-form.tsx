"use client";

import { useActionState, useMemo, useState } from "react";

import { captureEodSnapshotAction } from "@/app/actions/eod";
import { ActionMessage } from "@/components/action-message";
import { SubmitButton } from "@/components/submit-button";
import { Label } from "@/components/ui/label";
import { initialActionState } from "@/lib/action-state";

export interface EodCaptureAgentOption {
  id: string;
  label: string;
  captureReady: boolean;
  readiness: string;
}

interface EodCaptureFormProps {
  agents: EodCaptureAgentOption[];
  requestId: string;
}

export function EodCaptureForm({ agents, requestId }: EodCaptureFormProps) {
  const initialAgentId = agents.find((agent) => agent.captureReady)?.id ?? agents[0]?.id ?? "";
  const [selectedAgentId, setSelectedAgentId] = useState(initialAgentId);
  const [state, action] = useActionState(captureEodSnapshotAction, initialActionState);
  const selected = useMemo(
    () => agents.find((agent) => agent.id === selectedAgentId) ?? null,
    [agents, selectedAgentId],
  );

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="requestId" value={requestId} />
      <div className="space-y-2">
        <Label htmlFor="eod-agent">Local installation</Label>
        <select
          id="eod-agent"
          name="agentId"
          value={selectedAgentId}
          onChange={(event) => setSelectedAgentId(event.target.value)}
          disabled={agents.length === 0}
          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {agents.length === 0 && <option value="">No authorized local installation</option>}
          {agents.map((agent) => (
            <option key={agent.id} value={agent.id}>
              {agent.label}{agent.captureReady ? " — capture ready" : " — evidence unavailable"}
            </option>
          ))}
        </select>
        <p className="text-xs text-muted-foreground">
          {selected?.readiness ?? "Enroll a local companion and receive authenticated Runtime v2 evidence first."}
        </p>
      </div>
      <ActionMessage state={state} />
      <SubmitButton disabled={!selected?.captureReady}>Capture now</SubmitButton>
      <p className="text-xs text-muted-foreground">
        Captures the selected installation&apos;s latest fresh Runtime v2 evidence for the current America/New_York date.
        This performs no NinjaTrader or strategy operation.
      </p>
    </form>
  );
}
