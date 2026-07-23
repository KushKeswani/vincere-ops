import { describe, expect, it } from "vitest";

import {
  deploymentProfileForMode,
  homePathForRole,
  parseDeploymentMode,
} from "./contracts";
import { navigationItemsFor } from "./navigation";
import {
  nextArguments,
  parseManagedArguments,
  productionDistDir,
  rejectHostnameOverrides,
  validateBuildManifest,
  validateFreshBuildId,
} from "./next-runtime.mjs";
import { resolveDeploymentConfiguration } from "./server";

describe("deployment mode contracts", () => {
  it("requires an explicit valid mode in production", () => {
    expect(() => parseDeploymentMode(undefined, "production")).toThrow("NINJA_MANAGER_MODE");
    expect(() => parseDeploymentMode("UNKNOWN", "production")).toThrow();
    expect(parseDeploymentMode(undefined, "development")).toBe("CENTRAL_CONNECTED");
  });

  it("keeps central and local capabilities and authority explicit", () => {
    const central = deploymentProfileForMode("CENTRAL_CONNECTED");
    const local = deploymentProfileForMode("LOCAL_ONLY");

    expect(central.capabilities["central.sync"]).toBe(true);
    expect(central.capabilities["remote.delivery"]).toBe(true);
    expect(central.agentConnectivity).toBe("outbound_only");
    expect(local.capabilities["central.sync"]).toBe(false);
    expect(local.capabilities["remote.delivery"]).toBe(false);
    expect(local.capabilities["transport.local"]).toBe(true);
    expect(local.authorities.client_directory.writer).toBe("local_installation");
    expect(local.authorities.runtime_state.writer).toBe("ninjatrader_addon");
    expect(central.authorities.runtime_state.writer).toBe("ninjatrader_addon");
  });

  it("removes staff and central-only navigation in local mode", () => {
    const central = deploymentProfileForMode("CENTRAL_CONNECTED");
    const local = deploymentProfileForMode("LOCAL_ONLY");

    expect(navigationItemsFor(central, "staff").map((item) => item.href)).toContain("/staff/runtime");
    expect(navigationItemsFor(local, "staff")).toEqual([]);
    expect(navigationItemsFor(local, "client").map((item) => item.href)).toEqual([
      "/client",
      "/client/strategy",
      "/client/activity",
    ]);
    expect(navigationItemsFor(local, "client").map((item) => item.label)).toEqual([
      "Operator",
      "Blueprint",
      "Day ops",
    ]);
    expect(homePathForRole(local, "staff")).toBe("/sign-in");
  });

  it("enforces the exact local listener and application origin", () => {
    const configuration = resolveDeploymentConfiguration({
      NODE_ENV: "development",
      NINJA_MANAGER_MODE: "LOCAL_ONLY",
    });
    expect(configuration).toMatchObject({
      bindHost: "127.0.0.1",
      appUrl: "http://127.0.0.1:3000",
      secureCookies: false,
    });

    for (const host of ["0.0.0.0", "localhost", "::1", "192.168.1.8"]) {
      expect(() => resolveDeploymentConfiguration({
        NODE_ENV: "development",
        NINJA_MANAGER_MODE: "LOCAL_ONLY",
        NINJA_MANAGER_BIND_HOST: host,
      })).toThrow("loopback");
    }
    expect(() => resolveDeploymentConfiguration({
      NODE_ENV: "development",
      NINJA_MANAGER_MODE: "LOCAL_ONLY",
      APP_URL: "http://localhost:3000",
    })).toThrow("127.0.0.1");
    expect(() => resolveDeploymentConfiguration({
      NODE_ENV: "development",
      NINJA_MANAGER_MODE: "LOCAL_ONLY",
      APP_URL: "http://127.0.0.1:3000/path",
    })).toThrow("origin");
    expect(() => resolveDeploymentConfiguration({
      NODE_ENV: "development",
      NINJA_MANAGER_MODE: "LOCAL_ONLY",
      PORT: "3101",
      APP_URL: "http://127.0.0.1:3000",
    })).toThrow("must match PORT 3101");
    expect(resolveDeploymentConfiguration({
      NODE_ENV: "development",
      NINJA_MANAGER_MODE: "LOCAL_ONLY",
      PORT: "3101",
      APP_URL: "http://127.0.0.1:3101",
    }).appUrl).toBe("http://127.0.0.1:3101");
  });

  it("requires HTTPS for the central production origin and derives cookie security", () => {
    expect(() => resolveDeploymentConfiguration({
      NODE_ENV: "production",
      NINJA_MANAGER_MODE: "CENTRAL_CONNECTED",
      APP_URL: "http://127.0.0.1:3000",
    })).toThrow("HTTPS");
    expect(resolveDeploymentConfiguration({
      NODE_ENV: "production",
      NINJA_MANAGER_MODE: "CENTRAL_CONNECTED",
      APP_URL: "https://ninja-manager.example",
    }).secureCookies).toBe(true);
    expect(resolveDeploymentConfiguration({
      NODE_ENV: "production",
      NINJA_MANAGER_MODE: "LOCAL_ONLY",
      APP_URL: "http://127.0.0.1:3000",
    }).secureCookies).toBe(false);
  });

  it("keeps mode-specific production artifacts and rejects every hostname override form", () => {
    expect(productionDistDir("CENTRAL_CONNECTED")).toBe(".next-central-connected");
    expect(productionDistDir("LOCAL_ONLY")).toBe(".next-local-only");
    expect(parseManagedArguments(["--mode=LOCAL_ONLY", "--port", "3101"])).toEqual({
      mode: "LOCAL_ONLY",
      port: 3101,
    });
    for (const portArguments of [
      ["--port", "3101"],
      ["--port=3101"],
      ["-p", "3101"],
      ["-p3101"],
      ["-p=3101"],
    ]) {
      expect(parseManagedArguments(portArguments).port).toBe(3101);
    }
    expect(nextArguments("dev", "127.0.0.1", 3101)).toEqual([
      "dev", "--hostname", "127.0.0.1", "--port", "3101",
    ]);
    for (const arguments_ of [
      ["--hostname", "0.0.0.0"],
      ["--hostname=0.0.0.0"],
      ["-H", "0.0.0.0"],
      ["-H0.0.0.0"],
      ["-H=0.0.0.0"],
    ]) {
      expect(() => rejectHostnameOverrides(arguments_)).toThrow("Hostname overrides");
      expect(() => parseManagedArguments(arguments_)).toThrow("Hostname overrides");
    }
    expect(() => parseManagedArguments(["--port", "3101", "-p3102"])).toThrow("only once");
    expect(() => parseManagedArguments(["--help"])).toThrow("Early-exit");
    expect(() => parseManagedArguments(["."])).toThrow("Unsupported managed launcher argument");
    expect(() => parseManagedArguments(["--webpack"])).toThrow("Unsupported managed launcher argument");
  });

  it("ties a mode-specific production manifest to a fresh Next.js build ID", () => {
    expect(validateFreshBuildId("old-build", "new-build\n")).toBe("new-build");
    expect(() => validateFreshBuildId("same-build", "same-build")).toThrow("fresh BUILD_ID");
    expect(validateBuildManifest({
      schemaVersion: 2,
      mode: "LOCAL_ONLY",
      distDir: ".next-local-only",
      buildId: "local-build",
      builtAt: "2026-07-14T12:00:00.000Z",
    }, "LOCAL_ONLY", "local-build")).toMatchObject({ buildId: "local-build" });
    expect(() => validateBuildManifest({
      schemaVersion: 2,
      mode: "LOCAL_ONLY",
      distDir: ".next-local-only",
      buildId: "stale-build",
      builtAt: "2026-07-14T12:00:00.000Z",
    }, "LOCAL_ONLY", "local-build")).toThrow("BUILD_ID");
  });
});
