import { execFileSync } from "node:child_process";
import net from "node:net";
import os from "node:os";

import { expect, test } from "./fixture";

import {
  expectCleanBrowser,
  expectNoHorizontalOverflow,
  expectNoSeriousAccessibilityViolations,
  monitorBrowser,
} from "./helpers";

test.describe.configure({ mode: "serial" });

function canConnect(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    const finish = (connected: boolean) => {
      socket.destroy();
      resolve(connected);
    };
    socket.setTimeout(1_000, () => finish(false));
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
}

test("LOCAL_ONLY dev listener is reachable only through IPv4 loopback", async () => {
  expect(await canConnect("127.0.0.1", 3101)).toBe(true);

  const externalAddresses = Object.values(os.networkInterfaces())
    .flatMap((addresses) => addresses ?? [])
    .filter((address) => address.family === "IPv4" && !address.internal)
    .map((address) => address.address);
  for (const address of externalAddresses) {
    expect(await canConnect(address, 3101), `unexpected listener on ${address}:3101`).toBe(false);
  }

  if (process.platform === "win32") {
    const listeners = execFileSync("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "@(Get-NetTCPConnection -State Listen -LocalPort 3101 | Select-Object -ExpandProperty LocalAddress -Unique) -join ','",
    ], { encoding: "utf8" }).trim().split(",").filter(Boolean);
    expect(listeners).toEqual(["127.0.0.1"]);
  }
});

test("LOCAL_ONLY auto-enters the operator console and serves local routes without central dependencies", async ({ page }) => {
  const diagnostics = monitorBrowser(page);
  const requestOrigins = new Set<string>();
  page.on("request", (request) => requestOrigins.add(new URL(request.url()).origin));

  await page.goto("/sign-in");
  await expect(page).toHaveURL(/\/client$/);
  await expect(page.getByRole("heading", { name: "NinjaTrader account manager" })).toBeVisible();
  await expect(page.getByText("Primary SIM companion", { exact: true })).toBeVisible();
  await expect(page.getByText("Supervised simulation evidence")).toBeVisible();
  await expect(page.getByRole("cell", { name: "Simulation account 1" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "****4821" })).toHaveCount(2);
  await expect(page.getByRole("cell", { name: "VincereSteady" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Queue read-only discovery" })).toBeEnabled();
  await expect(page.getByText("Positions, orders, executions, realized/unrealized P&L")).toBeVisible();
  await expect(page.getByText("Loopback dashboard · no cloud login")).toBeVisible();
  await expectNoSeriousAccessibilityViolations(page);

  const primaryNavigation = page.getByRole("navigation", { name: "Primary navigation" });
  await expect(primaryNavigation.getByRole("link")).toHaveCount(3);
  await expect(primaryNavigation.getByRole("link", { name: "Operator" })).toBeVisible();
  await expect(primaryNavigation.getByRole("link", { name: "Blueprint" })).toBeVisible();
  await expect(primaryNavigation.getByRole("link", { name: "Day ops" })).toBeVisible();
  await expect(primaryNavigation.getByRole("link", { name: "Setup" })).toHaveCount(0);
  await expect(primaryNavigation.getByRole("link", { name: "Clients" })).toHaveCount(0);
  await expect(primaryNavigation.getByRole("link", { name: "Runtime" })).toHaveCount(0);
  await expect(primaryNavigation.getByRole("link", { name: "Approvals" })).toHaveCount(0);
  await expect(primaryNavigation.getByRole("link", { name: "Incidents" })).toHaveCount(0);

  const routes = [
    ["/client", "NinjaTrader account manager"],
    ["/client/strategy", "Map algorithms to accounts"],
    ["/client/activity", "Evidence-backed daily record"],
  ] as const;
  for (const [route, heading] of routes) {
    await page.goto(route);
    await expect(page.getByRole("heading", { name: new RegExp(heading) })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await expectNoSeriousAccessibilityViolations(page);
  }

  await page.goto("/client/strategy");
  await expect(page.getByText("Local automation gate")).toBeVisible();
  await expect(page.getByLabel("Blueprint file")).toBeDisabled();
  await expect(page.getByRole("button", { name: "Preview import" })).toBeDisabled();

  await page.goto("/staff/runtime");
  await expect(page).toHaveURL(/\/client$/);
  await page.goto("/staff/clients");
  await expect(page).toHaveURL(/\/client$/);
  await page.goto("/");
  await expect(page).toHaveURL(/\/client$/);

  const clientListResponse = await page.request.get("/api/v1/clients");
  expect(clientListResponse.status()).toBe(403);
  const connector = await page.evaluate(async () => {
    const response = await fetch("/api/v1/connectors/vps/health", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ simulatedStatus: "healthy" }),
    });
    return { status: response.status, body: await response.json() };
  });
  expect(connector.status).toBe(200);
  expect(connector.body).toMatchObject({
    simulation: true,
    data: { status: "healthy", details: { adapter: "simulated", autonomousTrading: false } },
  });

  await page.goto("/client/activity");
  await page.context().setOffline(true);
  await expect(page.getByRole("heading", { name: "Evidence-backed daily record" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Day ops" })).toBeVisible();
  await page.context().setOffline(false);

  expect([...requestOrigins]).toEqual(["http://127.0.0.1:3101"]);
  await expectCleanBrowser(diagnostics);
});

test("LOCAL_ONLY mobile dialog is keyboard-safe and layouts remain contained at four widths", async ({ page }, testInfo) => {
  const diagnostics = monitorBrowser(page);
  await page.goto("/client");
  await expect(page.getByRole("heading", { name: "NinjaTrader account manager" })).toBeVisible();

  for (const [width, height] of [
    [360, 780],
    [768, 900],
    [1280, 800],
    [1600, 1000],
  ] as const) {
    await page.setViewportSize({ width, height });
    await page.goto("/client");
    await expectNoHorizontalOverflow(page);
    await page.screenshot({
      path: testInfo.outputPath("local-client-" + width + ".png"),
      fullPage: true,
      caret: "initial",
    });
  }

  await page.setViewportSize({ width: 360, height: 780 });
  const trigger = page.getByRole("button", { name: "Open navigation menu" });
  await trigger.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(/Local only/)).toBeVisible();
  await expect(dialog.getByRole("link")).toHaveCount(3);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();

  await trigger.press("Enter");
  await dialog.getByRole("link", { name: "Blueprint" }).click();
  await expect(page).toHaveURL(/\/client\/strategy$/);
  await expectNoSeriousAccessibilityViolations(page);
  await expectNoHorizontalOverflow(page);
  await expectCleanBrowser(diagnostics);
});
