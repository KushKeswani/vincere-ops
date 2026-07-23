import {
  processObservationSchema,
  type ProcessObservation,
} from "@/lib/domain/runtime-contracts";

import {
  deriveProcessRef,
  deriveProcessStateVersion,
  parseProcessPlatformObservation,
  selectExactProcessRecords,
  type ProcessPlatformObservation,
} from "./process-controller";

export interface ProcessObservationInput {
  installationRef: string;
  executablePath: string;
  identitySecret: Uint8Array;
  observation: ProcessPlatformObservation;
}

/**
 * Converts one controller-owned OS observation into the privacy-safe wire shape. The process
 * state version and process reference deliberately call the controller's shared derivation.
 */
export function createProcessObservation(input: ProcessObservationInput): ProcessObservation {
  const observation = parseProcessPlatformObservation(input.observation);
  const records = selectExactProcessRecords(input.executablePath, observation.processes);
  const active = records.filter((record) => record.state !== "stopped");
  const processStateVersion = deriveProcessStateVersion(
    input.installationRef,
    input.executablePath,
    records,
    input.identitySecret,
  );
  const base = {
    observedAt: observation.observedAt,
    installationRef: input.installationRef,
    processStateVersion,
  };

  if (active.length === 0) {
    return processObservationSchema.parse({
      ...base,
      state: "not_running",
      processRef: null,
      matchedProcessCount: 0,
      unavailableReason: null,
    });
  }
  if (active.length === 1 && active[0].state === "running") {
    return processObservationSchema.parse({
      ...base,
      state: "running",
      processRef: deriveProcessRef(input.identitySecret, active[0]),
      matchedProcessCount: 1,
      unavailableReason: null,
    });
  }
  return processObservationSchema.parse({
    ...base,
    state: "ambiguous",
    processRef: null,
    matchedProcessCount: active.length,
    unavailableReason: active.length > 1
      ? "MULTIPLE_ACTIVE_PROCESSES"
      : "TRANSITIONAL_PROCESS_STATE",
  });
}

export function createUnavailableProcessObservation(input: {
  observedAt: string;
  installationRef: string;
  reason: "OBSERVATION_FAILED" | "OBSERVATION_TIME_INVALID";
}): ProcessObservation {
  return processObservationSchema.parse({
    observedAt: input.observedAt,
    installationRef: input.installationRef,
    state: "unknown",
    processStateVersion: null,
    processRef: null,
    matchedProcessCount: null,
    unavailableReason: input.reason,
  });
}
