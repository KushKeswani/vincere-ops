import { randomUUID } from "node:crypto";

import Link from "next/link";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Bot,
  CheckCircle2,
  CircleGauge,
  Clock3,
  Database,
  FileSpreadsheet,
  LockKeyhole,
  PlugZap,
  Radio,
  Server,
  ShieldCheck,
  ToggleLeft,
  Unplug,
} from "lucide-react";
import { notFound } from "next/navigation";

import { requireUser } from "@/lib/auth/session";
import { getDeploymentProfile } from "@/lib/deployment/server";
import { getNinjaRepository } from "@/lib/repositories/ninja-repository";
import { getProcessControlRepository } from "@/lib/repositories/process-control-repository";
import {
  getRuntimeRepository,
  type AgentInstallation,
  type CommandSummary,
  type LatestRuntimeObservationV2,
  type LatestRuntimeSnapshot,
} from "@/lib/repositories/runtime-repository";
import { RuntimeDiscoveryForm } from "@/components/forms/runtime-discovery-form";
import { ProcessControlDashboard } from "@/components/process-control/process-control-dashboard";
import {
  buildProcessControlDashboardModel,
  evaluateProcessControlPreflight,
  type ProcessControlDashboardModel,
} from "@/components/process-control/process-control-view-model";
import { LegacyRuntimeV1FallbackNotice } from "@/components/runtime-v2/legacy-runtime-v1-fallback-notice";
import { RuntimeObservationV2Dashboard } from "@/components/runtime-v2/runtime-observation-dashboard";
import { StatusBadge } from "@/components/status-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface LocalOperatorDashboardProps {
  agents: AgentInstallation[];
  selectedAgent: AgentInstallation | null;
  observationV2: LatestRuntimeObservationV2 | null;
  snapshot: LatestRuntimeSnapshot | null;
  commands: CommandSummary[];
  operationalPause: boolean;
  incidentTitle: string | null;
  openIncidentCount: number;
  processControlModel: ProcessControlDashboardModel;
}

function formatTimestamp(value: Date | null): string {
  if (!value) return "Never";
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(value)) + " UTC";
}

