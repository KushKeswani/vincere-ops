import {
  execFile as nodeExecFile,
  spawn as nodeSpawn,
  type ChildProcess,
  type SpawnOptions,
} from "node:child_process";
import path from "node:path";

import { z } from "zod";

import {
  type ExactProcessTarget,
  type PlatformProcessRecord,
  type ProcessPlatform,
  type ProcessPlatformObservation,
} from "@/companion/process-controller";
import {
  launchReadinessObservationSchema,
  processQuitRuntimeStateSchema,
  type LaunchReadinessObservation,
} from "@/lib/domain/process-control-contracts";

const POWERSHELL_EXECUTABLE = "powershell.exe";
const DEFAULT_COMMAND_TIMEOUT_MS = 5_000;
const DEFAULT_MAX_OUTPUT_BYTES = 64 * 1_024;
const DEFAULT_TOMBSTONE_TTL_MS = 10_000;
const DEFAULT_SPAWN_CONFIRMATION_TIMEOUT_MS = 5_000;
const MAX_PROCESS_CANDIDATES = 100;
const MAX_PROCESS_RECORDS = 100;
const SAFE_WINDOWS_ENVIRONMENT_KEYS = [
  "SystemRoot",
  "WINDIR",
  "USERPROFILE",
  "APPDATA",
  "LOCALAPPDATA",
  "TEMP",
  "TMP",
  "PATH",
  "PATHEXT",
  "HOMEDRIVE",
  "HOMEPATH",
  "COMPUTERNAME",
  "USERNAME",
  "USERDOMAIN",
  "SESSIONNAME",
] as const;

const OBSERVE_SCRIPT = String.raw`
param([Parameter(Mandatory = $true)][string]$ExpectedPath)
$ErrorActionPreference = 'Stop'

function Convert-ToCanonicalLocalPath([string]$Value) {
    if ([string]::IsNullOrWhiteSpace($Value)) { return $null }
    try {
        $full = [System.IO.Path]::GetFullPath($Value)
        if ($full -notmatch '^[A-Za-z]:\\') { return $null }
        if ($full.Substring(2).Contains(':')) { return $null }
        return $full
    }
    catch { return $null }
}

$canonicalExpected = Convert-ToCanonicalLocalPath $ExpectedPath
if ($null -eq $canonicalExpected) { throw 'Invalid expected executable path.' }

$records = @()
$candidateCount = 0
$resolvedCandidateCount = 0
$unresolvedExecutablePathCount = 0
$unresolvedProcessIdCount = 0
$unresolvedProcessMetadataCount = 0
$candidates = @(Get-CimInstance -Query "SELECT ProcessId, ExecutablePath FROM Win32_Process WHERE Name = 'NinjaTrader.exe'")
foreach ($candidate in $candidates) {
    $candidateCount += 1

    [int]$candidatePid = 0
    if ($null -eq $candidate.ProcessId -or
        -not [int]::TryParse([string]$candidate.ProcessId, [ref]$candidatePid) -or
        $candidatePid -le 0) {
        $unresolvedProcessIdCount += 1
        continue
    }

    $candidatePath = Convert-ToCanonicalLocalPath ([string]$candidate.ExecutablePath)
    if ($null -eq $candidatePath) {
        $unresolvedExecutablePathCount += 1
        continue
    }
    if (-not [string]::Equals($candidatePath, $canonicalExpected, [System.StringComparison]::OrdinalIgnoreCase)) {
        $resolvedCandidateCount += 1
        continue
    }

    try {
        $process = Get-Process -Id $candidatePid -ErrorAction Stop
        $startedAt = $process.StartTime.ToUniversalTime().ToString('o')
    }
    catch {
        $unresolvedProcessMetadataCount += 1
        continue
    }

    $resolvedCandidateCount += 1
    $records += [pscustomobject]@{
        executablePath = $canonicalExpected
        pid = $candidatePid
        startedAt = $startedAt
    }
}

[pscustomobject]@{
    candidateCount = $candidateCount
    resolvedCandidateCount = $resolvedCandidateCount
    unresolvedCandidates = [pscustomobject]@{
        executablePath = $unresolvedExecutablePathCount
        processId = $unresolvedProcessIdCount
        processMetadata = $unresolvedProcessMetadataCount
    }
    processes = @($records)
} | ConvertTo-Json -Compress -Depth 4
`;

