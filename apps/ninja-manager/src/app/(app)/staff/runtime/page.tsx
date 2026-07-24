import { randomUUID } from "node:crypto";

import Link from "next/link";
import {
  Activity,
  AlertTriangle,
  Clock3,
  Database,
  Radio,
  Server,
  ShieldCheck,
  Unplug,
  Wifi,
} from "lucide-react";

import { requireUser } from "@/lib/auth/session";
import { cn } from "@/lib/utils";
import { getRuntimeRepository } from "@/lib/repositories/runtime-repository";
import { RuntimeDiscoveryForm } from "@/components/forms/runtime-discovery-form";
import { RuntimeObservationV2Dashboard } from "@/components/runtime-v2/runtime-observation-dashboard";
import { StatusBadge } from "@/components/status-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface RuntimePageProps {
  searchParams: Promise<{ agent?: string }>;
}

function formatTimestamp(value: Date | null): string {
  if (!value) return "Never";
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(value)) + " UTC";
}

export default async function StaffRuntimePage({ searchParams }: RuntimePageProps) {
  const user = await requireUser(["staff"]);
  const repository = getRuntimeRepository();
  const agents = await repository.listAgents(user);
  const requestedAgentId = (await searchParams).agent;
  const defaultAgent = agents.find((agent) =>
    agent.effectiveStatus === "online" && agent.capabilities.includes("runtime.discovery"),
  ) ?? agents.find((agent) => agent.effectiveStatus === "online") ?? agents[0] ?? null;
  const selectedAgent = agents.find((agent) => agent.id === requestedAgentId) ?? defaultAgent;
  const [observationV2, snapshot, commands] = selectedAgent
    ? await Promise.all([
        repository.getLatestRuntimeObservationV2(user, selectedAgent.id),
        repository.getLatestRuntimeSnapshot(user, selectedAgent.id),
        repository.listCommands(user, selectedAgent.id),
      ])
    : [null, null, []];

  const onlineCount = agents.filter((agent) => agent.effectiveStatus === "online").length;
  const attentionCount = agents.filter((agent) =>
    ["degraded", "stale", "offline"].includes(agent.effectiveStatus),
  ).length;
  const discoveryEnabled = Boolean(
    selectedAgent
    && selectedAgent.effectiveStatus === "online"
    && selectedAgent.capabilities.includes("runtime.discovery"),
  );

  return (
    <div className="space-y-8">
      <div>
        <p className="text-sm text-primary">Runtime evidence</p>
        <h2 className="text-3xl font-semibold">NinjaTrader discovery</h2>
        <p className="mt-2 max-w-3xl text-muted-foreground">
          Staff-only health, account, strategy, and command evidence from the outbound companion boundary.
        </p>
      </div>

      <Alert>
        <ShieldCheck className="size-4" aria-hidden="true" />
        <AlertTitle>Read-only supervised foundation</AlertTitle>
        <AlertDescription>
          This surface cannot enable strategies, place or cancel orders, flatten positions, mutate accounts,
          or enforce live risk. Evidence marked supervised simulation is not production Add-On authority.
        </AlertDescription>
      </Alert>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <div>
              <CardDescription>Installed agents</CardDescription>
              <CardTitle className="font-mono text-3xl">{agents.length}</CardTitle>
            </div>
            <Server className="size-6 text-primary" aria-hidden="true" />
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <div>
              <CardDescription>Online now</CardDescription>
              <CardTitle className="font-mono text-3xl">{onlineCount}</CardTitle>
            </div>
            <Wifi className="size-6 text-primary" aria-hidden="true" />
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <div>
              <CardDescription>Need attention</CardDescription>
              <CardTitle className="font-mono text-3xl">{attentionCount}</CardTitle>
            </div>
            <AlertTriangle className="size-6 text-amber-500" aria-hidden="true" />
          </CardHeader>
        </Card>
      </div>

      {agents.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>No companion agents enrolled</CardTitle>
            <CardDescription>
              Runtime discovery remains empty until staff enrolls a companion through the controlled credential workflow.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              No account or strategy data is inferred from client-entered labels.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-6 xl:grid-cols-[20rem_minmax(0,1fr)]">
          <Card className="h-fit">
            <CardHeader>
              <CardTitle>Companion agents</CardTitle>
              <CardDescription>Heartbeat health is separate from API contact.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {agents.map((agent) => {
                const selected = agent.id === selectedAgent?.id;
                return (
                  <Link
                    key={agent.id}
                    href={"/staff/runtime?agent=" + agent.id}
                    aria-current={selected ? "page" : undefined}
                    className={cn(
                      "block rounded-lg border p-3 transition-colors hover:bg-accent",
                      selected && "border-primary bg-accent",
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate font-medium">{agent.displayName}</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Agent {agent.agentVersion} · protocol {agent.protocolVersion}
                        </p>
                      </div>
                      <StatusBadge status={agent.effectiveStatus} />
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">
                      Heartbeat: {formatTimestamp(agent.lastHeartbeatAt)}
                    </p>
                  </Link>
                );
              })}
            </CardContent>
          </Card>

          {selectedAgent && (
            <div className="min-w-0 space-y-6">
              {selectedAgent.effectiveStatus !== "online" && (
                <Alert variant="destructive">
                  <Unplug className="size-4" aria-hidden="true" />
                  <AlertTitle>Discovery unavailable: {selectedAgent.effectiveStatus}</AlertTitle>
                  <AlertDescription>
                    The last contact cannot establish a current healthy heartbeat. No command will be queued from this view.
                  </AlertDescription>
                </Alert>
              )}

              <Card>
                <CardHeader>
                  <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
                    <div>
                      <CardTitle>{selectedAgent.displayName}</CardTitle>
                      <CardDescription>
                        Last API contact {formatTimestamp(selectedAgent.lastContactAt)} · event sequence {selectedAgent.lastEventSequence}
                      </CardDescription>
                    </div>
                    <StatusBadge status={selectedAgent.effectiveStatus} />
                  </div>
                </CardHeader>
                <CardContent className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_18rem]">
                  <dl className="grid gap-3 text-sm sm:grid-cols-2">
                    <div className="rounded-md border p-3">
                      <dt className="text-muted-foreground">Add-On connection</dt>
                      <dd className="mt-1 font-medium">
                        {selectedAgent.addonConnected === null
                          ? "Not reported"
                          : selectedAgent.addonConnected ? "Connected" : "Disconnected"}
                      </dd>
                    </div>
                    <div className="rounded-md border p-3">
                      <dt className="text-muted-foreground">Add-On version</dt>
                      <dd className="mt-1 font-medium">{selectedAgent.addonVersion ?? "Not reported"}</dd>
                    </div>
                    <div className="rounded-md border p-3">
                      <dt className="text-muted-foreground">Pending local events</dt>
                      <dd className="mt-1 font-medium">{selectedAgent.pendingEventCount ?? "Not reported"}</dd>
                    </div>
                    <div className="rounded-md border p-3">
                      <dt className="text-muted-foreground">Capabilities</dt>
                      <dd className="mt-1 break-words font-medium">
                        {selectedAgent.capabilities.length ? selectedAgent.capabilities.join(", ") : "None"}
                      </dd>
                    </div>
                  </dl>
                  <div>
                    <RuntimeDiscoveryForm
                      key={selectedAgent.id}
                      agentId={selectedAgent.id}
                      expectedStateVersion={snapshot?.stateVersion ?? null}
                      requestId={randomUUID()}
                      disabled={!discoveryEnabled}
                    />
                    {!discoveryEnabled && selectedAgent.effectiveStatus === "online" && (
                      <p className="mt-2 text-xs text-destructive">
                        This agent did not advertise runtime.discovery.
                      </p>
                    )}
                  </div>
                </CardContent>
              </Card>

              {observationV2 ? (
                <RuntimeObservationV2Dashboard latest={observationV2} />
              ) : !snapshot ? (
                <Card>
                  <CardHeader>
                    <CardTitle>No verified runtime snapshot</CardTitle>
                    <CardDescription>
                      The dashboard will not infer authoritative accounts or strategies from onboarding records.
                    </CardDescription>
                  </CardHeader>
                </Card>
              ) : (
                <>
                  {snapshot.collectionMode === "supervised_simulation" && (
                    <Alert>
                      <Radio className="size-4" aria-hidden="true" />
                      <AlertTitle>Supervised simulation evidence</AlertTitle>
                      <AlertDescription>
                        These rows exercise the contract and UI. They do not prove a deployed production Add-On.
                      </AlertDescription>
                    </Alert>
                  )}

                  <Card>
                    <CardHeader>
                      <CardTitle>Snapshot evidence</CardTitle>
                      <CardDescription>
                        Observed {formatTimestamp(snapshot.observedAt)} · received {formatTimestamp(snapshot.receivedAt)}
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="grid gap-3 text-sm sm:grid-cols-3">
                      <div className="rounded-md border p-3">
                        <p className="text-muted-foreground">Collection mode</p>
                        <p className="mt-1 font-medium">{snapshot.collectionMode.replaceAll("_", " ")}</p>
                      </div>
                      <div className="rounded-md border p-3">
                        <p className="text-muted-foreground">Add-On version</p>
                        <p className="mt-1 font-medium">{snapshot.addonVersion}</p>
                      </div>
                      <div className="min-w-0 rounded-md border p-3">
                        <p className="text-muted-foreground">State digest</p>
                        <code className="mt-1 block truncate text-xs" title={snapshot.stateVersion}>
                          {snapshot.stateVersion}
                        </code>
                      </div>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <Database className="size-5" aria-hidden="true" />
                        Accounts
                      </CardTitle>
                      <CardDescription>Masked identifiers and keyed fingerprints only.</CardDescription>
                    </CardHeader>
                    <CardContent>
                      {snapshot.accounts.length === 0 ? (
                        <p className="text-sm text-muted-foreground">The complete snapshot reported no accounts.</p>
                      ) : (
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Label</TableHead>
                              <TableHead>Masked ID</TableHead>
                              <TableHead>Type</TableHead>
                              <TableHead>Connection kind</TableHead>
                              <TableHead>Status</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {snapshot.accounts.map((account) => (
                              <TableRow key={account.account_ref}>
                                <TableCell className="font-medium">{account.display_name}</TableCell>
                                <TableCell className="font-mono">{account.masked_identifier}</TableCell>
                                <TableCell className="capitalize">{account.account_type}</TableCell>
                                <TableCell className="capitalize">{account.connection_name.replaceAll("_", " ")}</TableCell>
                                <TableCell><StatusBadge status={account.connection_status} /></TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      )}
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <Activity className="size-5" aria-hidden="true" />
                        Strategies
                      </CardTitle>
                      <CardDescription>Observed enabled, sync, and runtime state—never inferred.</CardDescription>
                    </CardHeader>
                    <CardContent>
                      {snapshot.strategies.length === 0 ? (
                        <p className="text-sm text-muted-foreground">The complete snapshot reported no strategies.</p>
                      ) : (
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Label</TableHead>
                              <TableHead>Type</TableHead>
                              <TableHead>Instrument</TableHead>
                              <TableHead>Timeframe</TableHead>
                              <TableHead>Enabled</TableHead>
                              <TableHead>Sync</TableHead>
                              <TableHead>Runtime</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {snapshot.strategies.map((strategy) => (
                              <TableRow key={strategy.strategy_ref}>
                                <TableCell className="font-medium">{strategy.strategy_name}</TableCell>
                                <TableCell>{strategy.strategy_type}</TableCell>
                                <TableCell>{strategy.instrument}</TableCell>
                                <TableCell>{strategy.timeframe}</TableCell>
                                <TableCell>{strategy.enabled ? "Yes" : "No"}</TableCell>
                                <TableCell>{strategy.sync === null ? "Unknown" : strategy.sync ? "True" : "False"}</TableCell>
                                <TableCell><StatusBadge status={strategy.runtime_state} /></TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      )}
                    </CardContent>
                  </Card>
                </>
              )}

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Clock3 className="size-5" aria-hidden="true" />
                    Read-only command evidence
                  </CardTitle>
                  <CardDescription>Latest 50 commands, with server-materialized expiry.</CardDescription>
                </CardHeader>
                <CardContent>
                  {commands.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No read-only commands have been queued for this agent.</p>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Command</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Issued</TableHead>
                          <TableHead>Expires</TableHead>
                          <TableHead>Deliveries</TableHead>
                          <TableHead>Acks</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {commands.map((command) => (
                          <TableRow key={command.commandId}>
                            <TableCell className="font-medium">{command.commandType.replaceAll("_", " ")}</TableCell>
                            <TableCell><StatusBadge status={command.status} /></TableCell>
                            <TableCell>{formatTimestamp(command.issuedAt)}</TableCell>
                            <TableCell>{formatTimestamp(command.expiresAt)}</TableCell>
                            <TableCell>{command.deliveryAttempts}</TableCell>
                            <TableCell>{command.lastAckSequence}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
