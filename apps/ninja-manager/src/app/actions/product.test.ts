import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  class IdempotencyConflictError extends Error {
    constructor(message = "This request key was already used for a different operation") {
      super(message);
      this.name = "IdempotencyConflictError";
    }
  }
  class EmailIdentityConflictError extends Error {
    constructor() {
      super("This email is already assigned to a Ninja Manager identity");
      this.name = "EmailIdentityConflictError";
    }
  }
  return {
    EmailIdentityConflictError,
    IdempotencyConflictError,
    requireUser: vi.fn(),
    setKillSwitch: vi.fn(),
    revalidatePath: vi.fn(),
  };
});

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/auth/session", () => ({ requireUser: mocks.requireUser }));
vi.mock("@/lib/deployment/server", () => ({ requireDeploymentCapability: vi.fn() }));
vi.mock("@/lib/repositories/ninja-repository", () => ({
  EmailIdentityConflictError: mocks.EmailIdentityConflictError,
  IdempotencyConflictError: mocks.IdempotencyConflictError,
  getNinjaRepository: () => ({ setKillSwitch: mocks.setKillSwitch }),
}));

import { setKillSwitchAction } from "./product";

const idleState = { status: "idle" as const, message: "" };
const requestId = "30000000-0000-4000-8000-000000000001";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireUser.mockResolvedValue({
    id: "20000000-0000-4000-8000-000000000001",
    organizationId: "10000000-0000-4000-8000-000000000001",
    email: "staff@test.local",
    name: "Staff User",
    role: "staff",
  });
  mocks.setKillSwitch.mockResolvedValue(undefined);
});

describe("product action commit boundary", () => {
  it("returns success and attempts every refresh after a committed mutation", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    mocks.revalidatePath.mockImplementationOnce(() => {
      throw new Error("cache unavailable");
    });
    const formData = new FormData();
    formData.set("enabled", "true");
    formData.set("requestId", requestId);

    const result = await setKillSwitchAction(idleState, formData);

    expect(result).toMatchObject({ status: "success", message: "Global operational kill switch enabled." });
    expect(result.requestId).not.toBe(requestId);
    expect(mocks.setKillSwitch).toHaveBeenCalledWith(expect.objectContaining({ role: "staff" }), true, requestId);
    expect(mocks.revalidatePath.mock.calls.map(([path]) => path)).toEqual(["/staff", "/client"]);
    expect(warning).toHaveBeenCalledWith(
      "Ninja Manager cache revalidation failed after a committed operation",
      { path: "/staff" },
    );
    warning.mockRestore();
  });

  it("masks an unknown mutation error, sanitizes logging, and never refreshes", async () => {
    const failure = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.setKillSwitch.mockRejectedValueOnce(new Error("Organization not found."));
    const formData = new FormData();
    formData.set("enabled", "false");
    formData.set("requestId", requestId);

    const result = await setKillSwitchAction(idleState, formData);

    expect(result).toEqual({
      status: "error",
      message: "The operation could not be completed. Retry with the same request ID.",
      values: undefined,
      requestId,
    });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
    expect(failure).toHaveBeenCalledWith("Ninja Manager action failed safely");
    expect(JSON.stringify(failure.mock.calls)).not.toContain("Organization not found");
    failure.mockRestore();
  });

  it("retains a valid request ID when field validation fails", async () => {
    const formData = new FormData();
    formData.set("enabled", "invalid");
    formData.set("requestId", requestId);

    const result = await setKillSwitchAction(idleState, formData);

    expect(result).toMatchObject({ status: "error", requestId });
    expect(mocks.setKillSwitch).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("returns the explicit safe message for a known email identity conflict", async () => {
    const failure = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.setKillSwitch.mockRejectedValueOnce(new mocks.EmailIdentityConflictError());
    const formData = new FormData();
    formData.set("enabled", "true");
    formData.set("requestId", requestId);

    const result = await setKillSwitchAction(idleState, formData);

    expect(result).toEqual({
      status: "error",
      message: "This email is already assigned to a Ninja Manager identity",
      values: undefined,
      requestId,
    });
    expect(failure).not.toHaveBeenCalled();
    failure.mockRestore();
  });

  it("returns an explicit conflict and rotates the request ID", async () => {
    mocks.setKillSwitch.mockRejectedValueOnce(
      new mocks.IdempotencyConflictError("This request key was already used for a different operation"),
    );
    const formData = new FormData();
    formData.set("enabled", "true");
    formData.set("requestId", requestId);

    const result = await setKillSwitchAction(idleState, formData);

    expect(result).toMatchObject({ status: "error" });
    expect(result.message).toContain("Request conflict:");
    expect(result.requestId).not.toBe(requestId);
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});
