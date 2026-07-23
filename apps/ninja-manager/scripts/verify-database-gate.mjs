import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

function runNode(arguments_, environment) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, arguments_, {
      cwd: process.cwd(),
      env: environment,
      shell: false,
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal) reject(new Error(`Database gate child exited after ${signal}`));
      else if (code !== 0) reject(new Error(`Database gate child exited with code ${code}`));
      else resolve();
    });
  });
}

const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "ninja-manager-db-gate-"));
try {
  for (const mode of ["CENTRAL_CONNECTED", "LOCAL_ONLY"]) {
    const databasePath = path.join(temporaryRoot, mode.toLowerCase().replaceAll("_", "-"));
    const environment = {
      ...process.env,
      APP_URL: "http://127.0.0.1:3000",
      DATABASE_URL: "file://" + databasePath.replaceAll(path.sep, "/"),
      DEMO_AGENT_TOKEN: "",
      DEMO_CLIENT_EMAIL: "client@db-gate.invalid",
      DEMO_CLIENT_PASSWORD: "DatabaseGateClient!2026",
      DEMO_EMPTY_STAFF_EMAIL: "empty-staff@db-gate.invalid",
      DEMO_STAFF_EMAIL: "staff@db-gate.invalid",
      DEMO_STAFF_PASSWORD: "DatabaseGateStaff!2026",
      NEXT_TELEMETRY_DISABLED: "1",
      NINJA_MANAGER_BIND_HOST: "127.0.0.1",
      NINJA_MANAGER_MODE: mode,
      NODE_ENV: "development",
    };

    await runNode(["--import", "tsx", "scripts/migrate.ts"], environment);
    await runNode(["--conditions=react-server", "--import", "tsx", "scripts/seed.ts"], environment);
    await runNode(["--import", "tsx", "scripts/migrate.ts"], environment);
    await runNode(["--conditions=react-server", "--import", "tsx", "scripts/seed.ts"], environment);
    await runNode(["--conditions=react-server", "--import", "tsx", "scripts/verify-database-state.ts"], environment);
  }
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
