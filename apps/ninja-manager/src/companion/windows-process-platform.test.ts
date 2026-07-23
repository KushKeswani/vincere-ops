import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import {
  processQuitRuntimeStateDigest,
  type ProcessQuitSafetySummary,
} from "@/lib/domain/process-control-contracts";
import {
  WindowsProcessPlatform,
  type ProcessTimer,
  type SpawnedProcess,
  type WindowsExecFile,
  type WindowsExecFileOptions,
  type WindowsExecFileResult,
  type WindowsSpawn,
  type WindowsSpawnOptions,
} from "@/companion/windows-process-platform";

const EXECUTABLE = "C:\\Program Files\\NinjaTrader 8\\bin\\NinjaTrader.exe";
const OTHER_EXECUTABLE = "C:\\Other\\NinjaTrader.exe";
const STARTED_AT = "2026-07-21T14:15:16.1234567Z";

interface ExecCall {
  executable: string;
  arguments_: readonly string[];
  options: WindowsExecFileOptions;
}

function createExecHarness(
  outputs: Array<WindowsExecFileResult | Error>,
): { calls: ExecCall[]; execFile: WindowsExecFile } {
  const calls: ExecCall[] = [];
  return {
    calls,
    execFile: async (executable, arguments_, options) => {
      calls.push({ executable, arguments_: [...arguments_], options: { ...options } });
      const next = outputs.shift();
      if (!next) throw new Error("No fake PowerShell result available");
      if (next instanceof Error) throw next;
      return next;
    },
  };
}

function output(value: unknown, stderr = ""): WindowsExecFileResult {
  return { stdout: typeof value === "string" ? value : JSON.stringify(value), stderr };
}

function observationOutput(
  processes: Record<string, unknown>[] = [],
  options: {
    candidateCount?: number;
    resolvedCandidateCount?: number;
    executablePath?: number;
    processId?: number;
    processMetadata?: number;
  } = {},
): WindowsExecFileResult {
  return output({
    candidateCount: options.candidateCount ?? processes.length,
    resolvedCandidateCount: options.resolvedCandidateCount ?? processes.length,
    unresolvedCandidates: {
      executablePath: options.executablePath ?? 0,
      processId: options.processId ?? 0,
      processMetadata: options.processMetadata ?? 0,
    },
    processes,
  });
}

function processRecord(
  pid: number,
  executablePath = EXECUTABLE,
  startedAt = STARTED_AT,
): Record<string, unknown> {
  return { executablePath, pid, startedAt };
}

class FakeTimer implements ProcessTimer {
  readonly waits: number[] = [];
  readonly scheduled: Array<{ callback: () => void; milliseconds: number; cleared: boolean }> = [];

  async wait(milliseconds: number): Promise<void> {
    this.waits.push(milliseconds);
  }

  set(callback: () => void, milliseconds: number): unknown {
    const handle = { callback, milliseconds, cleared: false };
    this.scheduled.push(handle);
    return handle;
  }

  clear(handle: unknown): void {
    (handle as { cleared: boolean }).cleared = true;
  }
}

interface SpawnCall {
  executable: string;
  arguments_: readonly string[];
  options: WindowsSpawnOptions;
}

function createSpawnHarness(mode: "spawn" | "error" | "throw" = "spawn"):
  { calls: SpawnCall[]; spawn: WindowsSpawn; unref: ReturnType<typeof vi.fn> } {
  const calls: SpawnCall[] = [];
  const unref = vi.fn();
  const spawn: WindowsSpawn = (executable, arguments_, options) => {
    calls.push({ executable, arguments_: [...arguments_], options: { ...options } });
    if (mode === "throw") throw new Error("synchronous spawn failure");
    const listeners: Partial<Record<"error" | "spawn", (...values: never[]) => void>> = {};
    const child: SpawnedProcess = {
      once(event: "error" | "spawn", listener: ((error: Error) => void) | (() => void)) {
        listeners[event] = listener as (...values: never[]) => void;
        if (event === mode) {
          queueMicrotask(() => {
            if (mode === "error") (listener as (error: Error) => void)(new Error("async spawn failure"));
            else (listener as () => void)();
          });
        }
        return this;
      },
      unref,
    };
    return child;
  };
  return { calls, spawn, unref };
}

