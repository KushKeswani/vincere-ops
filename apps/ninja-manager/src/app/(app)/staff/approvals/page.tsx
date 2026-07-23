import { randomUUID } from "node:crypto";

import { CheckCircle2, TriangleAlert } from "lucide-react";

import { requireUser } from "@/lib/auth/session";
import { formatDate } from "@/lib/format";
import { getNinjaRepository } from "@/lib/repositories/ninja-repository";
import { ApprovalForm } from "@/components/forms/approval-form";
import { StatusBadge } from "@/components/status-badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default async function StaffApprovalsPage() {
  const user = await requireUser(["staff"]);
  const approvals = await getNinjaRepository().listApprovals(user);
  return <div className="space-y-8"><div><p className="text-sm text-primary">Configuration governance</p><h2 className="text-3xl font-semibold">Strategy approval queue</h2><p className="mt-2 text-muted-foreground">Review the exact version, validation evidence, and operating limits before approval.</p></div>
    {approvals.length === 0 ? <Card><CardContent className="py-12 text-center text-muted-foreground">No strategy recommendations have been submitted.</CardContent></Card> : approvals.map((approval) => { const config = approval.configuration as Record<string, unknown>; const validation = approval.validation as { checks?: Array<{ key: string; status: string; message: string }> }; return <Card key={approval.id}><CardHeader><div className="flex flex-wrap items-start justify-between gap-3"><div><CardTitle>{approval.client_name} · {approval.strategy_name}</CardTitle><CardDescription>Version {approval.version} · submitted {formatDate(approval.created_at)}</CardDescription></div><StatusBadge status={approval.status} /></div></CardHeader><CardContent className="space-y-5"><dl className="grid gap-3 rounded-md border p-4 text-sm sm:grid-cols-3"><div><dt className="text-muted-foreground">Contracts</dt><dd className="font-mono text-lg">{String(config.contracts ?? "—")}</dd></div><div><dt className="text-muted-foreground">Daily loss limit</dt><dd className="font-mono text-lg">${Number(config.dailyLossLimit ?? 0).toLocaleString()}</dd></div><div><dt className="text-muted-foreground">Kill switch</dt><dd className="font-mono text-lg">{config.killSwitchEnabled ? "Enabled" : "Missing"}</dd></div></dl>
      <div className="space-y-2">{validation.checks?.map((check) => <div key={check.key} className="flex gap-2 text-sm">{check.status === "pass" ? <CheckCircle2 className="mt-0.5 size-4 text-primary" /> : <TriangleAlert className="mt-0.5 size-4 text-amber-400" />}{check.message}</div>)}</div>
      {approval.status === "pending" ? <ApprovalForm approvalId={approval.id} requestId={randomUUID()} /> : <p className="text-sm text-muted-foreground">Review complete{approval.notes ? `: ${approval.notes}` : "."}</p>}
    </CardContent></Card>; })}
  </div>;
}
