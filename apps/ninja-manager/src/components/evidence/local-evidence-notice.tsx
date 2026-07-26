import { FlaskConical, ShieldCheck } from "lucide-react";

import type { LocalEvidencePresentation } from "@/lib/presentation/local-evidence";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

interface LocalEvidenceNoticeProps {
  readonly presentation: LocalEvidencePresentation;
  readonly surface: "runtime" | "blueprint";
}

export function LocalEvidenceNotice({ presentation, surface }: LocalEvidenceNoticeProps) {
  const fixture = presentation.kind === "fixture_demo";
  const boundary = surface === "runtime"
    ? "This browser view performs no NinjaTrader actuation."
    : "Workbook preview, mapping drafts, and approvals stay inside the local prototype and do not authorize or actuate NinjaTrader.";

  return (
    <Alert data-evidence-kind={presentation.kind}>
      {fixture
        ? <FlaskConical className="size-4" aria-hidden="true" />
        : <ShieldCheck className="size-4" aria-hidden="true" />}
      <AlertTitle>{presentation.title}</AlertTitle>
      <AlertDescription>{presentation.description} {boundary}</AlertDescription>
    </Alert>
  );
}
