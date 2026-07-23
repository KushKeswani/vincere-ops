import { Alert, AlertDescription } from "@/components/ui/alert";
import type { ActionState } from "@/app/actions/product";

interface ActionMessageProps {
  state: ActionState;
}

export function ActionMessage({ state }: ActionMessageProps) {
  if (!state.message) return null;
  return (
    <Alert variant={state.status === "error" ? "destructive" : "default"} aria-live="polite">
      <AlertDescription>{state.message}</AlertDescription>
    </Alert>
  );
}
