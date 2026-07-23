"use client";

import { useActionState, useState } from "react";
import { Power, PowerOff, ShieldAlert } from "lucide-react";

import { queueProcessControlAction } from "@/app/actions/process-control";
import { ActionMessage } from "@/components/action-message";
import type { ProcessControlDashboardModel } from "@/components/process-control/process-control-view-model";
import { SubmitButton } from "@/components/submit-button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { initialActionState } from "@/lib/action-state";

interface ProcessControlRequestFormProps {
  agentId: string | null;
  requestId: string;
  commandType: "LAUNCH_NINJATRADER" | "REQUEST_NINJATRADER_QUIT";
  ready: boolean;
  reason: string;
}

function ProcessControlRequestForm({
  agentId,
  requestId,
  commandType,
  ready,
  reason,
}: ProcessControlRequestFormProps) {
  const confirmation = commandType === "LAUNCH_NINJATRADER" ? "LAUNCH NINJATRADER" : "QUIT NINJATRADER";
  const label = commandType === "LAUNCH_NINJATRADER" ? "Launch NinjaTrader" : "Gracefully quit NinjaTrader";
  const [typedConfirmation, setTypedConfirmation] = useState("");
  const [state, action] = useActionState(queueProcessControlAction, initialActionState);
  const descriptionId = `process-${commandType.toLowerCase()}-reason`;
  return (
    <form action={action} className="space-y-3 rounded-md border p-4">
      <input type="hidden" name="agentId" value={agentId ?? ""} />
      <input type="hidden" name="requestId" value={requestId} />
      <input type="hidden" name="commandType" value={commandType} />
      <div className="flex items-center gap-2 font-medium">
        {commandType === "LAUNCH_NINJATRADER"
          ? <Power className="size-4 text-primary" aria-hidden="true" />
          : <PowerOff className="size-4 text-amber-600" aria-hidden="true" />}
        {label}
      </div>
      <p id={descriptionId} className={ready ? "text-xs text-muted-foreground" : "text-xs text-amber-700 dark:text-amber-400"}>
        {reason}
      </p>
      <div className="space-y-2">
        <Label htmlFor={`process-confirmation-${commandType}`}>Type {confirmation}</Label>
        <Input
          id={`process-confirmation-${commandType}`}
          name="confirmation"
          value={typedConfirmation}
          onChange={(event) => setTypedConfirmation(event.target.value)}
          autoComplete="off"
          spellCheck={false}
          aria-describedby={descriptionId}
          disabled={!ready || !agentId}
        />
      </div>
      <ActionMessage state={state} />
      <SubmitButton
        variant={commandType === "REQUEST_NINJATRADER_QUIT" ? "destructive" : "default"}
        disabled={!ready || !agentId || typedConfirmation !== confirmation}
      >
        {commandType === "LAUNCH_NINJATRADER" ? "Queue launch" : "Queue graceful quit"}
      </SubmitButton>
    </form>
  );
}

interface ProcessControlDashboardProps {
  model: ProcessControlDashboardModel;
  launchRequestId: string;
  quitRequestId: string;
}

export function ProcessControlDashboard({
  model,
  launchRequestId,
  quitRequestId,
}: ProcessControlDashboardProps) {
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
          <div>
            <CardTitle className="flex items-center gap-2">
              <ShieldAlert className="size-5" aria-hidden="true" />NinjaTrader process
            </CardTitle>
            <CardDescription>
              {model.installationLabel} · observed state: {model.processStatus}. Requests use the durable companion queue.
            </CardDescription>
          </div>
          <Badge variant="outline" className="w-fit capitalize">{model.processStatus}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 lg:grid-cols-2">
          <ProcessControlRequestForm
            agentId={model.agentId}
            requestId={launchRequestId}
            commandType="LAUNCH_NINJATRADER"
            ready={model.launch.ready}
            reason={model.launch.reason}
          />
          <ProcessControlRequestForm
            agentId={model.agentId}
            requestId={quitRequestId}
            commandType="REQUEST_NINJATRADER_QUIT"
            ready={model.quit.ready}
            reason={model.quit.reason}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          No executable path, process identity, runtime digest, account identifier, safety count, password, force-kill,
          order, position, strategy, or connection instruction is accepted from the browser.
        </p>
      </CardContent>
    </Card>
  );
}
