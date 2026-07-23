import { beforeEach, describe, expect, it, vi } from "vitest";

import { RuntimeServiceError } from "@/lib/domain/runtime-errors";

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  requireDeploymentCapability: vi.fn(),
  listAgents: vi.fn(),
  getLatestRuntimeObservationV2: vi.fn(),
  findCommandByIdempotency: vi.fn(),
  getCommandSafetyCounts: vi.fn(),
  createApproval: vi.fn(),
  enqueueApprovedCommand: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/auth/session", () => ({ requireUser: mocks.requireUser }));
vi.mock("@/lib/deployment/server", () => ({ requireDeploymentCapability: mocks.requireDeploymentCapability }));
vi.mock("@/lib/repositories/runtime-repository", () => ({
  getRuntimeRepository: () => ({
    listAgents: mocks.listAgents,
    getLatestRuntimeObservationV2: mocks.getLatestRuntimeObservationV2,
  }),
}));
vi.mock("@/lib/repositories/process-control-repository", () => ({
  getProcessControlRepository: () => ({
    findCommandByIdempotency: mocks.findCommandByIdempotency,
    getCommandSafetyCounts: mocks.getCommandSafetyCounts,
    createApproval: mocks.createApproval,
    enqueueApprovedCommand: mocks.enqueueApprovedCommand,
  }),
}));

import { queueProcessControlAction } from "./process-control";

const idleState = { status: "idle" as const, message: "" };
const agentId = "30000000-0000-4000-8000-000000000001";
const requestId = "70000000-0000-4000-8000-000000000001";
const installationRef = `install_${"a".repeat(32)}`;
const processRef = `process_${"b".repeat(64)}`;
const stateVersion = `sha256:${"1".repeat(64)}`;

function agent(state: "running" | "not_running" | "ambiguous" = "not_running") {
  return {
    id: agentId,
    displayName: "Edith",
    capabilities: ["process.control", "process.observation"],
    processObservation: {
      evidenceEventId: "40000000-0000-4000-8000-000000000001",
      evidenceSequence: 1,
      observedAt: new Date("2026-07-21T19:00:18.000Z"),
      receivedAt: new Date("2026-07-21T19:00:19.000Z"),
      installationRef,
      state,
      processStateVersion: stateVersion,
      processRef: state === "running" ? processRef : null,
      matchedProcessCount: state === "running" ? 1 : state === "not_running" ? 0 : 2,
      unavailableReason: state === "ambiguous" ? "MULTIPLE_ACTIVE_PROCESSES" : null,
      freshness: { status: "fresh", ageMs: 2_000, maxAgeMs: 45_000, expiresAt: new Date("2026-07-21T19:01:03.000Z") },
    },
  };
}

function runtime() {
  const complete = (itemCount: number) => ({ status: "complete", itemCount, errors: [] });
  return {
    agentId,
    occurredAt: new Date("2026-07-21T19:00:18.500Z"),
    receivedAt: new Date("2026-07-21T19:00:19.000Z"),
    observation: {
      asOf: "2026-07-21T19:00:18.000Z",
      freshness: { status: "fresh", ageMs: 0, maxAgeMs: 60_000 },
      source: { installationRef },
      state: {
        process: { status: "running", processRef },
        addon: { status: "connected", health: "healthy", ipcAuthenticated: true },
        accounts: [{ classification: { environment: "simulation" } }],
        strategies: [], positions: [], orders: [],
        collection: {
          overall: "complete",
          scopes: {
            process: complete(1), addon: complete(1), accounts: complete(1), strategies: complete(0),
            positions: complete(0), orders: complete(0), connections: complete(0), executions: complete(0), pnl: complete(0),
          },
        },
      },
    },
  };
}

function form(commandType: "LAUNCH_NINJATRADER" | "REQUEST_NINJATRADER_QUIT" = "LAUNCH_NINJATRADER") {
  const value = new FormData();
  value.set("agentId", agentId);
  value.set("requestId", requestId);
  value.set("commandType", commandType);
  value.set("confirmation", commandType === "LAUNCH_NINJATRADER" ? "LAUNCH NINJATRADER" : "QUIT NINJATRADER");
  return value;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireDeploymentCapability.mockReset();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-07-21T19:00:20.000Z"));
  mocks.requireUser.mockResolvedValue({
    id: "20000000-0000-4000-8000-000000000001",
    organizationId: "10000000-0000-4000-8000-000000000001",
    role: "client",
  });
  mocks.listAgents.mockResolvedValue([agent()]);
  mocks.getLatestRuntimeObservationV2.mockResolvedValue(null);
  mocks.findCommandByIdempotency.mockResolvedValue(null);
  mocks.getCommandSafetyCounts.mockResolvedValue({ inFlight: 0, indeterminate: 0 });
  mocks.createApproval.mockResolvedValue({ approvalId: "80000000-0000-4000-8000-000000000001" });
  mocks.enqueueApprovedCommand.mockResolvedValue({ duplicate: false, status: "queued" });
});

