import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

import nextEnvironment from "@next/env";

import { resolveRuntimeConfiguration } from "../src/lib/deployment/configuration.mjs";
import {
  nextArguments,
  parseManagedArguments,
  productionDistDir,
  validateBuildId,
  validateBuildManifest,
  validateFreshBuildId,
} from "../src/lib/deployment/next-runtime.mjs";

const BUILD_MANIFEST = "ninja-manager-build.json";
const { loadEnvConfig } = nextEnvironment;
const require = createRequire(import.meta.url);
const nextBinary = path.join(path.dirname(require.resolve("next/package.json")), "dist", "bin", "next");
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const requestedCommand = process.argv[2];
const rawArguments = process.argv.slice(3);

if (!["dev", "build", "build-all", "start"].includes(requestedCommand)) {
  throw new Error("Expected one of: dev, build, build-all, start");
}

const isDevelopment = requestedCommand === "dev";
process.env.NODE_ENV = isDevelopment ? "development" : "production";
loadEnvConfig(projectRoot, isDevelopment, console, true);

/** @type {import("node:child_process").ChildProcess | undefined} */
let activeChild;
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => activeChild?.kill(signal));
}

/**
 * @param {"dev" | "build" | "start"} command
 * @param {"CENTRAL_CONNECTED" | "LOCAL_ONLY" | undefined} explicitMode
 * @param {number | undefined} explicitPort
 */
async function runNext(command, explicitMode, explicitPort) {
  const environment = {
    ...process.env,
    NODE_ENV: command === "dev" ? "development" : "production",
  };
  if (explicitMode) environment.NINJA_MANAGER_MODE = explicitMode;
  if (explicitPort !== undefined) environment.PORT = String(explicitPort);

  const mode = explicitMode ?? environment.NINJA_MANAGER_MODE;
  if (command === "build") {
    environment.PORT = "3000";
    environment.APP_URL = mode === "LOCAL_ONLY"
      ? "http://127.0.0.1:3000"
      : "https://central-build.invalid";
    environment.NINJA_MANAGER_BIND_HOST = "127.0.0.1";
  }

  const runtime = resolveRuntimeConfiguration(environment);
  environment.APP_URL = runtime.appUrl;
  environment.NINJA_MANAGER_BIND_HOST = runtime.bindHost;
  environment.NINJA_MANAGER_MODE = runtime.mode;

  if (command === "build" || command === "start") {
    environment.NEXT_DIST_DIR = productionDistDir(runtime.mode);
  }

  const distDir = productionDistDir(runtime.mode);
  const manifestPath = path.join(projectRoot, distDir, BUILD_MANIFEST);
  const buildIdPath = path.join(projectRoot, distDir, "BUILD_ID");
  const previousBuildId = command === "build"
    ? await readOptionalBuildId(buildIdPath)
    : undefined;
  if (command === "start") {
    let manifest;
    let buildId;
    try {
      manifest = JSON.parse(await readFile(manifestPath, "utf8"));
      buildId = validateBuildId(await readFile(buildIdPath, "utf8"));
      validateBuildManifest(manifest, runtime.mode, buildId);
    } catch {
      throw new Error(`No valid ${runtime.mode} production build manifest exists at ${manifestPath}`);
    }
  }

  const childArguments = nextArguments(command, runtime.bindHost, runtime.port);
  const exitCode = await new Promise((resolve, reject) => {
    activeChild = spawn(process.execPath, [nextBinary, ...childArguments], {
      cwd: projectRoot,
      env: environment,
      shell: false,
      stdio: "inherit",
    });
    activeChild.once("error", reject);
    activeChild.once("exit", (code, signal) => {
      activeChild = undefined;
      if (signal) reject(new Error(`Next.js exited after ${signal}`));
      else resolve(code ?? 1);
    });
  });

  if (exitCode !== 0) throw new Error(`Next.js ${command} exited with code ${exitCode}`);
  if (command === "build") {
    const buildId = validateFreshBuildId(
      previousBuildId,
      await readFile(buildIdPath, "utf8"),
    );
    await writeJsonAtomic(manifestPath, {
      schemaVersion: 2,
      mode: runtime.mode,
      distDir,
      buildId,
      builtAt: new Date().toISOString(),
    });
  }
}

/** @param {string} buildIdPath */
async function readOptionalBuildId(buildIdPath) {
  try {
    return validateBuildId(await readFile(buildIdPath, "utf8"));
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

/** @param {string} targetPath @param {unknown} value */
async function writeJsonAtomic(targetPath, value) {
  const temporaryPath = path.join(
    path.dirname(targetPath),
    `.${path.basename(targetPath)}.${process.pid}.${randomUUID()}.tmp`,
  );
  try {
    await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
    });
    await rename(temporaryPath, targetPath);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

if (requestedCommand === "build-all") {
  if (rawArguments.length > 0) throw new Error("build-all does not accept additional arguments");
  await runNext("build", "CENTRAL_CONNECTED", undefined);
  await runNext("build", "LOCAL_ONLY", undefined);
} else {
  const { mode, port } = parseManagedArguments(rawArguments);
  if (requestedCommand === "build" && port !== undefined) {
    throw new Error("--port is accepted only for dev and start");
  }
  await runNext(requestedCommand, mode, port);
}