function safeSummary(): ProcessQuitSafetySummary {
  return {
    armedScheduleCount: 0,
    accountCounts: { simulation: 1, evaluation: 0, funded: 0, live: 0, unknown: 0 },
    strategyCounts: { enabled: 0, unknown: 0 },
    positionCounts: { open: 0, unknown: 0 },
    orderCounts: { working: 0, transitional: 0, unknown: 0 },
    commandCounts: { inFlight: 0, indeterminate: 0 },
  };
}

describe("WindowsProcessPlatform observation", () => {
  it("queries only fixed NinjaTrader candidates and accepts only the exact allowlisted path", async () => {
    const processes = [
      processRecord(222, EXECUTABLE.toLocaleUpperCase("en-US"), STARTED_AT),
      processRecord(333, EXECUTABLE, "2026-07-21T14:16:00.000Z"),
    ];
    const exec = createExecHarness([observationOutput(processes, {
      candidateCount: 3,
      resolvedCandidateCount: 3,
    })]);
    const observedAt = new Date("2026-07-21T14:17:00.000Z");
    const platform = new WindowsProcessPlatform({ execFile: exec.execFile, now: () => observedAt });

    const observation = await platform.observe(EXECUTABLE);

    expect(observation).toEqual({
      observedAt: observedAt.toISOString(),
      processes: [
        { executablePath: EXECUTABLE, pid: 222, startedAt: STARTED_AT, state: "running" },
        { executablePath: EXECUTABLE, pid: 333, startedAt: "2026-07-21T14:16:00.000Z", state: "running" },
      ],
      runtimeState: null,
      launchReadiness: {
        state: "unknown",
        observedAt: observedAt.toISOString(),
        source: "authenticated_runtime_v2_addon_ipc",
        authenticated: false,
        reasonCode: "PROVIDER_UNAVAILABLE",
      },
    });
    expect(exec.calls).toHaveLength(1);
    const call = exec.calls[0];
    expect(call.executable).toBe("powershell.exe");
    expect(call.arguments_.slice(0, 4)).toEqual([
      "-NoLogo", "-NoProfile", "-NonInteractive", "-Command",
    ]);
    expect(call.arguments_[4]).toContain("SELECT ProcessId, ExecutablePath FROM Win32_Process WHERE Name = 'NinjaTrader.exe'");
    expect(call.arguments_[4]).toContain("$candidateCount += 1");
    expect(call.arguments_[4]).toContain("unresolvedCandidates = [pscustomobject]");
    expect(call.arguments_[4]).not.toContain("catch { }");
    expect(call.arguments_[4]).not.toContain(EXECUTABLE);
    expect(call.arguments_.slice(5)).toEqual([EXECUTABLE]);
    expect(call.options).toEqual({
      encoding: "utf8",
      maxBuffer: 64 * 1_024,
      timeout: 5_000,
      windowsHide: true,
      shell: false,
    });
  });

  it("returns a validated authoritative quit state and converts provider failure to null", async () => {
    const summary = safeSummary();
    const runtimeObservedAt = "2026-07-21T14:16:59.000Z";
    const runtimeState = {
      observedAt: runtimeObservedAt,
      digest: processQuitRuntimeStateDigest(runtimeObservedAt, summary),
      summary,
    };
    const goodExec = createExecHarness([observationOutput()]);
    const good = new WindowsProcessPlatform({
      execFile: goodExec.execFile,
      now: () => new Date("2026-07-21T14:17:00.000Z"),
      runtimeStateProvider: async () => runtimeState,
    });
    expect((await good.observe(EXECUTABLE)).runtimeState).toEqual(runtimeState);

    const failedExec = createExecHarness([observationOutput()]);
    const failed = new WindowsProcessPlatform({
      execFile: failedExec.execFile,
      runtimeStateProvider: async () => { throw new Error("provider unavailable"); },
    });
    expect((await failed.observe(EXECUTABLE)).runtimeState).toBeNull();
  });

  it("loads only strict injected Add-On readiness and fails closed on absence, error, or invalid data", async () => {
    const observedAt = new Date("2026-07-21T14:17:00.000Z");
    const ready = {
      state: "ready" as const,
      observedAt: observedAt.toISOString(),
      source: "authenticated_runtime_v2_addon_ipc" as const,
      authenticated: true as const,
      reasonCode: null,
    };
    const good = new WindowsProcessPlatform({
      execFile: createExecHarness([observationOutput()]).execFile,
      now: () => observedAt,
      launchReadinessProvider: async () => ready,
    });
    expect((await good.observe(EXECUTABLE)).launchReadiness).toEqual(ready);

    for (const [provider, reasonCode] of [
      [async () => { throw new Error("provider unavailable"); }, "PROVIDER_ERROR"],
      [async () => ({ state: "ready", authenticated: false }), "PROVIDER_INVALID_RESPONSE"],
      [async () => null, "PROVIDER_UNAVAILABLE"],
    ] as const) {
      const platform = new WindowsProcessPlatform({
        execFile: createExecHarness([observationOutput()]).execFile,
        now: () => observedAt,
        launchReadinessProvider: provider,
      });
      expect((await platform.observe(EXECUTABLE)).launchReadiness).toEqual({
        state: "unknown",
        observedAt: observedAt.toISOString(),
        source: "authenticated_runtime_v2_addon_ipc",
        authenticated: false,
        reasonCode,
      });
    }
  });

  it("rejects duplicate exact identities instead of manufacturing ambiguity", async () => {
    const exec = createExecHarness([
      observationOutput([processRecord(222), processRecord(222)]),
    ]);
    await expect(new WindowsProcessPlatform({ execFile: exec.execFile }).observe(EXECUTABLE))
      .rejects.toThrow(/Duplicate exact/);
  });

  it("rejects an unexpected executable record instead of silently dropping it", async () => {
    const exec = createExecHarness([observationOutput([
      processRecord(111, OTHER_EXECUTABLE),
    ])]);
    await expect(new WindowsProcessPlatform({ execFile: exec.execFile }).observe(EXECUTABLE))
      .rejects.toThrow("NinjaTrader process observation response was inconsistent");
  });

  it.each([
    ["invalid JSON", output("not-json"), /invalid JSON/],
    ["invalid schema", output({ candidates: [] }), /response was invalid/],
    ["diagnostic stderr", output({
      candidateCount: 0,
      resolvedCandidateCount: 0,
      unresolvedCandidates: { executablePath: 0, processId: 0, processMetadata: 0 },
      processes: [],
    }, "unexpected"), /diagnostic output/],
    ["invalid start time", observationOutput([
      processRecord(222, EXECUTABLE, "not-a-date"),
    ]), /start time/],
  ])("rejects %s", async (_label, result, expected) => {
    const exec = createExecHarness([result as WindowsExecFileResult]);
    await expect(new WindowsProcessPlatform({ execFile: exec.execFile }).observe(EXECUTABLE))
      .rejects.toThrow(expected as RegExp);
  });

  it("enforces the output cap even when an injected runner violates maxBuffer", async () => {
    const exec = createExecHarness([output({
      candidateCount: 0,
      resolvedCandidateCount: 0,
      unresolvedCandidates: { executablePath: 0, processId: 0, processMetadata: 0 },
      processes: [],
      padding: "x".repeat(200),
    })]);
    const platform = new WindowsProcessPlatform(
      { execFile: exec.execFile },
      { maxOutputBytes: 64 },
    );
    await expect(platform.observe(EXECUTABLE)).rejects.toThrow(/size boundary/);
    expect(exec.calls[0].options.maxBuffer).toBe(64);
  });

  it("propagates a PowerShell timeout without changing local state", async () => {
    const timeout = Object.assign(new Error(`timed out ${EXECUTABLE} pid 222`), {
      code: "ETIMEDOUT",
    });
    const exec = createExecHarness([timeout]);
    const platform = new WindowsProcessPlatform({ execFile: exec.execFile }, { commandTimeoutMs: 250 });
    const error = await platform.observe(EXECUTABLE).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("NinjaTrader process observation failed");
    expect((error as Error).message).not.toContain(EXECUTABLE);
    expect((error as Error).message).not.toContain("222");
    expect(exec.calls[0].options.timeout).toBe(250);
  });

  it.each([
    ["null-path candidate", { candidateCount: 1, resolvedCandidateCount: 0, executablePath: 1 }],
    ["malformed candidate", { candidateCount: 1, resolvedCandidateCount: 0, processId: 1 }],
    ["inaccessible required metadata", {
      candidateCount: 1,
      resolvedCandidateCount: 0,
      processMetadata: 1,
    }],
    ["mixed exact and unresolved candidates", {
      candidateCount: 2,
      resolvedCandidateCount: 1,
      executablePath: 1,
    }],
  ])("fails closed for a %s without spawning or closing", async (_label, unresolved) => {
    const records = unresolved.resolvedCandidateCount === 1 ? [processRecord(222)] : [];
    const exec = createExecHarness([observationOutput(records, unresolved)]);
    const spawn = createSpawnHarness();
    const platform = new WindowsProcessPlatform({ execFile: exec.execFile, spawn: spawn.spawn });

    const error = await platform.observe(EXECUTABLE).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("NinjaTrader process observation was incomplete");
    expect((error as Error).message).not.toContain(EXECUTABLE);
    expect((error as Error).message).not.toContain("222");
    expect(spawn.calls).toEqual([]);
    expect(exec.calls).toHaveLength(1);
    expect(exec.calls[0].arguments_[4]).not.toContain("CloseMainWindow");
  });

  it("accepts a clean zero-candidate observation", async () => {
    const exec = createExecHarness([observationOutput()]);
    const platform = new WindowsProcessPlatform({ execFile: exec.execFile });

    expect((await platform.observe(EXECUTABLE)).processes).toEqual([]);
  });

  it("accepts a clean exact candidate observation", async () => {
    const exec = createExecHarness([observationOutput([processRecord(222)])]);
    const platform = new WindowsProcessPlatform({ execFile: exec.execFile });

    expect((await platform.observe(EXECUTABLE)).processes).toEqual([{
      executablePath: EXECUTABLE,
      pid: 222,
      startedAt: STARTED_AT,
      state: "running",
    }]);
  });

  it.each([
    ["candidate count above its bound", observationOutput([], {
      candidateCount: 101,
      resolvedCandidateCount: 101,
    }), /response was invalid/],
    ["inconsistent candidate totals", observationOutput([], {
      candidateCount: 1,
      resolvedCandidateCount: 0,
    }), /response was inconsistent/],
  ])("rejects a %s", async (_label, result, expected) => {
    const exec = createExecHarness([result as WindowsExecFileResult]);
    await expect(new WindowsProcessPlatform({ execFile: exec.execFile }).observe(EXECUTABLE))
      .rejects.toThrow(expected as RegExp);
  });
});

