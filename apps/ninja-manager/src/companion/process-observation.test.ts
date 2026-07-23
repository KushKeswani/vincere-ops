import { describe, expect, it } from "vitest";

import {
  deriveProcessRef,
  deriveProcessStateVersion,
  type PlatformProcessRecord,
} from "./process-controller";
import {
  createProcessObservation,
  createUnavailableProcessObservation,
} from "./process-observation";

const INSTALLATION_REF = "install_1234567890abcdef";
const EXECUTABLE = "C:\\Program Files\\NinjaTrader 8\\bin\\NinjaTrader.exe";
const OTHER_EXECUTABLE = "D:\\NinjaTrader 8\\bin\\NinjaTrader.exe";
const SECRET = Buffer.alloc(32, 7);
const OBSERVED_AT = "2026-07-21T15:00:00.000Z";

function record(
  state: PlatformProcessRecord["state"],
  overrides: Partial<PlatformProcessRecord> = {},
): PlatformProcessRecord {
  return {
    executablePath: EXECUTABLE,
    pid: 9232,
    startedAt: "2026-07-21T14:00:00.000Z",
    state,
    ...overrides,
  };
}

function create(records: PlatformProcessRecord[]) {
  return createProcessObservation({
    installationRef: INSTALLATION_REF,
    executablePath: EXECUTABLE,
    identitySecret: SECRET,
    observation: { observedAt: OBSERVED_AT, processes: records, runtimeState: null },
  });
}

describe("process-only heartbeat evidence", () => {
  it("publishes one exact running process with controller-identical references and no raw identity", () => {
    const running = record("running");
    const evidence = create([running]);

    expect(evidence).toEqual({
      observedAt: OBSERVED_AT,
      installationRef: INSTALLATION_REF,
      state: "running",
      processStateVersion: deriveProcessStateVersion(
        INSTALLATION_REF,
        EXECUTABLE,
        [running],
        SECRET,
      ),
      processRef: deriveProcessRef(SECRET, running),
      matchedProcessCount: 1,
      unavailableReason: null,
    });
    expect(JSON.stringify(evidence)).not.toContain("NinjaTrader.exe");
    expect(JSON.stringify(evidence)).not.toContain("9232");
  });

  it("publishes a controller-compatible exact not-running state despite stopped tombstones", () => {
    const stopped = record("stopped");
    const evidence = create([stopped]);

    expect(evidence).toMatchObject({
      state: "not_running",
      processRef: null,
      matchedProcessCount: 0,
      unavailableReason: null,
      processStateVersion: deriveProcessStateVersion(
        INSTALLATION_REF,
        EXECUTABLE,
        [stopped],
        SECRET,
      ),
    });
  });

  it("withholds exact process identity for transitional and multiple active matches", () => {
    expect(create([record("waiting_for_login")])).toMatchObject({
      state: "ambiguous",
      processRef: null,
      matchedProcessCount: 1,
      unavailableReason: "TRANSITIONAL_PROCESS_STATE",
    });
    expect(create([
      record("running"),
      record("running", { pid: 9233, startedAt: "2026-07-21T14:00:01.000Z" }),
    ])).toMatchObject({
      state: "ambiguous",
      processRef: null,
      matchedProcessCount: 2,
      unavailableReason: "MULTIPLE_ACTIVE_PROCESSES",
    });
  });

  it("uses the controller's exact path filter before counting or deriving state", () => {
    const foreign = record("running", { executablePath: OTHER_EXECUTABLE, pid: 100 });
    expect(create([foreign])).toMatchObject({
      state: "not_running",
      matchedProcessCount: 0,
      processStateVersion: deriveProcessStateVersion(
        INSTALLATION_REF,
        EXECUTABLE,
        [],
        SECRET,
      ),
    });
  });

  it("represents collection failure without a state version, ref, or false process count", () => {
    expect(createUnavailableProcessObservation({
      observedAt: OBSERVED_AT,
      installationRef: INSTALLATION_REF,
      reason: "OBSERVATION_FAILED",
    })).toEqual({
      observedAt: OBSERVED_AT,
      installationRef: INSTALLATION_REF,
      state: "unknown",
      processStateVersion: null,
      processRef: null,
      matchedProcessCount: null,
      unavailableReason: "OBSERVATION_FAILED",
    });
  });
});