const CLOSE_SCRIPT = String.raw`
param(
    [Parameter(Mandatory = $true)][int]$ExpectedPid,
    [Parameter(Mandatory = $true)][string]$ExpectedPath,
    [Parameter(Mandatory = $true)][string]$ExpectedStartedAt
)
$ErrorActionPreference = 'Stop'

function Convert-ToCanonicalLocalPath([string]$Value) {
    if ([string]::IsNullOrWhiteSpace($Value)) { return $null }
    try {
        $full = [System.IO.Path]::GetFullPath($Value)
        if ($full -notmatch '^[A-Za-z]:\\') { return $null }
        if ($full.Substring(2).Contains(':')) { return $null }
        return $full
    }
    catch { return $null }
}

$canonicalExpected = Convert-ToCanonicalLocalPath $ExpectedPath
if ($null -eq $canonicalExpected) { throw 'Invalid expected executable path.' }
$expectedStart = [DateTimeOffset]::Parse(
    $ExpectedStartedAt,
    [System.Globalization.CultureInfo]::InvariantCulture,
    [System.Globalization.DateTimeStyles]::RoundtripKind
).UtcDateTime

$candidate = Get-CimInstance -Query "SELECT ProcessId, ExecutablePath FROM Win32_Process WHERE Name = 'NinjaTrader.exe'" |
    Where-Object { [int]$_.ProcessId -eq $ExpectedPid } |
    Select-Object -First 1

if ($null -eq $candidate) {
    [pscustomobject]@{ matched = $false; closeRequested = $false } | ConvertTo-Json -Compress
    exit 0
}

$candidatePath = Convert-ToCanonicalLocalPath ([string]$candidate.ExecutablePath)
if ($null -eq $candidatePath -or
    -not [string]::Equals($candidatePath, $canonicalExpected, [System.StringComparison]::OrdinalIgnoreCase)) {
    [pscustomobject]@{ matched = $false; closeRequested = $false } | ConvertTo-Json -Compress
    exit 0
}

$process = Get-Process -Id $ExpectedPid -ErrorAction Stop
$actualStart = $process.StartTime.ToUniversalTime()
if ($actualStart.Ticks -ne $expectedStart.Ticks) {
    [pscustomobject]@{ matched = $false; closeRequested = $false } | ConvertTo-Json -Compress
    exit 0
}

$closeRequested = [bool]$process.CloseMainWindow()
[pscustomobject]@{ matched = $true; closeRequested = $closeRequested } | ConvertTo-Json -Compress
`;

const rawObservationSchema = z.object({
  candidateCount: z.number().int().nonnegative().max(MAX_PROCESS_CANDIDATES),
  resolvedCandidateCount: z.number().int().nonnegative().max(MAX_PROCESS_CANDIDATES),
  unresolvedCandidates: z.object({
    executablePath: z.number().int().nonnegative().max(MAX_PROCESS_CANDIDATES),
    processId: z.number().int().nonnegative().max(MAX_PROCESS_CANDIDATES),
    processMetadata: z.number().int().nonnegative().max(MAX_PROCESS_CANDIDATES),
  }).strict(),
  processes: z.array(z.object({
    executablePath: z.string().min(1).max(1_024),
    pid: z.number().int().positive().max(2_147_483_647),
    startedAt: z.string().min(1).max(100),
  }).strict()).max(MAX_PROCESS_RECORDS),
}).strict();

