import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  class IdempotencyConflictError extends Error {
    constructor(message = "This request key was already used for a different operation") {
      super(message);
      this.name = "IdempotencyConflictError";
    }
  }

  return {
    IdempotencyConflictError,
    createClient: vi.fn(),
    getCurrentUser: vi.fn(),
    listClients: vi.fn(),
  };
});

vi.mock("@/lib/auth/session", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/lib/repositories/ninja-repository", () => ({
  IdempotencyConflictError: mocks.IdempotencyConflictError,
  getNinjaRepository: () => ({
    createClient: mocks.createClient,
    listClients: mocks.listClients,
  }),
}));

import { GET, POST } from "./route";

const staffUser = {
  id: "20000000-0000-4000-8000-000000000001",
  organizationId: "10000000-0000-4000-8000-000000000001",
  email: "staff@test.local",
  name: "Staff User",
  role: "staff" as const,
};
const requestId = "30000000-0000-4000-8000-000000000001";
const clientId = "40000000-0000-4000-8000-000000000001";
const appOrigin = new URL(process.env.APP_URL ?? "http://localhost").origin;
const validPayload = {
  name: "  Test Client  ",
  email: "  CLIENT@Example.COM  ",
  temporaryPassword: "  TempPass123!  ",
  phone: "  +1 212 555 0100  ",
  timezone: "America/Chicago",
};

function createPostRequest(idempotencyKey?: string): Request {
  const headers = new Headers({
    "Content-Type": "application/json",
    Origin: appOrigin,
  });
  if (idempotencyKey !== undefined) headers.set("Idempotency-Key", idempotencyKey);
  return new Request(`${appOrigin}/api/v1/clients`, {
    method: "POST",
    headers,
    body: JSON.stringify(validPayload),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCurrentUser.mockResolvedValue(staffUser);
  mocks.createClient.mockResolvedValue(clientId);
  mocks.listClients.mockResolvedValue([]);
});

describe("clients API", () => {
  it("forwards the validated client payload, raw temporary password, and exact idempotency key", async () => {
    const response = await POST(createPostRequest(requestId));

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({ data: { id: clientId } });
    expect(mocks.createClient).toHaveBeenCalledWith(
      staffUser,
      {
        name: "Test Client",
        email: "client@example.com",
        temporaryPassword: validPayload.temporaryPassword,
        phone: "+1 212 555 0100",
        timezone: "America/Chicago",
      },
      requestId,
    );
  });

  it.each([
    ["missing", undefined],
    ["invalid", "not-a-uuid"],
  ])("rejects a %s idempotency key before calling the repository", async (_label, key) => {
    const response = await POST(createPostRequest(key));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "A valid request ID is required",
      code: "VALIDATION_ERROR",
    });
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("maps repository idempotency conflicts to an explicit 409 response", async () => {
    mocks.createClient.mockRejectedValueOnce(
      new mocks.IdempotencyConflictError("This client request key was reused with different credentials"),
    );

    const response = await POST(createPostRequest(requestId));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "This client request key was reused with different credentials",
      code: "IDEMPOTENCY_CONFLICT",
    });
  });

  it("preserves the staff-scoped GET response mapping", async () => {
    mocks.listClients.mockResolvedValueOnce([
      {
        id: clientId,
        display_name: "Test Client",
        email: "client@example.com",
        phone: "+1 212 555 0100",
        timezone: "America/Chicago",
        onboarding_status: "complete",
        user_status: "active",
        created_at: new Date("2026-07-14T12:00:00.000Z"),
      },
    ]);

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: [{
        id: clientId,
        name: "Test Client",
        email: "client@example.com",
        onboardingStatus: "complete",
        timezone: "America/Chicago",
      }],
    });
    expect(mocks.listClients).toHaveBeenCalledWith(staffUser);
  });

  it("preserves GET authentication and staff authorization boundaries", async () => {
    mocks.getCurrentUser.mockResolvedValueOnce(null);
    const unauthorized = await GET();
    expect(unauthorized.status).toBe(401);
    await expect(unauthorized.json()).resolves.toEqual({ error: "Unauthorized" });

    mocks.getCurrentUser.mockResolvedValueOnce({ ...staffUser, role: "client" });
    const forbidden = await GET();
    expect(forbidden.status).toBe(403);
    await expect(forbidden.json()).resolves.toEqual({ error: "Forbidden" });
    expect(mocks.listClients).not.toHaveBeenCalled();
  });
});