describe("local process-control action", () => {
  it("queues launch from server-derived process evidence with request idempotency", async () => {
    const result = await queueProcessControlAction(idleState, form());
    expect(result).toMatchObject({ status: "success", message: expect.stringContaining("Launch request queued") });
    expect(mocks.createApproval).toHaveBeenCalledWith(expect.objectContaining({ role: "client" }), {
      agentId,
      commandType: "LAUNCH_NINJATRADER",
      expectedProcessStateVersion: stateVersion,
      target: { installationRef },
    });
    expect(mocks.enqueueApprovedCommand).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      idempotencyKey: expect.stringContaining(requestId),
    }));
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/client");
  });

  it("queues quit only with a server-derived fresh Runtime-v2 summary", async () => {
    mocks.listAgents.mockResolvedValue([agent("running")]);
    mocks.getLatestRuntimeObservationV2.mockResolvedValue(runtime());
    const result = await queueProcessControlAction(idleState, form("REQUEST_NINJATRADER_QUIT"));
    expect(result.status).toBe("success");
    const approvalInput = mocks.createApproval.mock.calls[0][1];
    expect(approvalInput).toMatchObject({
      agentId,
      commandType: "REQUEST_NINJATRADER_QUIT",
      expectedProcessStateVersion: stateVersion,
      target: { installationRef, processRef },
      runtimeState: { summary: { armedScheduleCount: 0, commandCounts: { inFlight: 0, indeterminate: 0 } } },
    });
    expect(JSON.stringify(form("REQUEST_NINJATRADER_QUIT"))).not.toContain(processRef);
  });

  it("returns the original durable result for an exact duplicate", async () => {
    mocks.findCommandByIdempotency.mockResolvedValue({ duplicate: true, status: "queued" });
    const result = await queueProcessControlAction(idleState, form());
    expect(result).toMatchObject({ status: "success", message: expect.stringContaining("already recorded") });
    expect(mocks.getCommandSafetyCounts).not.toHaveBeenCalled();
    expect(mocks.createApproval).not.toHaveBeenCalled();
  });

  it.each([
    ["extra field", (value: FormData) => value.set("processRef", processRef)],
    ["duplicate field", (value: FormData) => value.append("agentId", agentId)],
    ["wrong phrase", (value: FormData) => value.set("confirmation", "launch ninjatrader")],
  ])("rejects %s before any repository mutation", async (_label, mutate) => {
    const value = form();
    mutate(value);
    const result = await queueProcessControlAction(idleState, value);
    expect(result.status).toBe("error");
    expect(mocks.listAgents).not.toHaveBeenCalled();
    expect(mocks.createApproval).not.toHaveBeenCalled();
  });

  it("ignores only framework $ACTION metadata", async () => {
    const value = form();
    value.append("$ACTION_ID_test", "framework");
    expect((await queueProcessControlAction(idleState, value)).status).toBe("success");
  });

  it("rejects non-client and non-local callers", async () => {
    mocks.requireUser.mockResolvedValueOnce({ role: "staff" });
    expect((await queueProcessControlAction(idleState, form())).status).toBe("error");
    mocks.requireUser.mockResolvedValue({ role: "client" });
    mocks.requireDeploymentCapability.mockImplementation(() => { throw new Error("central"); });
    expect((await queueProcessControlAction(idleState, form())).message).toContain("LOCAL_ONLY");
    expect(mocks.createApproval).not.toHaveBeenCalled();
  });

  it.each([
    ["missing process", { ...agent(), processObservation: null }, null, { inFlight: 0, indeterminate: 0 }],
    ["ambiguous process", agent("ambiguous"), null, { inFlight: 0, indeterminate: 0 }],
    ["in-flight command", agent(), null, { inFlight: 1, indeterminate: 0 }],
  ])("fails closed for %s", async (_label, selected, latest, counts) => {
    mocks.listAgents.mockResolvedValue([selected]);
    mocks.getLatestRuntimeObservationV2.mockResolvedValue(latest);
    mocks.getCommandSafetyCounts.mockResolvedValue(counts);
    const result = await queueProcessControlAction(idleState, form());
    expect(result.status).toBe("error");
    expect(mocks.createApproval).not.toHaveBeenCalled();
  });

  it("fails closed if enqueue races or evidence changes", async () => {
    mocks.enqueueApprovedCommand.mockRejectedValue(new RuntimeServiceError("CONFLICT", "changed"));
    mocks.findCommandByIdempotency.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
    const result = await queueProcessControlAction(idleState, form());
    expect(result).toEqual({ status: "error", message: "Process evidence changed before the request could be queued. Refresh and confirm again." });
  });
});