const closeResultSchema = z.object({
  matched: z.boolean(),
  closeRequested: z.boolean(),
}).strict();

export interface WindowsExecFileOptions {
  encoding: "utf8";
  maxBuffer: number;
  timeout: number;
  windowsHide: true;
  shell: false;
}

export interface WindowsExecFileResult {
  stdout: string;
  stderr: string;
}

export type WindowsExecFile = (
  executable: string,
  arguments_: readonly string[],
  options: WindowsExecFileOptions,
) => Promise<WindowsExecFileResult>;

export interface SpawnedProcess {
  once(event: "error", listener: (error: Error) => void): this;
  once(event: "spawn", listener: () => void): this;
  unref(): void;
}

export interface WindowsSpawnOptions {
  cwd: string;
  shell: false;
  windowsHide: false;
  detached: true;
  stdio: "ignore";
  env: Record<string, string>;
}

export type WindowsSpawn = (
  executable: string,
  arguments_: readonly string[],
  options: WindowsSpawnOptions,
) => SpawnedProcess;

export interface ProcessTimer {
  wait(milliseconds: number): Promise<void>;
  set(callback: () => void, milliseconds: number): unknown;
  clear(handle: unknown): void;
}

type RuntimeState = z.infer<typeof processQuitRuntimeStateSchema>;

export interface WindowsProcessPlatformDependencies {
  execFile?: WindowsExecFile;
  spawn?: WindowsSpawn;
  now?: () => Date;
  timer?: ProcessTimer;
  runtimeStateProvider?: () => Promise<RuntimeState | null>;
  launchReadinessProvider?: () => Promise<unknown>;
  environment?: Readonly<Record<string, string | undefined>>;
}

export interface WindowsProcessPlatformOptions {
  commandTimeoutMs?: number;
  maxOutputBytes?: number;
  tombstoneTtlMs?: number;
  spawnConfirmationTimeoutMs?: number;
}

interface Tombstone {
  record: PlatformProcessRecord;
  expiresAtMs: number;
}

const defaultTimer: ProcessTimer = {
  wait: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  set: (callback, milliseconds) => setTimeout(callback, milliseconds),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

const defaultExecFile: WindowsExecFile = (executable, arguments_, options) =>
  new Promise((resolve, reject) => {
    nodeExecFile(executable, [...arguments_], options, (error, stdout, stderr) => {
      if (error) {
        reject(error);
        return;
      }
      resolve({ stdout, stderr });
    });
  });

const defaultSpawn: WindowsSpawn = (executable, arguments_, options) =>
  nodeSpawn(executable, [...arguments_], options as SpawnOptions) as ChildProcess;

function positiveBoundedInteger(
  value: number | undefined,
  fallback: number,
  maximum: number,
  label: string,
): number {
  const resolved = value ?? fallback;
  if (!Number.isInteger(resolved) || resolved <= 0 || resolved > maximum) {
    throw new Error(`${label} must be a positive integer no greater than ${maximum}`);
  }
  return resolved;
}

function normalizedExecutablePath(value: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 1_024 || value.includes("\0")) {
    throw new Error("Invalid NinjaTrader executable path");
  }
  const normalized = path.win32.normalize(value);
  if (
    !path.win32.isAbsolute(normalized)
    || !/^[A-Za-z]:\\/.test(normalized)
    || normalized.slice(2).includes(":")
    || path.win32.basename(normalized).toLocaleLowerCase("en-US") !== "ninjatrader.exe"
  ) {
    throw new Error("NinjaTrader executable must be an exact local drive path");
  }
  return normalized;
}

function canonicalExecutablePath(value: string): string {
  return normalizedExecutablePath(value).toLocaleLowerCase("en-US");
}