describe("WindowsProcessPlatform launch", () => {
  it("spawns the exact validated executable visibly with zero arguments and no overrides", async () => {
    const spawn = createSpawnHarness();
    const timer = new FakeTimer();
    const platform = new WindowsProcessPlatform({
      spawn: spawn.spawn,
      timer,
      environment: {
        SystemRoot: "C:\\Windows",
        windir: "C:\\Windows",
        Path: "C:\\Windows\\System32",
        TEMP: "C:\\Temp",
        TMP: undefined,
        USERPROFILE: "C:\\Users\\Operator",
        DATABASE_URL: "secret-database",
        PHOENIX_DASHBOARD_PASSWORD: "secret-password",
        VINCERE_AGENT_TOKEN: "secret-token",
        AUTH_SECRET: "secret-auth",
        API_KEY: "secret-key",
      },
    });

    await platform.start(EXECUTABLE);

    expect(spawn.calls).toEqual([{
      executable: EXECUTABLE,
      arguments_: [],
      options: {
        cwd: "C:\\Program Files\\NinjaTrader 8\\bin",
        shell: false,
        windowsHide: false,
        detached: true,
        stdio: "ignore",
        env: {
          SystemRoot: "C:\\Windows",
          WINDIR: "C:\\Windows",
          USERPROFILE: "C:\\Users\\Operator",
          TEMP: "C:\\Temp",
          PATH: "C:\\Windows\\System32",
        },
      },
    }]);
    expect(spawn.calls[0].options.env).not.toHaveProperty("DATABASE_URL");
    expect(spawn.calls[0].options.env).not.toHaveProperty("PHOENIX_DASHBOARD_PASSWORD");
    expect(spawn.calls[0].options.env).not.toHaveProperty("VINCERE_AGENT_TOKEN");
    expect(spawn.calls[0].options.env).not.toHaveProperty("AUTH_SECRET");
    expect(spawn.calls[0].options.env).not.toHaveProperty("API_KEY");
    expect(spawn.calls[0].options).not.toHaveProperty("uid");
    expect(spawn.calls[0].options).not.toHaveProperty("gid");
    expect(spawn.unref).toHaveBeenCalledOnce();
    expect(timer.scheduled[0].cleared).toBe(true);
  });

  it.each(["error", "throw"] as const)("propagates a %s spawn failure", async (mode) => {
    const spawn = createSpawnHarness(mode);
    const platform = new WindowsProcessPlatform({ spawn: spawn.spawn, timer: new FakeTimer() });
    await expect(platform.start(EXECUTABLE)).rejects.toThrow(/spawn failure/);
  });

  it.each([
    "C:\\Windows\\System32\\cmd.exe",
    "\\\\server\\share\\NinjaTrader.exe",
    "\\\\?\\C:\\NinjaTrader 8\\bin\\NinjaTrader.exe",
  ])("rejects unsafe launch path %s before spawn", async (unsafePath) => {
    const spawn = createSpawnHarness();
    const platform = new WindowsProcessPlatform({ spawn: spawn.spawn });
    await expect(platform.start(unsafePath)).rejects.toThrow(/NinjaTrader executable/);
    expect(spawn.calls).toEqual([]);
  });
});

