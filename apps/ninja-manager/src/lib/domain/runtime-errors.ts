export type RuntimeErrorCode =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "AGENT_NOT_FOUND"
  | "COMMAND_NOT_FOUND"
  | "CONFLICT"
  | "SEQUENCE_STALE"
  | "SEQUENCE_GAP"
  | "COMMAND_EXPIRED"
  | "INVALID_TRANSITION"
  | "INVALID_DELIVERY";

const statusByCode: Record<RuntimeErrorCode, number> = {
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  AGENT_NOT_FOUND: 404,
  COMMAND_NOT_FOUND: 404,
  CONFLICT: 409,
  SEQUENCE_STALE: 409,
  SEQUENCE_GAP: 409,
  COMMAND_EXPIRED: 410,
  INVALID_TRANSITION: 409,
  INVALID_DELIVERY: 409,
};

export class RuntimeServiceError extends Error {
  readonly status: number;

  constructor(
    readonly code: RuntimeErrorCode,
    message: string,
    readonly details: Readonly<Record<string, string | number>> = {},
  ) {
    super(message);
    this.name = "RuntimeServiceError";
    this.status = statusByCode[code];
  }
}