function exactProcessKey(record: ExactProcessTarget): string {
  const startedAt = validatedUtcTimestamp(record.startedAt);
  if (!Number.isInteger(record.pid) || record.pid <= 0 || record.pid > 2_147_483_647) {
    throw new Error("Invalid NinjaTrader process identifier");
  }
  return `${canonicalExecutablePath(record.executablePath)}\0${record.pid}\0${startedAt}`;
}

function validatedUtcTimestamp(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,7})?Z$/.test(value)) {
    throw new Error("NinjaTrader process start time must be an exact UTC timestamp");
  }
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) throw new Error("Invalid NinjaTrader process start time");
  return value;
}

function parseJsonOutput(output: WindowsExecFileResult, maximumBytes: number): unknown {
  if (output.stderr.length > 0) throw new Error("PowerShell returned diagnostic output");
  const byteLength = Buffer.byteLength(output.stdout, "utf8") + Buffer.byteLength(output.stderr, "utf8");
  if (byteLength === 0 || byteLength > maximumBytes) throw new Error("PowerShell output violated its size boundary");
  try {
    return JSON.parse(output.stdout) as unknown;
  } catch {
    throw new Error("PowerShell returned invalid JSON");
  }
}

function powershellArguments(script: string, values: readonly string[]): string[] {
  return [
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    script,
    ...values,
  ];
}

function sanitizedWindowsEnvironment(
  source: Readonly<Record<string, string | undefined>>,
): Record<string, string> {
  const sourceByCanonicalName = new Map<string, string>();
  for (const [key, value] of Object.entries(source).sort(([left], [right]) => left.localeCompare(right))) {
    if (value === undefined) continue;
    const canonicalName = key.toLocaleLowerCase("en-US");
    if (!sourceByCanonicalName.has(canonicalName)) sourceByCanonicalName.set(canonicalName, value);
  }

  const sanitized: Record<string, string> = {};
  for (const allowedKey of SAFE_WINDOWS_ENVIRONMENT_KEYS) {
    const value = sourceByCanonicalName.get(allowedKey.toLocaleLowerCase("en-US"));
    if (value !== undefined) sanitized[allowedKey] = value;
  }
  return sanitized;
}

/** Windows-only, local adapter for the already-validated process-control contract. */
export class WindowsProcessPlatform implements ProcessPlatform {
  private readonly execFile: WindowsExecFile;
  private readonly spawn: WindowsSpawn;
  private readonly clock: () => Date;
  private readonly timer: ProcessTimer;
  private readonly runtimeStateProvider: (() => Promise<RuntimeState | null>) | null;
  private readonly launchReadinessProvider: (() => Promise<unknown>) | null;
  private readonly spawnEnvironment: Record<string, string>;
  private readonly commandTimeoutMs: number;
  private readonly maxOutputBytes: number;
  private readonly tombstoneTtlMs: number;
  private readonly spawnConfirmationTimeoutMs: number;
  private readonly active = new Map<string, PlatformProcessRecord>();
  private readonly tombstones = new Map<string, Tombstone>();

  constructor(
    dependencies: WindowsProcessPlatformDependencies = {},
    options: WindowsProcessPlatformOptions = {},
  ) {
    this.execFile = dependencies.execFile ?? defaultExecFile;
    this.spawn = dependencies.spawn ?? defaultSpawn;
    this.clock = dependencies.now ?? (() => new Date());
    this.timer = dependencies.timer ?? defaultTimer;
    this.runtimeStateProvider = dependencies.runtimeStateProvider ?? null;
    this.launchReadinessProvider = dependencies.launchReadinessProvider ?? null;
    this.spawnEnvironment = sanitizedWindowsEnvironment(dependencies.environment ?? process.env);
    this.commandTimeoutMs = positiveBoundedInteger(
      options.commandTimeoutMs,
      DEFAULT_COMMAND_TIMEOUT_MS,
      30_000,
      "commandTimeoutMs",
    );
    this.maxOutputBytes = positiveBoundedInteger(
      options.maxOutputBytes,
      DEFAULT_MAX_OUTPUT_BYTES,
      1_048_576,
      "maxOutputBytes",
    );
    this.tombstoneTtlMs = positiveBoundedInteger(
      options.tombstoneTtlMs,
      DEFAULT_TOMBSTONE_TTL_MS,
      30_000,
      "tombstoneTtlMs",
    );
    this.spawnConfirmationTimeoutMs = positiveBoundedInteger(
      options.spawnConfirmationTimeoutMs,
      DEFAULT_SPAWN_CONFIRMATION_TIMEOUT_MS,
      30_000,
      "spawnConfirmationTimeoutMs",
    );
  }