describe("WindowsProcessPlatform graceful close and tombstone", () => {
  it("passes PID, normalized path, and UTC start separately to a fixed revalidation script", async () => {
    const exec = createExecHarness([output({ matched: true, closeRequested: true })]);
    const platform = new WindowsProcessPlatform({ execFile: exec.execFile });

    await platform.requestGracefulClose({
      executablePath: EXECUTABLE,
      pid: 222,
      startedAt: STARTED_AT,
    });

    const call = exec.calls[0];
    const script = call.arguments_[4];
    expect(script).not.toContain(EXECUTABLE);
    expect(script).toContain("[int]$_.ProcessId -eq $ExpectedPid");
    expect(script).toContain("StringComparison]::OrdinalIgnoreCase");
    expect(script).toContain("$actualStart.Ticks -ne $expectedStart.Ticks");
    expect(script).toContain("$process.CloseMainWindow()");
    expect(call.arguments_.slice(5)).toEqual(["222", EXECUTABLE, STARTED_AT]);
  });

  it.each([
    [{ matched: false, closeRequested: false }, /not reverified/],
    [{ matched: true, closeRequested: false }, /did not accept/],
  ])("throws when close result is %j", async (result, expected) => {
    const exec = createExecHarness([output(result)]);
    const platform = new WindowsProcessPlatform({ execFile: exec.execFile });
    await expect(platform.requestGracefulClose({
      executablePath: EXECUTABLE,
      pid: 222,
      startedAt: STARTED_AT,
    })).rejects.toThrow(expected);
  });

  it("propagates an actuation runner error", async () => {
    const failure = new Error("PowerShell outcome unknown");
    const exec = createExecHarness([failure]);
    const platform = new WindowsProcessPlatform({ execFile: exec.execFile });
    await expect(platform.requestGracefulClose({
      executablePath: EXECUTABLE,
      pid: 222,
      startedAt: STARTED_AT,
    })).rejects.toBe(failure);
  });

  it("emits one exact stopped tombstone after disappearance and expires it", async () => {
    const exec = createExecHarness([
      observationOutput([processRecord(222)]),
      observationOutput(),
      observationOutput(),
    ]);
    let nowMs = Date.parse("2026-07-21T14:17:00.000Z");
    const platform = new WindowsProcessPlatform(
      { execFile: exec.execFile, now: () => new Date(nowMs) },
      { tombstoneTtlMs: 1_000 },
    );

    expect((await platform.observe(EXECUTABLE)).processes).toEqual([{
      executablePath: EXECUTABLE,
      pid: 222,
      startedAt: STARTED_AT,
      state: "running",
    }]);
    nowMs += 100;
    expect((await platform.observe(EXECUTABLE)).processes).toEqual([{
      executablePath: EXECUTABLE,
      pid: 222,
      startedAt: STARTED_AT,
      state: "stopped",
    }]);
    nowMs += 1_000;
    expect((await platform.observe(EXECUTABLE)).processes).toEqual([]);
  });
});

describe("WindowsProcessPlatform static safety surface", () => {
  it("contains no broad or destructive process-control primitives", () => {
    const source = readFileSync(new URL("./windows-process-platform.ts", import.meta.url), "utf8");
    const forbidden = [
      "task" + "kill",
      "Stop" + "-Process",
      ".K" + "ill(",
      ".Ter" + "minate(",
      "Command" + "Line",
      "MainWindow" + "Title",
      "shell: true",
    ];
    for (const token of forbidden) expect(source).not.toContain(token);
    expect(source.match(/WHERE Name = 'NinjaTrader\.exe'/g)).toHaveLength(2);
  });
});
