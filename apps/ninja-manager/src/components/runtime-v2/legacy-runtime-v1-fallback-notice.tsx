import { Database } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export const LEGACY_RUNTIME_V1_FALLBACK_LABEL = "Legacy Runtime Snapshot v1 fallback";

export function LegacyRuntimeV1FallbackNotice() {
  return (
    <Alert>
      <Database className="size-4" aria-hidden="true" />
      <AlertTitle>{LEGACY_RUNTIME_V1_FALLBACK_LABEL}</AlertTitle>
      <AlertDescription>
        No Runtime Observation v2 event exists for this installation. This legacy view is isolated and does not
        infer positions, orders, executions, or P&amp;L.
      </AlertDescription>
    </Alert>
  );
}
