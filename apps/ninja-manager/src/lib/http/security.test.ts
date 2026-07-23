import { describe, expect, it } from "vitest";

import { RuntimeServiceError } from "@/lib/domain/runtime-errors";
import { apiError, readBoundedJson, RequestValidationError } from "./security";

describe("bounded API request security", () => {
  it("parses a bounded application/json body", async () => {
    const request = new Request("http://localhost/api", {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ ok: true }),
    });
    await expect(readBoundedJson(request, 1_024)).resolves.toEqual({ ok: true });
  });

  it("rejects unsupported content types and invalid JSON", async () => {
    const text = new Request("http://localhost/api", {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: "{}",
    });
    await expect(readBoundedJson(text, 1_024)).rejects.toMatchObject({
      status: 415,
      code: "INVALID_CONTENT_TYPE",
    });

    const invalid = new Request("http://localhost/api", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{",
    });
    await expect(readBoundedJson(invalid, 1_024)).rejects.toMatchObject({
      status: 400,
      code: "INVALID_JSON",
    });
  });

  it("rejects declared and streamed bodies above the byte limit", async () => {
    const declared = new Request("http://localhost/api", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": "9999",
      },
      body: "{}",
    });
    await expect(readBoundedJson(declared, 32)).rejects.toMatchObject({
      status: 413,
      code: "PAYLOAD_TOO_LARGE",
    });

    const streamed = new Request("http://localhost/api", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: "x".repeat(100) }),
    });
    await expect(readBoundedJson(streamed, 32)).rejects.toBeInstanceOf(RequestValidationError);
  });

  it("maps typed runtime errors without exposing implementation details", async () => {
    const response = apiError(new RuntimeServiceError(
      "SEQUENCE_GAP",
      "Replay the durable outbox in order",
      { expectedNextSequence: 7 },
    ));
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "Replay the durable outbox in order",
      code: "SEQUENCE_GAP",
      details: { expectedNextSequence: 7 },
    });

    const unauthorized = apiError(new RuntimeServiceError("UNAUTHORIZED", "Invalid credential"));
    expect(unauthorized.status).toBe(401);
    expect(unauthorized.headers.get("www-authenticate")).toBe("Bearer");
  });
});
