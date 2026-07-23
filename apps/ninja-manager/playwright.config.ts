import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";

import { defineConfig } from "@playwright/test";

import type { NinjaManagerTestOptions } from "./tests/e2e/fixture";

const inheritedEnvironment: Record<string, string> = {};
for (const [key, value] of Object.entries(process.env)) {
  if (typeof value === "string") inheritedEnvironment[key] = value;
}

const runId = randomUUID();
const temporaryRoot = path.join(os.tmpdir(), "ninja-manager-e2e-" + runId).replaceAll("\\", "/");
const centralDatabaseUrl = "file://" + temporaryRoot + "-central";
const localDatabaseUrl = "file://" + temporaryRoot + "-local";
// This known test-only credential is injected exclusively into fresh temporary E2E databases.
const demoAgentToken = "vnm_e2e_only_" + "0".repeat(32);

process.env.E2E_CENTRAL_DATABASE_URL = centralDatabaseUrl;
process.env.E2E_LOCAL_DATABASE_URL = localDatabaseUrl;
const demoEnvironment = {
  DEMO_STAFF_EMAIL: "staff@vincere.local",
  DEMO_STAFF_PASSWORD: "VincereStaff!2026",
  DEMO_CLIENT_EMAIL: "client@vincere.local",
  DEMO_CLIENT_PASSWORD: "VincereClient!2026",
  DEMO_EMPTY_STAFF_EMAIL: "empty-staff@vincere.local",
  DEMO_AGENT_TOKEN: demoAgentToken,
  NODE_ENV: "development",
};

export default defineConfig<NinjaManagerTestOptions>({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 12_000 },
  forbidOnly: true,
  retries: 0,
  outputDir: "test-results/artifacts",
  reporter: [
    ["list"],
    ["html", { outputFolder: "playwright-report", open: "never" }],
  ],
  use: {
    agentToken: demoAgentToken,
    channel: "chrome",
    headless: true,
    locale: "en-US",
    timezoneId: "America/New_York",
    viewport: { width: 1280, height: 800 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "central-connected",
      testMatch: /central\.spec\.ts/,
      use: { baseURL: "http://127.0.0.1:3100" },
    },
    {
      name: "local-only",
      testMatch: /local\.spec\.ts/,
      use: { baseURL: "http://127.0.0.1:3101" },
    },
  ],
  webServer: [
    {
      command: "npm run db:seed && npm run dev -- --port 3100",
      url: "http://127.0.0.1:3100/sign-in",
      timeout: 180_000,
      reuseExistingServer: false,
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...inheritedEnvironment,
        ...demoEnvironment,
        APP_URL: "http://127.0.0.1:3100",
        DATABASE_URL: centralDatabaseUrl,
        NEXT_DIST_DIR: ".next-e2e-central",
        NINJA_MANAGER_BIND_HOST: "127.0.0.1",
        NINJA_MANAGER_MODE: "CENTRAL_CONNECTED",
        // PORT must match the dev --port / APP_URL so the deployment resolver's
        // port-consistency check (src/lib/deployment/configuration.mjs) holds in
        // the pre-dev db:seed process, which runs without the --port flag.
        PORT: "3100",
      },
    },
    {
      command: "npm run db:seed && npm run dev -- --port 3101",
      url: "http://127.0.0.1:3101/sign-in",
      timeout: 180_000,
      reuseExistingServer: false,
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...inheritedEnvironment,
        ...demoEnvironment,
        APP_URL: "http://127.0.0.1:3101",
        DATABASE_URL: localDatabaseUrl,
        NEXT_DIST_DIR: ".next-e2e-local",
        NINJA_MANAGER_BIND_HOST: "127.0.0.1",
        NINJA_MANAGER_MODE: "LOCAL_ONLY",
        // LOCAL_ONLY enforces APP_URL port === PORT (src/lib/deployment/configuration.mjs);
        // set PORT for the pre-dev db:seed process, which runs without the --port flag.
        PORT: "3101",
      },
    },
  ],
});
