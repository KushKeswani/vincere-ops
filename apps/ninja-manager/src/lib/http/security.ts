import "server-only";

import { ZodError } from "zod";

import { RuntimeServiceError } from "@/lib/domain/runtime-errors";

export class RequestValidationError extends Error {
  constructor(
    readonly status: number,
    readonly code: "INVALID_CONTENT_TYPE" | "PAYLOAD_TOO_LARGE" | "INVALID_JSON" | "CROSS_ORIGIN",
    message: string,
  ) {
    super(message);
    this.name = "RequestValidationError";
  }
}

export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  const expected = process.env.APP_URL ?? new URL(request.url).origin;
  if (!origin || origin !== expected) {
    throw new RequestValidationError(403, "CROSS_ORIGIN", "Cross-origin mutation rejected");
  }
}

export async function readBoundedJson(request: Request, maximumBytes: number): Promise<unknown> {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  if (contentType !== "application/json") {
    throw new RequestValidationError(415, "INVALID_CONTENT_TYPE", "Content-Type must be application/json");
  }
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    throw new RequestValidationError(413, "PAYLOAD_TOO_LARGE", "Request body exceeds the allowed size");
  }
  if (!request.body) throw new RequestValidationError(400, "INVALID_JSON", "A JSON request body is required");

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > maximumBytes) {
      await reader.cancel();
      throw new RequestValidationError(413, "PAYLOAD_TOO_LARGE", "Request body exceeds the allowed size");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
  } catch {
    throw new RequestValidationError(400, "INVALID_JSON", "Request body must contain valid UTF-8 JSON");
  }
}

export function apiError(error: unknown): Response {
  if (error instanceof RuntimeServiceError) {
    const headers = error.status === 401 ? { "WWW-Authenticate": "Bearer" } : undefined;
    return Response.json(
      { error: error.message, code: error.code, details: error.details },
      { status: error.status, headers },
    );
  }
  if (error instanceof RequestValidationError) {
    return Response.json({ error: error.message, code: error.code }, { status: error.status });
  }
  if (error instanceof ZodError) {
    return Response.json(
      { error: error.issues[0]?.message ?? "Request validation failed", code: "VALIDATION_ERROR" },
      { status: 400 },
    );
  }
  console.error("Unhandled Ninja Manager API error");
  return Response.json({ error: "The request could not be completed", code: "INTERNAL_ERROR" }, { status: 500 });
}