  now(): Date {
    const value = this.clock();
    if (!Number.isFinite(value.getTime())) throw new Error("Invalid process-platform clock");
    return new Date(value.getTime());
  }

  wait(milliseconds: number): Promise<void> {
    if (!Number.isInteger(milliseconds) || milliseconds < 0 || milliseconds > 30_000) {
      throw new Error("Invalid process observation delay");
    }
    return this.timer.wait(milliseconds);
  }

  async observe(executablePath: string): Promise<ProcessPlatformObservation> {
    const expectedPath = normalizedExecutablePath(executablePath);
    let result: WindowsExecFileResult;
    try {
      result = await this.runPowerShell(OBSERVE_SCRIPT, [expectedPath]);
    } catch {
      throw new Error("NinjaTrader process observation failed");
    }
    const parsed = rawObservationSchema.safeParse(parseJsonOutput(result, this.maxOutputBytes));
    if (!parsed.success) throw new Error("NinjaTrader process observation response was invalid");
    const raw = parsed.data;
    const unresolvedCandidateCount = raw.unresolvedCandidates.executablePath
      + raw.unresolvedCandidates.processId
      + raw.unresolvedCandidates.processMetadata;
    if (raw.resolvedCandidateCount + unresolvedCandidateCount !== raw.candidateCount) {
      throw new Error("NinjaTrader process observation response was inconsistent");
    }
    if (raw.processes.length > raw.resolvedCandidateCount) {
      throw new Error("NinjaTrader process observation response was inconsistent");
    }
    if (unresolvedCandidateCount > 0) {
      throw new Error("NinjaTrader process observation was incomplete");
    }
    const expectedCanonical = canonicalExecutablePath(expectedPath);
    const records: PlatformProcessRecord[] = [];
    const seen = new Set<string>();

    for (const candidate of raw.processes) {
      let candidatePath: string;
      try {
        candidatePath = normalizedExecutablePath(candidate.executablePath);
      } catch {
        throw new Error("NinjaTrader process observation response was invalid");
      }
      if (canonicalExecutablePath(candidatePath) !== expectedCanonical) {
        throw new Error("NinjaTrader process observation response was inconsistent");
      }
      const record: PlatformProcessRecord = {
        executablePath: expectedPath,
        pid: candidate.pid,
        startedAt: validatedUtcTimestamp(candidate.startedAt),
        state: "running",
      };
      const key = exactProcessKey(record);
      if (seen.has(key)) throw new Error("Duplicate exact NinjaTrader process observation");
      seen.add(key);
      records.push(record);
    }

    const observedAt = this.now();
    this.expireTombstones(observedAt.getTime());
    for (const [key, previous] of this.active) {
      if (canonicalExecutablePath(previous.executablePath) !== expectedCanonical || seen.has(key)) continue;
      this.tombstones.set(key, {
        record: { ...previous, state: "stopped" },
        expiresAtMs: observedAt.getTime() + this.tombstoneTtlMs,
      });
      this.active.delete(key);
    }
    for (const record of records) {
      const key = exactProcessKey(record);
      this.active.set(key, record);
      this.tombstones.delete(key);
    }

    const stopped = [...this.tombstones]
      .filter(([, tombstone]) => canonicalExecutablePath(tombstone.record.executablePath) === expectedCanonical)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([, tombstone]) => ({ ...tombstone.record }));
    const runtimeState = await this.loadRuntimeState();
    const launchReadiness = await this.loadLaunchReadiness(observedAt.toISOString());

