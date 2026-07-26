import { z } from "zod";

import { type LocalIpcCommand } from "./local-ipc";
import {
  assembleNinjaTraderAddonRuntimeObservationV2,
  companionRuntimeObservationV2MetadataSchema,
  rawNinjaTraderAddonSnapshotV2Schema,
  type CompanionRuntimeObservationV2Metadata,
} from "./runtime-adapter-v2";
import { type RuntimeObservationV2 } from "@/lib/domain/runtime-observation-v2";

const localIdSchema = z.string().min(1).max(1_024);
const pipeNameSchema = z.string().regex(/^[A-Za-z0-9._-]{3,80}$/);

export const runtimeObservationV2CollectorConfigSchema = z.object({
  installationLocalId: localIdSchema,
  collectionSessionLocalId: localIdSchema,
  freshnessMaxAgeMs: z.number().int().min(1).max(3_600_000),
  pipeName: pipeNameSchema,
}).strict();

export type RuntimeObservationV2CollectorConfig = z.input<
  typeof runtimeObservationV2CollectorConfigSchema
>;

/**
 * A local, authenticated IPC implementation such as sendLocalIpcCommand.
 * The collector always supplies the only command and payload it is permitted to use.
 */
export interface AuthenticatedRuntimeObservationIpcSender {
  send(input: {
    command: LocalIpcCommand;
    payload: Record<string, never>;
    secret: Buffer;
    pipeName: string;
  }): Promise<{ payload: unknown }>;
}

export interface RuntimeObservationV2ProcessQuery {
  installationLocalId: string;
  receivedAt: string;
}

export const companionProcessObservationV2Schema = companionRuntimeObservationV2MetadataSchema
  .pick({ process: true, processCollectionScope: true })
  .strict()
  .superRefine((value, context) => {
    if (value.process === null && value.processCollectionScope.status === "complete") {
      context.addIssue({
        code: "custom",
        message: "A missing process observation cannot be reported as complete",
        path: ["processCollectionScope", "status"],
      });
    }
    if (value.process !== null && value.processCollectionScope.status === "unavailable") {
      context.addIssue({
        code: "custom",
        message: "An unavailable process scope cannot claim a process observation",
        path: ["process"],
      });
    }
  });

export type CompanionProcessObservationV2 = z.infer<
  typeof companionProcessObservationV2Schema
>;

export interface RuntimeObservationV2ProcessProvider {
  observe(input: RuntimeObservationV2ProcessQuery): Promise<unknown>;
}

export interface RuntimeObservationV2ManagerLedgerQuery {
  installationLocalId: string;
  collectionSessionLocalId: string;
  accountLocalIds: readonly string[];
  runtimeObservedAt: string;
  receivedAt: string;
}

export type ManagerObservedCumulativeByAccountLocalId =
  CompanionRuntimeObservationV2Metadata["managerObservedCumulativeByAccountLocalId"];

export interface RuntimeObservationV2ManagerLedgerProvider {
  readCumulativePnl(input: RuntimeObservationV2ManagerLedgerQuery): Promise<unknown>;
}

export interface RuntimeObservationV2CollectorDependencies {
  ipcSender: AuthenticatedRuntimeObservationIpcSender;
  processProvider: RuntimeObservationV2ProcessProvider;
  managerLedgerProvider: RuntimeObservationV2ManagerLedgerProvider;
  localIpcSecret: Buffer;
  identitySecret: Buffer;
  uuid(): string;
  now(): Date;
}

function copyExactSecret(secret: Buffer, label: string): Buffer {
  if (!Buffer.isBuffer(secret) || secret.length !== 32) {
    throw new Error(`${label} must contain exactly 32 bytes`);
  }
  return Buffer.from(secret);
}

function receiptTimestamp(now: Date): string {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new Error("Collector clock must return a valid Date");
  }
  return now.toISOString();
}

/**
 * Collects one additive v2 observation without owning scheduling, persistence, or retries.
 * IPC/authentication/schema failures deliberately propagate to the caller.
 */
export class RuntimeObservationV2Collector {
  private readonly config: z.output<typeof runtimeObservationV2CollectorConfigSchema>;
  private readonly localIpcSecret: Buffer;
  private readonly identitySecret: Buffer;

  constructor(
    configInput: RuntimeObservationV2CollectorConfig,
    private readonly dependencies: RuntimeObservationV2CollectorDependencies,
  ) {
    this.config = runtimeObservationV2CollectorConfigSchema.parse(configInput);
    this.localIpcSecret = copyExactSecret(dependencies.localIpcSecret, "Local IPC secret");
    this.identitySecret = copyExactSecret(dependencies.identitySecret, "Identity secret");
  }

  async collect(): Promise<RuntimeObservationV2> {
    const ipcResult = await this.dependencies.ipcSender.send({
      command: "GET_RUNTIME_OBSERVATION_V2",
      payload: {},
      secret: Buffer.from(this.localIpcSecret),
      pipeName: this.config.pipeName,
    });
    const addon = rawNinjaTraderAddonSnapshotV2Schema.parse(ipcResult.payload);

    // Preserve the Add-On receipt boundary for dependent local providers, then
    // sample the final receipt only after all companion-owned evidence exists.
    const addonReceivedAt = receiptTimestamp(this.dependencies.now());
    const processEvidence = companionProcessObservationV2Schema.parse(
      await this.dependencies.processProvider.observe({
        installationLocalId: this.config.installationLocalId,
        receivedAt: addonReceivedAt,
      }),
    );
    const accountLocalIds = Object.freeze(addon.accounts.map((account) => account.localId));
    const managerObservedCumulativeByAccountLocalId =
      await this.dependencies.managerLedgerProvider.readCumulativePnl({
        installationLocalId: this.config.installationLocalId,
        collectionSessionLocalId: this.config.collectionSessionLocalId,
        accountLocalIds,
        runtimeObservedAt: addon.observedAt,
        receivedAt: addonReceivedAt,
      });
    const receivedAt = receiptTimestamp(this.dependencies.now());

    const metadata = companionRuntimeObservationV2MetadataSchema.parse({
      observationId: z.uuid().parse(this.dependencies.uuid()),
      installationLocalId: this.config.installationLocalId,
      collectionSessionLocalId: this.config.collectionSessionLocalId,
      receivedAt,
      freshnessMaxAgeMs: this.config.freshnessMaxAgeMs,
      process: processEvidence.process,
      processCollectionScope: processEvidence.processCollectionScope,
      managerObservedCumulativeByAccountLocalId,
    });

    return assembleNinjaTraderAddonRuntimeObservationV2(
      addon,
      metadata,
      Buffer.from(this.identitySecret),
    );
  }
}
