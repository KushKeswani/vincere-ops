import { Badge } from "@/components/ui/badge";

interface StatusBadgeProps {
  status: string;
}

export function StatusBadge({ status }: StatusBadgeProps) {
  const healthy = [
    "healthy", "complete", "approved", "deployment_recorded", "resolved", "active",
    "online", "connected", "running", "completed", "synchronized",
  ].includes(status);
  const attention = [
    "degraded", "stale", "pending", "pending_approval", "in_progress", "investigating",
    "queued", "accepted", "started", "progress", "partial", "waiting_sync",
  ].includes(status);
  return (
    <Badge variant={healthy ? "default" : attention ? "secondary" : "destructive"} className="capitalize">
      {status.replaceAll("_", " ")}
    </Badge>
  );
}