    return {
      observedAt: observedAt.toISOString(),
      processes: [...records, ...stopped],
      runtimeState,
      launchReadiness,
    };
  }

  async start(executablePath: string): Promise<void> {
    const executable = normalizedExecutablePath(executablePath);
    const child = this.spawn(executable, [], {
      cwd: path.win32.dirname(executable),
      shell: false,
      windowsHide: false,
      detached: true,
      stdio: "ignore",
      env: { ...this.spawnEnvironment },
    });

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      let timeoutHandle: unknown = null;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        if (timeoutHandle !== null) this.timer.clear(timeoutHandle);
        if (error) reject(error);
        else resolve();
      };
      timeoutHandle = this.timer.set(
        () => finish(new Error("NinjaTrader process start was not acknowledged")),
        this.spawnConfirmationTimeoutMs,
      );
      child.once("error", (error) => finish(error));
      child.once("spawn", () => finish());
      child.unref();
    });
  }

  async requestGracefulClose(target: ExactProcessTarget): Promise<void> {
    const executablePath = normalizedExecutablePath(target.executablePath);
    const pid = z.number().int().positive().max(2_147_483_647).parse(target.pid);
    const startedAt = validatedUtcTimestamp(target.startedAt);
    const result = await this.runPowerShell(CLOSE_SCRIPT, [String(pid), executablePath, startedAt]);
    const parsed = closeResultSchema.parse(parseJsonOutput(result, this.maxOutputBytes));
    if (!parsed.matched) throw new Error("Exact NinjaTrader process identity was not reverified");
    if (!parsed.closeRequested) throw new Error("NinjaTrader did not accept the graceful close request");
    const record: PlatformProcessRecord = {
      executablePath,
      pid,
      startedAt,
      state: "running",
    };
    this.active.set(exactProcessKey(record), record);
  }

  private async runPowerShell(script: string, values: readonly string[]): Promise<WindowsExecFileResult> {
    return this.execFile(
      POWERSHELL_EXECUTABLE,
      powershellArguments(script, values),
      {
        encoding: "utf8",
        maxBuffer: this.maxOutputBytes,
        timeout: this.commandTimeoutMs,
        windowsHide: true,
        shell: false,
      },
    );
  }

  private expireTombstones(nowMs: number): void {
    for (const [key, tombstone] of this.tombstones) {
      if (tombstone.expiresAtMs <= nowMs) this.tombstones.delete(key);
    }
  }

  private async loadRuntimeState(): Promise<RuntimeState | null> {
    if (!this.runtimeStateProvider) return null;
    try {
      const value = await this.runtimeStateProvider();
      return value === null ? null : processQuitRuntimeStateSchema.parse(value);
    } catch {
      return null;
    }
  }

  private async loadLaunchReadiness(observedAt: string): Promise<LaunchReadinessObservation> {
    const unknown = (
      reasonCode: Extract<LaunchReadinessObservation, { state: "unknown" }>["reasonCode"],
    ): LaunchReadinessObservation => launchReadinessObservationSchema.parse({
      state: "unknown",
      observedAt,
      source: "authenticated_runtime_v2_addon_ipc",
      authenticated: false,
      reasonCode,
    });
    if (!this.launchReadinessProvider) return unknown("PROVIDER_UNAVAILABLE");
    try {
      const value = await this.launchReadinessProvider();
      if (value === null || value === undefined) return unknown("PROVIDER_UNAVAILABLE");
      const parsed = launchReadinessObservationSchema.safeParse(value);
      return parsed.success ? parsed.data : unknown("PROVIDER_INVALID_RESPONSE");
    } catch {
      return unknown("PROVIDER_ERROR");
    }
  }
}
