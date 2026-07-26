import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

import {
  assertLocalPrototypeToolchain,
  buildLocalPrototypeEnvironment,
  LOCAL_PROTOTYPE_DATABASE_DIRECTORY,
  LOCAL_PROTOTYPE_PORT,
} from "../src/lib/deployment/local-prototype.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const expectedNode = (await readFile(path.join(projectRoot, ".node-version"), "utf8")).trim();
const packageMetadata = JSON.parse(await readFile(path.join(projectRoot, "package.json"), "utf8"));
const expectedNpm = typeof packageMetadata.packageManager === "string"
  ? packageMetadata.packageManager.replace(/^npm@/, "")
  : "";
assertLocalPrototypeToolchain({
  actualNode: process.versions.node,
  expectedNode,
  npmUserAgent: process.env.npm_config_user_agent,
  expectedNpm,
});
const environment = buildLocalPrototypeEnvironment(projectRoot);
const seedScript = path.join(projectRoot, "scripts", "seed.ts");
const runtimeScript = path.join(projectRoot, "scripts", "next-runtime.mjs");

/** @type {import("node:child_process").ChildProcess | undefined} */
let activeChild;
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => activeChild?.kill(signal));
}

async function run(arguments_) {
  return new Promise((resolve, reject) => {
    activeChild = spawn(process.execPath, arguments_, {
      cwd: projectRoot,
      env: environment,
      shell: false,
      stdio: "inherit",
    });
    activeChild.once("error", reject);
    activeChild.once("exit", (code, signal) => {
      activeChild = undefined;
      if (signal) reject(new Error(`Local prototype child exited after ${signal}`));
      else resolve(code ?? 1);
    });
  });
}

if (process.argv.length > 2) {
  throw new Error("The local prototype launcher accepts no arguments");
}

console.log("Preparing an isolated LOCAL_ONLY fixture prototype.");
console.log(`Database: ${LOCAL_PROTOTYPE_DATABASE_DIRECTORY} (demo data only)`);
console.log(`URL: http://127.0.0.1:${LOCAL_PROTOTYPE_PORT}`);
console.log("This launcher does not connect to or actuate NinjaTrader.");

const seedExitCode = await run(["--conditions=react-server", "--import", "tsx", seedScript]);
if (seedExitCode !== 0) throw new Error(`Prototype seed exited with code ${seedExitCode}`);

const runtimeExitCode = await run([
  runtimeScript,
  "dev",
  "--mode",
  "LOCAL_ONLY",
  "--port",
  String(LOCAL_PROTOTYPE_PORT),
]);
if (runtimeExitCode !== 0) throw new Error(`Prototype dashboard exited with code ${runtimeExitCode}`);
