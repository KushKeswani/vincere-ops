import {
  analyzeFeedAndAlgoHealth,
  type AnalyzeFeedAlgoHealthInput,
  type FeedAlgoHealthObservationInput,
  type FeedAlgoHealthSeverity,
} from "@/lib/domain/feed-algo-health";

export interface FeedAlgoHealthSourceCandidate {
  installationLabel: string;
  current: FeedAlgoHealthObservationInput;
}

export function selectLatestFeedAlgoHealthSource(
  candidates: FeedAlgoHealthSourceCandidate[],
): FeedAlgoHealthSourceCandidate | null {
  let selected: FeedAlgoHealthSourceCandidate | null = null;
  for (const candidate of candidates) {
    if (!selected) {
      selected = candidate;
      continue;
    }
    const candidateTime = new Date(candidate.current.receivedAt).getTime();
    const selectedTime = new Date(selected.current.receivedAt).getTime();
    if (Number.isFinite(candidateTime) && (!Number.isFinite(selectedTime) || candidateTime > selectedTime)) {
      selected = candidate;
    }
  }
  return selected;
}

function formatEt(value: string): string {
  if (value === "Unavailable") return value;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unavailable";
  return `${new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "medium",
    timeZone: "America/New_York",
  }).format(date)} ET`;
}

function severityLabel(severity: FeedAlgoHealthSeverity): string {
  if (severity === "critical") return "Blocked";
  if (severity === "warning") return "Review required";
  return "Informational";
}

export function buildFeedAlgoHealthDisplayModel(input: AnalyzeFeedAlgoHealthInput) {
  const analysis = analyzeFeedAndAlgoHealth(input);
  const counts = analysis.findings.reduce<Record<FeedAlgoHealthSeverity, number>>(
    (result, row) => ({ ...result, [row.severity]: result[row.severity] + 1 }),
    { info: 0, warning: 0, critical: 0 },
  );
  return {
    ...analysis,
    statusLabel: severityLabel(analysis.severity),
    observedAt: formatEt(analysis.observedAt),
    occurredAt: formatEt(analysis.occurredAt),
    receivedAt: formatEt(analysis.receivedAt),
    counts,
    findings: analysis.findings.map((row) => ({ ...row, severityLabel: severityLabel(row.severity) })),
  };
}
