import { beforeEach, describe, expect, it, vi } from "vitest";

import { RuntimeServiceError } from "@/lib/domain/runtime-errors";

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  requireDeploymentCapability: vi.fn(),
  enqueueReadOnlyCommand: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/auth/session", () => ({ requireUser: mocks.requireUser }));
vi.mock("@/lib/deployment/server", () => ({
  requireDeploymentCapability: mocks.requireDeploymentCapability,
}));
vi.mock("@/lib/repositories/runtime-repository", () => ({
  getRuntimeRepository: () => ({ enqueueReadOnlyCommand: mocks.enqueueReadOnlyCommand }),
}));

import { queueRuntimeDiscoveryAction } from "./runtime";

const idleState = { status: "idle" as const, message: "" };

function validFormData(): FormData {
  const formData = new FormData();
  formData.set("agentId", "50000000-0000-4000-8000-000000000001");
  formData.set("requestId", "60000000-0000-4000-8000-000000000001");
  formData.set("expectedStateVersion", "");
  return formData;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireUser.mockResolvedValue({
    id: "20000000-0000-4000-8000-000000000001",
    organizationId: "10000000-0000-4000-8000-000000000001",
    email: "staff@test.local",
    name: "Staff User",
    role: "staff",
  });
});

describe("runtime action commit boundary", () => {
  it.each([
    [false, "Read-only discovery queued"],
    [true, "already queued"],
  ])("preserves the queued success result when refresh fails (duplicate=%s)", async (duplicate, expectedMessage) => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    mocks.enqueueReadOnlyCommand.mockResolvedValue({ duplicate });
    mocks.revalidatePath.mockImplementation(() => {
      throw new Error("cache unavailable");
    });

    const result = await queueRuntimeDiscoveryAction(idleState, validFormData());

    expect(result.status).toBe("success");
    expect(result.message).toContain(expectedMessage);
    expect(mocks.enqueueReadOnlyCommand).toHaveBeenCalledTimes(1);
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/staff/runtime");
    expect(warning).toHaveBeenCalled();
    warning.mockRestore();
  });

  it("allows the loopback operator to queue the same read-only command and refreshes Operator", async () => {
    mocks.requireUser.mockResolvedValue({
      id: "30000000-0000-4000-8000-000000000001",
      organizationId: "10000000-0000-4000-8000-000000000001",
      email: "operator@test.local",
      name: "Local Operator",
      role: "client",
    });
    mocks.enqueueReadOnlyCommand.mockResolvedValue({ duplicate: false });

    const result = await queueRuntimeDiscoveryAction(idleState, validFormData());

    expect(result.status).toBe("success");
    expect(mocks.requireUser).toHaveBeenCalledWith(["staff", "client"]);
    expect(mocks.requireDeploymentCapability).toHaveBeenNthCalledWith(1, "transport.local");
    expect(mocks.requireDeploymentCapability).toHaveBeenNthCalledWith(2, "runtime.queue");
    expect(mocks.enqueueReadOnlyCommand).toHaveBeenCalledWith(
      expect.objectContaining({ role: "client" }),
      expect.objectContaining({
        commandType: "DISCOVER_RUNTIME_STATE",
        dryRun: true,
        idempotencyKey: expect.stringMatching(/^local-runtime-refresh:/),
      }),
    );
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/client");
  });

  it("fails closed when a client identity has no loopback transport capability", async () => {
    mocks.requireUser.mockResolvedValue({
      id: "30000000-0000-4000-8000-000000000001",
      organizationId: "10000000-0000-4000-8000-000000000001",
      email: "client@test.local",
      name: "Central Client",
      role: "client",
    });
    mocks.requireDeploymentCapability.mockImplementation((capability: string) => {
      if (capability === "transport.local") throw new Error("unavailable");
    });

    const result = await queueRuntimeDiscoveryAction(idleState, validFormData());

    expect(result).toEqual({
      status: "error",
      message: "Read-only runtime discovery is unavailable in this deployment mode.",
    });
    expect(mocks.enqueueReadOnlyCommand).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("returns a service error and never refreshes when enqueue did not commit", async () => {
    mocks.enqueueReadOnlyCommand.mockRejectedValue(
      new RuntimeServiceError("CONFLICT", "The command conflicts with the current runtime state."),
    );

    const result = await queueRuntimeDiscoveryAction(idleState, validFormData());

    expect(result).toEqual({ status: "error", message: "The command conflicts with the current runtime state." });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});
