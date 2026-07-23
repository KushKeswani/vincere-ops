import { parseRuntimeMode, parseRuntimePort } from "./configuration.mjs";

const hostFlags = new Set(["-H", "--hostname"]);
const earlyExitFlags = new Set(["-h", "--help", "-v", "--version"]);

/** @param {string[]} arguments_ */
export function parseManagedArguments(arguments_) {
  /** @type {string | undefined} */
  let mode;
  /** @type {number | undefined} */
  let port;

  const setPort = (value) => {
    if (port !== undefined) throw new Error("--port may be provided only once");
    if (!value) throw new Error("--port requires one value");
    port = parseRuntimePort(value);
  };

  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    rejectHostnameOverrides([argument]);
    if (earlyExitFlags.has(argument)) {
      throw new Error(`Early-exit option ${argument} is not accepted by the managed launcher`);
    }
    if (argument === "--mode") {
      if (mode || !arguments_[index + 1]) throw new Error("--mode requires one value");
      mode = arguments_[index + 1];
      index += 1;
      continue;
    }
    if (argument.startsWith("--mode=")) {
      if (mode) throw new Error("--mode may be provided only once");
      mode = argument.slice("--mode=".length);
      if (!mode) throw new Error("--mode requires one value");
      continue;
    }
    if (argument === "--port" || argument === "-p") {
      setPort(arguments_[index + 1]);
      index += 1;
      continue;
    }
    if (argument.startsWith("--port=")) {
      setPort(argument.slice("--port=".length));
      continue;
    }
    if (/^-p=?/.test(argument) && argument.length > 2) {
      setPort(argument.slice(argument[2] === "=" ? 3 : 2));
      continue;
    }
    throw new Error(`Unsupported managed launcher argument: ${argument}`);
  }

  return {
    mode: mode ? parseRuntimeMode(mode, "production") : undefined,
    port,
  };
}

/** @param {string[]} arguments_ */
export function rejectHostnameOverrides(arguments_) {
  for (const argument of arguments_) {
    if (
      hostFlags.has(argument)
      || argument.startsWith("--hostname=")
      || /^-H(?:=)?.+/.test(argument)
    ) {
      throw new Error("Hostname overrides are managed by NINJA_MANAGER_BIND_HOST and are not accepted on the command line");
    }
  }
}

/** @param {"CENTRAL_CONNECTED" | "LOCAL_ONLY"} mode */
export function productionDistDir(mode) {
  return mode === "LOCAL_ONLY" ? ".next-local-only" : ".next-central-connected";
}

/** @param {unknown} value */
export function validateBuildId(value) {
  if (typeof value !== "string") throw new Error("Next.js BUILD_ID must be a string");
  const buildId = value.trim();
  if (!buildId || buildId.length > 256 || /[\u0000-\u001f\u007f]/.test(buildId)) {
    throw new Error("Next.js BUILD_ID is empty or malformed");
  }
  return buildId;
}

/**
 * @param {string | undefined} previousBuildId
 * @param {unknown} currentBuildId
 */
export function validateFreshBuildId(previousBuildId, currentBuildId) {
  const buildId = validateBuildId(currentBuildId);
  if (previousBuildId !== undefined && validateBuildId(previousBuildId) === buildId) {
    throw new Error("Next.js did not generate a fresh BUILD_ID");
  }
  return buildId;
}

/**
 * @param {unknown} manifest
 * @param {"CENTRAL_CONNECTED" | "LOCAL_ONLY"} mode
 * @param {string} buildId
 */
export function validateBuildManifest(manifest, mode, buildId) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw new Error("Production build manifest must be an object");
  }
  const candidate = /** @type {{schemaVersion?: unknown, mode?: unknown, distDir?: unknown, buildId?: unknown, builtAt?: unknown}} */ (manifest);
  const builtAt = typeof candidate.builtAt === "string" ? Date.parse(candidate.builtAt) : Number.NaN;
  if (
    candidate.schemaVersion !== 2
    || candidate.mode !== mode
    || candidate.distDir !== productionDistDir(mode)
    || candidate.buildId !== validateBuildId(buildId)
    || !Number.isFinite(builtAt)
  ) {
    throw new Error(`Production build manifest does not match ${mode} and BUILD_ID ${buildId}`);
  }
  return candidate;
}

/**
 * @param {"dev" | "build" | "start"} command
 * @param {string} bindHost
 * @param {number} port
 */
export function nextArguments(command, bindHost, port) {
  if (command === "dev" || command === "start") {
    return [command, "--hostname", bindHost, "--port", String(port)];
  }
  return [command];
}
