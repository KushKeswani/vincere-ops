import { beforeEach, describe, expect, it, vi } from "vitest";

import type { LatestRuntimeObservationV2 } from "@/lib/repositories/runtime-repository";

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  requireDeploymentCapability: vi.fn(),
  getLatestRuntimeObservationV2: vi.fn(),
  captureManualSnapshot: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/auth/session", () => ({ requireUser: mocks.requireUser }));
vi.mock("@/lib/deployment/server", () => ({
  requireDeploymentCapability: mocks.requireDeploymentCapability,
}));
vi.mock("@/lib/repositories/runtime-repository", () => ({
  getRuntimeRepository: () => ({ getLatestRuntimeObservationV2: mocks.getLatestRuntimeObservationV2 }),
}));
vi.mock("@/lib/repositories/eod-snapshot-repository", () => ({
  getEodSnapshotRepository: () => ({ captureManualSnapshot: mocks.captureManualSnapshot }),
}));

import { captureEodSnapshotAction } from "./eod";

const idle = { status: "idle" as const, message: "" };
const user = {
  id: "20000000-0000-4000-8000-000000000001",
  organizationId: "10000000-0000-4000-8000-000000000001",
  email: "operator@test.local",
  name: "Local Operator",
  role: "client" as const,
};

function form(overrides: { agentId?: string; requestId?: string } = {}): FormData {
  const data = new FormData();
  data.set("agentId", overrides.agentId ?? "40000000-0000-4000-8000-000000000001");
  data.set("requestId", overrides.requestId ?? "50000000-0000-4000-8000-000000000001");
  return data;
}

function latest(): LatestRuntimeObservationV2 {
  const now = Date.now();
  const asOf = new Date(now - 1_000).toISOString();
  const occurredAt = new Date(now - 800);
  return {
    eventId: "60000000-0000-4000-8000-000000000001",
    occurredAt,
    receivedAt: new Date(now - 400),
    observation: {
      asOf,
      freshness: { status: "fresh", ageMs: 200, maxAgeMs: 45_000 },
    },
  } as unknown as LatestRuntimeObservationV2;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireUser.mockResolvedValue(user);
  mocks.requireDeploymentCapability.mockImplementation(() => undefined);
  mocks.getLatestRuntimeObservationV2.mockResolvedValue(latest());
  mocks.captureManualSnapshot.mockResolvedValue({ duplicate: false, snapshot: {} });
});

describe("EOD capture Server Action", () => {
  it("authenticates as a client before using local repositories", async () => {
    mocks.requireUser.mockRejectedValue(new Error("unauthenticated"));

    await expect(captureEodSnapshotAction(idle, form())).rejects.toThrow("unauthenticated");
    expect(mocks.requireDeploymentCapability).not.toHaveBeenCalled();
    expect(mocks.getLatestRuntimeObservationV2).not.toHaveBeenCalled();
  });

  it("denies direct central invocation before reading runtime or EOD evidence", async () => {
    mocks.requireDeploymentCapability.mockImplementation(() => {
      throw new Error("central");
    });

    const result = await captureEodSnapshotAction(idle, form());

    expect(result).toEqual({ status: "error", message: "EOD capture is available only from the local operator dashboard." });
    expect(mocks.requireUser).toHaveBeenCalledWith(["client"]);
    expect(mocks.requireDeploymentCapability).toHaveBeenCalledWith("transport.local");
    expect(mocks.getLatestRuntimeObservationV2).not.toHaveBeenCalled();
    expect(mocks.captureManualSnapshot).not.toHaveBeenCalled();
  });

  it("rejects invalid, duplicate, or extra caller fields before any source lookup", async () => {
    const invalidAgent = await captureEodSnapshotAction(idle, form({ agentId: "not-an-agent" }));
    const invalidRequest = await captureEodSnapshotAction(idle, form({ requestId: "not-a-request" }));
    const duplicate = form();
    duplicate.append("agentId", "40000000-0000-4000-8000-000000000002");
    const duplicateResult = await captureEodSnapshotAction(idle, duplicate);
    const extra = form();
    extra.set("sourceEventId", "70000000-0000-4000-8000-000000000001");
    const extraResult = await captureEodSnapshotAction(idle, extra);

    expect(invalidAgent.status).toBe("error");
    expect(invalidRequest.status).toBe("error");
    expect(duplicateResult.status).toBe("error");
    expect(extraResult.status).toBe("error");
    expect(mocks.getLatestRuntimeObservationV2).not.toHaveBeenCalled();
    expect(mocks.captureManualSnapshot).not.toHaveBeenCalled();
  });

  it("requires a latest fresh authenticated source and never invokes capture without one", async () => {
    mocks.getLatestRuntimeObservationV2.mockResolvedValue(null);
    const absent = await captureEodSnapshotAction(idle, form());
    mocks.getLatestRuntimeObservationV2.mockResolvedValue({
      ...latest(),
      observation: { ...latest().observation, freshness: { status: "stale", ageMs: 60_000, maxAgeMs: 45_000 } },
    });
    const stale = await captureEodSnapshotAction(idle, form());

    expect(absent.message).toContain("fresh authenticated Runtime v2");
    expect(stale.message).toContain("fresh authenticated Runtime v2");
    expect(mocks.captureManualSnapshot).not.toHaveBeenCalled();
  });

  it("uses the exact server-read event and never accepts source content from the browser", async () => {
    const data = form();

    const result = await captureEodSnapshotAction(idle, data);

    expect(result.status).toBe("success");
    expect(mocks.getLatestRuntimeObservationV2).toHaveBeenCalledWith(
      user,
      "40000000-0000-4000-8000-000000000001",
    );
    expect(mocks.captureManualSnapshot).toHaveBeenCalledWith(user, {
      agentId: "40000000-0000-4000-8000-000000000001",
      sourceEventId: "60000000-0000-4000-8000-000000000001",
      idempotencyKey: "eod:manual:50000000-0000-4000-8000-000000000001",
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/client/activity");
  });

  it("reports an idempotent replay without claiming a new capture", async () => {
    mocks.captureManualSnapshot.mockResolvedValue({ duplicate: true, snapshot: {} });

    const result = await captureEodSnapshotAction(idle, form());

    expect(result).toEqual({
      status: "success",
      message: "This exact EOD capture request was already completed; the original immutable snapshot was retained.",
    });
  });

  it("does not expose repository exception details", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.captureManualSnapshot.mockRejectedValue(new Error("database credential secret"));

    const result = await captureEodSnapshotAction(idle, form());

    expect(result).toEqual({ status: "error", message: "The EOD snapshot could not be captured safely." });
    expect(JSON.stringify(result)).not.toContain("database");
    expect(JSON.stringify(result)).not.toContain("secret");
    error.mockRestore();
  });
});
