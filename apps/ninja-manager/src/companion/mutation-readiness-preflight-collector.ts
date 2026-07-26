import { randomUUID } from "node:crypto";

import { z } from "zod";

import { type LocalIpcCommand } from "./local-ipc";
import {
  addonMutationReadinessPayloadSchema,
  MAX_MUTATION_READINESS_AGE_MS,
  mutationReadinessPreflightSchema,
  type MutationReadinessPreflight,
} from "@/lib/domain/mutation-readiness-preflight";

const configSchema = z.object({
  pipeName: z.string().regex(/^[A-Za-z0-9._-]{3,80}$/),
  freshnessMaxAgeMs: z.number().int().min(1).max(MAX_MUTATION_READINESS_AGE_MS),
}).strict();

export interface AuthenticatedMutationReadinessIpcSender {
  send(input: {
    command: LocalIpcCommand;
    payload: Record<string, never>;
    secret: Buffer;
    pipeName: string;
  }): Promise<{ payload: unknown }>;
}

export class MutationReadinessPreflightCollector {
  private readonly config: z.output<typeof configSchema>;
  private readonly localIpcSecret: Buffer;

  constructor(
    config: z.input<typeof configSchema>,
    private readonly dependencies: {
      ipcSender: AuthenticatedMutationReadinessIpcSender;
      localIpcSecret: Buffer;
      now(): Date;
      uuid?(): string;
    },
  ) {
    this.config = configSchema.parse(config);
    if (!Buffer.isBuffer(dependencies.localIpcSecret)
      || dependencies.localIpcSecret.length !== 32) {
      throw new Error("Local IPC secret must contain exactly 32 bytes");
    }
    this.localIpcSecret = Buffer.from(dependencies.localIpcSecret);
  }

  async collect(): Promise<MutationReadinessPreflight> {
    const result = await this.dependencies.ipcSender.send({
      command: "GET_MUTATION_READINESS_PREFLIGHT",
      payload: {},
      secret: Buffer.from(this.localIpcSecret),
      pipeName: this.config.pipeName,
    });
    const addon = addonMutationReadinessPayloadSchema.parse(result.payload);
    const receivedAtDate = this.dependencies.now();
    if (!(receivedAtDate instanceof Date) || !Number.isFinite(receivedAtDate.getTime())) {
      throw new Error("Collector clock must return a valid Date");
    }
    const completedAtMs = Date.parse(addon.completedAt);
    if (completedAtMs > receivedAtDate.getTime() + 1_000) {
      throw new Error("Mutation readiness response completion time is in the future");
    }
    const expiresAtMs = completedAtMs + this.config.freshnessMaxAgeMs;
    if (receivedAtDate.getTime() > expiresAtMs) {
      throw new Error("Mutation readiness response is stale");
    }

    return mutationReadinessPreflightSchema.parse({
      protocolVersion: "mutation-readiness-preflight/1.0",
      preflightId: (this.dependencies.uuid ?? randomUUID)(),
      receivedAt: receivedAtDate.toISOString(),
      expiresAt: new Date(expiresAtMs).toISOString(),
      source: {
        command: "GET_MUTATION_READINESS_PREFLIGHT",
        transport: "authenticated_local_ipc",
        ipcAuthenticated: true,
      },
      addon,
    });
  }
}