function LocalOperatorDashboard({
  agents,
  selectedAgent,
  observationV2,
  snapshot,
  commands,
  operationalPause,
  incidentTitle,
  openIncidentCount,
  processControlModel,
}: LocalOperatorDashboardProps) {
  if (observationV2) {
    return (
      <div className="space-y-8">
        <div>
          <p className="text-sm text-primary">Local operator console</p>
          <h2 className="text-3xl font-semibold tracking-tight">NinjaTrader account manager</h2>
          <p className="mt-2 max-w-3xl text-muted-foreground">
            Authoritative state from the durable companion and Add-On, plus separately gated NinjaTrader process requests.
          </p>
        </div>
        {operationalPause && (
          <Alert variant="destructive">
            <AlertTriangle className="size-4" aria-hidden="true" />
            <AlertTitle>Local operational pause is active</AlertTitle>
            <AlertDescription>No deployment or automated operational change should proceed until the installation is reviewed.</AlertDescription>
          </Alert>
        )}
        {openIncidentCount > 0 && incidentTitle && (
          <Alert variant="destructive">
            <AlertTriangle className="size-4" aria-hidden="true" />
            <AlertTitle>{openIncidentCount} item{openIncidentCount === 1 ? "" : "s"} need attention</AlertTitle>
            <AlertDescription>{incidentTitle}. Follow the guided evidence in Day ops.</AlertDescription>
          </Alert>
        )}
        <ProcessControlDashboard
          model={processControlModel}
          launchRequestId={randomUUID()}
          quitRequestId={randomUUID()}
        />
        <RuntimeObservationV2Dashboard latest={observationV2} />
      </div>
    );
  }

  const discoveryEnabled = Boolean(
    selectedAgent
    && selectedAgent.effectiveStatus === "online"
    && selectedAgent.addonConnected === true
    && selectedAgent.capabilities.includes("runtime.discovery"),
  );
  const connections = new Map<string, { name: string; status: string; accountCount: number }>();
  for (const account of snapshot?.accounts ?? []) {
    const current = connections.get(account.connection_name);
    connections.set(account.connection_name, {
      name: account.connection_name,
      status: current && current.status !== account.connection_status ? "mixed" : account.connection_status,
      accountCount: (current?.accountCount ?? 0) + 1,
    });
  }
  const connectionRows = [...connections.values()];
  const accountsByRef = new Map((snapshot?.accounts ?? []).map((account) => [account.account_ref, account]));
  const addOnState = selectedAgent?.addonConnected === true
    ? "Connected"
    : selectedAgent?.addonConnected === false ? "Disconnected" : "Not reported";
  const controlReadiness = [
    { label: "Operational pause clear", ready: !operationalPause },
    { label: "Companion heartbeat online", ready: selectedAgent?.effectiveStatus === "online" },
    { label: "Add-On connected", ready: selectedAgent?.addonConnected === true },
    { label: "No pending local events", ready: selectedAgent?.pendingEventCount === 0 },
    { label: "Complete supervised snapshot", ready: snapshot?.collectionMode === "supervised_simulation" },
    { label: "SIM actuator enrolled and verified", ready: selectedAgent?.capabilities.includes("sim.strategy.uia.control") === true },
  ];

  return (
    <div className="space-y-8">
      <div>
        <p className="text-sm text-primary">Local operator console</p>
        <h2 className="text-3xl font-semibold tracking-tight">NinjaTrader account manager</h2>
        <p className="mt-2 max-w-3xl text-muted-foreground">
          Observe the durable companion and in-process Add-On boundary, then request a versioned read-only scan.
          The screen reports only evidence received from that runtime path.
        </p>
      </div>

      {snapshot && (
        <LegacyRuntimeV1FallbackNotice />
      )}

      {operationalPause && (
        <Alert variant="destructive">
          <AlertTriangle className="size-4" aria-hidden="true" />
          <AlertTitle>Local operational pause is active</AlertTitle>
          <AlertDescription>
            No deployment record or automated operational change should proceed until the installation is reviewed.
          </AlertDescription>
        </Alert>
      )}
      {openIncidentCount > 0 && incidentTitle && (
        <Alert variant="destructive">
          <AlertTriangle className="size-4" aria-hidden="true" />
          <AlertTitle>{openIncidentCount} item{openIncidentCount === 1 ? "" : "s"} need attention</AlertTitle>
          <AlertDescription>{incidentTitle}. Follow the guided evidence in Day ops.</AlertDescription>
        </Alert>
      )}

      <Alert>
        <LockKeyhole className="size-4" aria-hidden="true" />
        <AlertTitle>Supervised SIM control remains locked</AlertTitle>
        <AlertDescription>
          The separate sim-control/1.0 contract is implemented, but Edith has not passed Add-On compilation, exact-target
          UI Automation, or before/after SIM verification. Buttons stay disabled instead of imitating the old EXE&apos;s
          broad UI clicks and success stubs.
        </AlertDescription>
      </Alert>

      <ProcessControlDashboard
        model={processControlModel}
        launchRequestId={randomUUID()}
        quitRequestId={randomUUID()}
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <div>
              <CardDescription>Companion</CardDescription>
              <CardTitle className="mt-1 capitalize">{selectedAgent?.effectiveStatus ?? "Not enrolled"}</CardTitle>
            </div>
            <Server className="size-6 text-primary" aria-hidden="true" />
          </CardHeader>
          <CardContent>
            {selectedAgent ? <StatusBadge status={selectedAgent.effectiveStatus} /> : <StatusBadge status="offline" />}
            <p className="mt-3 text-sm text-muted-foreground">
              {selectedAgent ? `Heartbeat ${formatTimestamp(selectedAgent.lastHeartbeatAt)}` : "No durable runtime installation is registered."}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <div>
              <CardDescription>NinjaTrader Add-On</CardDescription>
              <CardTitle className="mt-1">{addOnState}</CardTitle>
            </div>
            {selectedAgent?.addonConnected === true
              ? <PlugZap className="size-6 text-primary" aria-hidden="true" />
              : <Unplug className="size-6 text-amber-500" aria-hidden="true" />}
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              {selectedAgent?.addonVersion ? `Version ${selectedAgent.addonVersion}` : "No Add-On heartbeat has been received."}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <div>
              <CardDescription>Accounts / connections</CardDescription>
              <CardTitle className="mt-1 font-mono text-3xl">
                {snapshot?.accounts.length ?? 0} / {connectionRows.length}
              </CardTitle>
            </div>
            <Database className="size-6 text-primary" aria-hidden="true" />
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">Masked identifiers from the latest complete snapshot.</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <div>
              <CardDescription>Strategies</CardDescription>
              <CardTitle className="mt-1 font-mono text-3xl">{snapshot?.strategies.length ?? 0}</CardTitle>
            </div>
            <Bot className="size-6 text-primary" aria-hidden="true" />
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">Observed enabled, sync, and runtime states; never inferred.</p>
          </CardContent>
        </Card>
      </div>

      {!selectedAgent ? (
        <Card>
          <CardHeader>
            <CardTitle>No companion installation is enrolled</CardTitle>
            <CardDescription>
              The loopback dashboard is running, but that does not mean it is connected to NinjaTrader.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Account and strategy rows remain empty until a companion is enrolled and a NinjaTrader Add-On heartbeat
              is received. No data is borrowed from the blueprint or onboarding fixtures.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
          <Card>
            <CardHeader>
              <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
                <div>
                  <CardTitle>{selectedAgent.displayName}</CardTitle>
                  <CardDescription>
                    Selected from {agents.length} installed companion{agents.length === 1 ? "" : "s"} · last IPC/API contact {formatTimestamp(selectedAgent.lastContactAt)}
                  </CardDescription>
                </div>
                <StatusBadge status={selectedAgent.effectiveStatus} />
              </div>
            </CardHeader>
            <CardContent>
              <dl className="grid gap-3 text-sm sm:grid-cols-2">
                <div className="rounded-md border p-3">
                  <dt className="text-muted-foreground">Companion version</dt>
                  <dd className="mt-1 font-medium">{selectedAgent.agentVersion}</dd>
                </div>
                <div className="rounded-md border p-3">
                  <dt className="text-muted-foreground">Protocol</dt>
                  <dd className="mt-1 font-medium">{selectedAgent.protocolVersion}</dd>
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
            </CardContent>
          </Card>

          <Card className="h-fit">
            <CardHeader>
              <CardTitle>Read-only discovery</CardTitle>
              <CardDescription>Queue a two-minute, idempotent scan through the durable companion.</CardDescription>
            </CardHeader>
            <CardContent>
              <RuntimeDiscoveryForm
                key={selectedAgent.id}
                agentId={selectedAgent.id}
                expectedStateVersion={snapshot?.stateVersion ?? null}
                requestId={randomUUID()}
                disabled={!discoveryEnabled}
              />
              {!discoveryEnabled && (
                <p className="mt-2 text-xs text-destructive">
                  Discovery requires a current online heartbeat, a connected Add-On, and the runtime.discovery capability.
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="size-5" aria-hidden="true" />Control readiness
          </CardTitle>
          <CardDescription>
            Every gate must be current at approval time and checked again immediately before one exact SIM toggle.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {controlReadiness.map((check) => (
              <div key={check.label} className="flex items-center gap-2 rounded-md border p-3 text-sm">
                {check.ready
                  ? <CheckCircle2 className="size-4 text-emerald-600" aria-hidden="true" />
                  : <LockKeyhole className="size-4 text-amber-600" aria-hidden="true" />}
                <span>{check.label}</span>
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            Enabling/disabling all strategies, unattended schedule toggles, reconnect, flatten, order cancellation,
            and manual trading are outside this gate. Launch and graceful quit use the separate process gate above.
          </p>
        </CardContent>
      </Card>

      {!snapshot ? (
        <Card>
          <CardHeader>
            <CardTitle>No verified NinjaTrader snapshot</CardTitle>
            <CardDescription>
              The dashboard will not infer current accounts, connections, or strategies from configuration records.
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
                These rows exercise the runtime contract and UI. They do not prove a deployed production Add-On or authorize live control.
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
                <p className="mt-1 font-medium capitalize">{snapshot.collectionMode.replaceAll("_", " ")}</p>
              </div>
              <div className="rounded-md border p-3">
                <p className="text-muted-foreground">Add-On version</p>
                <p className="mt-1 font-medium">{snapshot.addonVersion}</p>
              </div>
              <div className="min-w-0 rounded-md border p-3">
                <p className="text-muted-foreground">State digest</p>
                <code className="mt-1 block truncate text-xs" title={snapshot.stateVersion}>{snapshot.stateVersion}</code>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Connections</CardTitle>
              <CardDescription>Connection kind and status reported with the authoritative account inventory.</CardDescription>
            </CardHeader>
            <CardContent>
              {connectionRows.length === 0 ? (
                <p className="text-sm text-muted-foreground">The complete snapshot reported no connections.</p>
              ) : (
                <Table>
                  <TableHeader><TableRow><TableHead>Connection</TableHead><TableHead>Status</TableHead><TableHead>Accounts</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {connectionRows.map((connection) => (
                      <TableRow key={connection.name}>
                        <TableCell className="font-medium capitalize">{connection.name.replaceAll("_", " ")}</TableCell>
                        <TableCell><StatusBadge status={connection.status} /></TableCell>
                        <TableCell>{connection.accountCount}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Database className="size-5" aria-hidden="true" />Accounts</CardTitle>
              <CardDescription>Masked identifiers only. Live account detection never enables control.</CardDescription>
            </CardHeader>
            <CardContent>
              {snapshot.accounts.length === 0 ? (
                <p className="text-sm text-muted-foreground">The complete snapshot reported no accounts.</p>
              ) : (
                <Table>
                  <TableHeader><TableRow><TableHead>Label</TableHead><TableHead>Masked ID</TableHead><TableHead>Type</TableHead><TableHead>Connection</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
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
              <CardTitle className="flex items-center gap-2"><Activity className="size-5" aria-hidden="true" />Strategies</CardTitle>
              <CardDescription>Enabled, sync, and runtime state observed by the Add-On.</CardDescription>
            </CardHeader>
            <CardContent>
              {snapshot.strategies.length === 0 ? (
                <p className="text-sm text-muted-foreground">The complete snapshot reported no strategies.</p>
              ) : (
                <Table>
                  <TableHeader><TableRow><TableHead>Label</TableHead><TableHead>Type</TableHead><TableHead>Account</TableHead><TableHead>Instrument</TableHead><TableHead>Enabled</TableHead><TableHead>Sync</TableHead><TableHead>Runtime</TableHead><TableHead>Supervised control</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {snapshot.strategies.map((strategy) => (
                      <TableRow key={strategy.strategy_ref}>
                        <TableCell className="font-medium">{strategy.strategy_name}</TableCell>
                        <TableCell>{strategy.strategy_type}</TableCell>
                        <TableCell className="font-mono">{accountsByRef.get(strategy.account_ref)?.masked_identifier ?? "Unknown"}</TableCell>
                        <TableCell>{strategy.instrument} · {strategy.timeframe}</TableCell>
                        <TableCell>{strategy.enabled ? "Yes" : "No"}</TableCell>
                        <TableCell>{strategy.sync === null ? "Unknown" : strategy.sync ? "True" : "False"}</TableCell>
                        <TableCell><StatusBadge status={strategy.runtime_state} /></TableCell>
                        <TableCell>
                          <Button size="sm" variant="outline" disabled>
                            <ToggleLeft className="size-4" aria-hidden="true" />
                            {strategy.enabled ? "Disable" : "Enable"} locked
                          </Button>
                        </TableCell>
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
          <CardTitle>Read-only command evidence</CardTitle>
          <CardDescription>Delivery and acknowledgement state for the selected companion.</CardDescription>
        </CardHeader>
        <CardContent>
          {commands.length === 0 ? (
            <p className="text-sm text-muted-foreground">No read-only discovery command has been queued for this installation.</p>
          ) : (
            <Table>
              <TableHeader><TableRow><TableHead>Command</TableHead><TableHead>Status</TableHead><TableHead>Issued</TableHead><TableHead>Expires</TableHead><TableHead>Deliveries</TableHead><TableHead>Acks</TableHead></TableRow></TableHeader>
              <TableBody>
                {commands.slice(0, 10).map((command) => (
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

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Current coverage</CardTitle>
            <CardDescription>Available now: accounts, connection status, strategies, sync, and runtime health.</CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Positions, orders, executions, realized/unrealized P&amp;L, and strategy mutation are not yet emitted by this protocol version.
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Control boundary</CardTitle>
            <CardDescription>Supervised SIM proof is still required before adding any enable, disable, reconnect, or recovery command.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2 text-sm text-primary">
              <CheckCircle2 className="size-4" aria-hidden="true" />No trading mutation is enabled; process requests use a separate durable gate
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default async function ClientDashboardPage() {
  const user = await requireUser(["client"]);
  const profile = getDeploymentProfile();
  const localOnly = profile.mode === "LOCAL_ONLY";
  const repository = getNinjaRepository();
  const client = await repository.getClientForUser(user);
  if (!client) notFound();
  const [accounts, environments, configurations, incidents, killSwitch] = await Promise.all([
    repository.getAccounts(client.id, user.organizationId), repository.getEnvironments(client.id, user.organizationId),
    repository.getConfigurations(client.id, user.organizationId), repository.listIncidents(user, client.id),
    repository.getKillSwitch(user.organizationId),
  ]);
  const openIncidents = incidents.filter((incident) => incident.status !== "resolved");
  const activeConfiguration = configurations.find((configuration) => ["approved", "deployment_recorded"].includes(configuration.status));
  const runtimeState = accounts.length > 0 || configurations.length > 0 ? "Fixture ready" : "Waiting for scan";
  const connectionState = environments[0]?.connection_status ?? "offline";
  const algorithmCount = configurations.filter((configuration) => ["approved", "deployment_recorded"].includes(configuration.status)).length;

  if (localOnly) {
    const runtimeRepository = getRuntimeRepository();
    const processRepository = getProcessControlRepository();
    const agents = await runtimeRepository.listAgents(user);
    const selectedAgent = agents.find((agent) =>
      agent.effectiveStatus === "online"
      && agent.addonConnected === true
      && agent.capabilities.includes("runtime.discovery"),
    ) ?? agents.find((agent) => agent.effectiveStatus === "online") ?? agents[0] ?? null;
    const [observationV2, commands, processCommandCounts] = selectedAgent
      ? await Promise.all([
          runtimeRepository.getLatestRuntimeObservationV2(user, selectedAgent.id),
          runtimeRepository.listCommands(user, selectedAgent.id),
          processRepository.getCommandSafetyCounts(user, selectedAgent.id),
        ])
      : [null, [], { inFlight: 0, indeterminate: 0 }];
    const snapshot = selectedAgent && !observationV2
      ? await runtimeRepository.getLatestRuntimeSnapshot(user, selectedAgent.id)
      : null;
    const processControlPreflight = evaluateProcessControlPreflight({
      agent: selectedAgent,
      latestRuntime: observationV2,
      commandCounts: processCommandCounts,
    });
    const processControlModel = buildProcessControlDashboardModel(selectedAgent, processControlPreflight);
    return (
      <LocalOperatorDashboard
        agents={agents}
        selectedAgent={selectedAgent}
        observationV2={observationV2}
        snapshot={snapshot}
        commands={commands}
        operationalPause={Boolean(killSwitch)}
        incidentTitle={openIncidents[0]?.title ?? null}
        openIncidentCount={openIncidents.length}
        processControlModel={processControlModel}
      />
    );
  }

  return (
    <div className="space-y-8">
      <div><p className="text-sm text-primary">Local operator console</p><h2 className="text-3xl font-semibold tracking-tight">NinjaTrader account manager</h2><p className="mt-2 text-muted-foreground">Scan local NinjaTrader state, import the blueprint, schedule strategy enablement, and monitor recovery work from one loopback dashboard.</p></div>
      {killSwitch && <Alert variant="destructive"><AlertTriangle className="size-4" /><AlertTitle>{localOnly ? "Local operational pause is active" : "Vincere operational pause is active"}</AlertTitle><AlertDescription>{localOnly ? "No local deployment record or automated operational change should proceed until the installation is reviewed." : "No deployments or automated operational changes should proceed until staff restores operations."}</AlertDescription></Alert>}
      {openIncidents.length > 0 && <Alert variant="destructive"><AlertTriangle className="size-4" /><AlertTitle>{openIncidents.length} item needs attention</AlertTitle><AlertDescription>{openIncidents[0].title}. Follow the guided steps in Activity.</AlertDescription></Alert>}
      <div className="grid gap-4 md:grid-cols-3">
        <Card><CardHeader className="flex-row items-center justify-between"><div><CardDescription>Scanner</CardDescription><CardTitle className="mt-1">{runtimeState}</CardTitle></div><Radio className="size-6 text-primary" /></CardHeader><CardContent><StatusBadge status={accounts.length ? "healthy" : "offline"} /><p className="mt-3 text-sm text-muted-foreground">{accounts.length} account fixture{accounts.length === 1 ? "" : "s"} available. Live NinjaTrader scan waits for the verified Add-On.</p></CardContent></Card>
        <Card><CardHeader className="flex-row items-center justify-between"><div><CardDescription>Connections</CardDescription><CardTitle className="mt-1">{connectionState}</CardTitle></div><PlugZap className="size-6 text-primary" /></CardHeader><CardContent>{environments[0] ? <><StatusBadge status={environments[0].connection_status} /><p className="mt-3 text-sm text-muted-foreground">Local connection recovery is modeled; live reconnect is disabled until SIM verification.</p></> : <p className="text-sm text-muted-foreground">No local connection snapshot has been received yet.</p>}</CardContent></Card>
        <Card><CardHeader className="flex-row items-center justify-between"><div><CardDescription>Algorithms</CardDescription><CardTitle className="mt-1">{algorithmCount} selected</CardTitle></div><Bot className="size-6 text-primary" /></CardHeader><CardContent>{activeConfiguration ? <><StatusBadge status={activeConfiguration.status} /><p className="mt-3 text-sm text-muted-foreground">{activeConfiguration.strategy_name} v{activeConfiguration.version}. Enablement remains queued/simulated only.</p></> : <Button asChild size="sm"><Link href="/client/strategy">Open blueprint</Link></Button>}</CardContent></Card>
      </div>
      <Card>
        <CardHeader><CardTitle>Operating workflow</CardTitle><CardDescription>The dashboard should replace the old manual checklist: scan, import, map, schedule, monitor, recover.</CardDescription></CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-4">
          {[
            ["Scan", "Read accounts, connections, strategies, positions, and running state from the Add-On.", Radio],
            ["Blueprint", "Import XLS/XLSX assignments and choose which account/algorithm pairs are active.", FileSpreadsheet],
            ["Schedule", "Stage the exact enable time and keep Sync=True/running verification evidence.", Clock3],
            ["Recover", "Detect price disconnects and queue disable/reconnect/re-enable runbooks.", CircleGauge],
          ].map(([title, description, Icon]) => <div key={String(title)} className="rounded-md border p-4 text-sm"><div className="mb-2 flex items-center gap-2 font-medium"><Icon className="size-4 text-primary" />{String(title)}</div><p className="text-muted-foreground">{String(description)}</p></div>)}
        </CardContent>
      </Card>
      <div className="grid gap-4 md:grid-cols-2">
        <Card><CardHeader><CardTitle>Next action</CardTitle><CardDescription>Build the blueprint import table and map algorithm/account/schedule rows before enabling any live operation path.</CardDescription></CardHeader><CardContent><Button asChild><Link href="/client/strategy">Open blueprint <ArrowRight className="size-4" /></Link></Button></CardContent></Card>
        <Card><CardHeader><CardTitle>Automation boundary</CardTitle><CardDescription>Discovery is the first live Add-On feature. Strategy toggles, connection reconnects, and recovery actions must stay gated behind SIM proof and audit evidence.</CardDescription></CardHeader><CardContent><div className="flex items-center gap-2 text-sm text-primary"><CheckCircle2 className="size-4" />No live account mutation is enabled in this checkpoint</div></CardContent></Card>
      </div>
    </div>
  );
}
