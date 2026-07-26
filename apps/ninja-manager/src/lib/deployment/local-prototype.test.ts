import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  assertLocalPrototypeToolchain,
  buildLocalPrototypeEnvironment,
  LOCAL_PROTOTYPE_DATABASE_DIRECTORY,
} from "./local-prototype.mjs";

describe("local prototype launcher environment", () => {
  it("requires the exact project-pinned Node and npm invocation", () => {
    expect(() => assertLocalPrototypeToolchain({
      actualNode: "24.14.0",
      expectedNode: "24.14.0",
      npmUserAgent: "npm/11.12.1 node/v24.14.0 darwin arm64 workspaces/false",
      expectedNpm: "11.12.1",
    })).not.toThrow();
    expect(() => assertLocalPrototypeToolchain({
      actualNode: "25.9.0",
      expectedNode: "24.14.0",
      npmUserAgent: "npm/11.12.1 node/v25.9.0 darwin arm64 workspaces/false",
      expectedNpm: "11.12.1",
    })).toThrow("requires Node.js 24.14.0");
    expect(() => assertLocalPrototypeToolchain({
      actualNode: "24.14.0",
      expectedNode: "24.14.0",
      npmUserAgent: undefined,
      expectedNpm: "11.12.1",
    })).toThrow("through npm run");
  });

  it("forces loopback LOCAL_ONLY and an isolated fixture database", () => {
    const projectRoot = path.resolve("/workspace/ninja-manager");
    const environment = buildLocalPrototypeEnvironment(projectRoot, {
      APP_URL: "https://unsafe.example",
      DATABASE_URL: "postgresql://not-selected.invalid/database",
      NINJA_MANAGER_MODE: "CENTRAL_CONNECTED",
      NODE_ENV: "production",
      PORT: "9999",
    });

    expect(environment).toMatchObject({
      APP_URL: "http://127.0.0.1:3000",
      NINJA_MANAGER_BIND_HOST: "127.0.0.1",
      NINJA_MANAGER_EVIDENCE_CLASS: "FIXTURE_DEMO",
      NINJA_MANAGER_MODE: "LOCAL_ONLY",
      NEXT_DIST_DIR: ".next-local-prototype",
      PORT: "3000",
    });
    const databaseUrl = new URL(environment.DATABASE_URL);
    expect(databaseUrl).toMatchObject({
      protocol: "file:",
      username: "",
      password: "",
      hostname: "",
      search: "",
      hash: "",
    });
    expect(path.normalize(fileURLToPath(databaseUrl))).toBe(
      path.resolve(projectRoot, LOCAL_PROTOTYPE_DATABASE_DIRECTORY),
    );
    expect(environment.DEMO_AGENT_TOKEN).toBeUndefined();
  });
});
