import { expect, test, type Page } from "./fixture";

import {
  credentials,
  expectCleanBrowser,
  expectNoHorizontalOverflow,
  expectNoSeriousAccessibilityViolations,
  getJson,
  monitorBrowser,
  signIn,
  signOut,
} from "./helpers";

test.describe.configure({ mode: "serial" });

async function choose(page: Page, label: string, option: string): Promise<void> {
  await page.getByLabel(label).click();
  await page.getByRole("option", { name: option }).click();
}

async function completeStrategyQuestions(page: Page, objective: string): Promise<void> {
  await choose(page, "Primary objective", objective);
  await choose(page, "Platform experience", "Intermediate");
  await choose(page, "Drawdown comfort", "Moderate");
  await choose(page, "Guidance level", "Assisted workflow");
  await choose(page, "Preferred trading window", "US morning");
}

test("CENTRAL_CONNECTED validates sign-in, covers staff navigation/APIs, and audits both kill-switch controls", async ({ page }) => {
  const diagnostics = monitorBrowser(page);
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill("staff@vincere.local");
  await page.getByLabel("Password").fill("short");
  await page.getByRole("button", { name: "Sign in securely" }).click();
  await expect(page.getByText("Password must be at least 10 characters")).toBeVisible();

  await page.getByLabel("Email").fill("unknown@vincere.local");
  await page.getByLabel("Password").fill("WrongPassword!2026");
  await page.getByRole("button", { name: "Sign in securely" }).click();
  await expect(page.getByText("The email or password is incorrect.")).toBeVisible();

  await signIn(page, credentials.staff, "/staff");
  const primaryNavigation = page.getByRole("navigation", { name: "Primary navigation" });
  await expect(primaryNavigation.getByRole("link")).toHaveCount(5);
  const routes = [
    ["/staff", "The work that matters today"],
    ["/staff/runtime", "NinjaTrader discovery"],
    ["/staff/clients", "Create and guide client workspaces"],
    ["/staff/approvals", "Strategy approval queue"],
    ["/staff/incidents", "Guided operations board"],
  ] as const;
  for (const [route, heading] of routes) {
    await page.goto(route);
    await expect(page.getByRole("heading", { name: heading })).toBeVisible();
    await expectNoSeriousAccessibilityViolations(page);
  }

  await page.goto("/staff");
  await page.getByRole("button", { name: "Enable kill switch" }).click();
  await expect(page.getByText("Global operational kill switch is active")).toBeVisible();
  let audit = await getJson<{ data: Array<{ action: string }> }>(page, "/api/v1/audit");
  expect(audit.data.some((event) => event.action === "kill_switch.enabled")).toBe(true);
  await page.getByRole("button", { name: "Restore operations" }).click();
  await expect(page.getByText("Global operational kill switch disabled.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Enable kill switch" })).toBeVisible();
  await expect.poll(async () => {
    audit = await getJson<{ data: Array<{ action: string }> }>(page, "/api/v1/audit");
    return audit.data.some((event) => event.action === "kill_switch.disabled");
  }).toBe(true);

  const workspace = await getJson<{ data: { role: string; clients: number } }>(page, "/api/v1/workspace");
  expect(workspace.data).toMatchObject({ role: "staff", clients: 1 });
  const clients = await getJson<{ data: Array<{ email: string }> }>(page, "/api/v1/clients");
  expect(clients.data.map((client) => client.email)).toContain(credentials.client.email);

  await page.goto("/missing-workspace");
  await expect(page.getByRole("heading", { name: "That workspace was not found" })).toBeVisible();
  expect(diagnostics.consoleErrors).toHaveLength(1);
  expect(diagnostics.consoleErrors[0]).toContain("404 (Not Found)");
  diagnostics.consoleErrors.length = 0;
  await page.getByRole("link", { name: "Return to Ninja Manager" }).click();
  await expect(page).toHaveURL(/\/staff$/);
  await expectCleanBrowser(diagnostics);
});

test("staff client and runtime controls verify validation, idempotency, delivery integrity, expiry, partial, stale, and offline states", async ({ page, agentToken }) => {
  const diagnostics = monitorBrowser(page);
  await signIn(page, credentials.staff, "/staff");

  await page.goto("/staff/clients");
  const createClientForm = page.locator("form").filter({ has: page.getByRole("button", { name: "Create client" }) });
  const createClientRequestId = createClientForm.locator('input[name="requestId"]');
  const originalClientRequestId = await createClientRequestId.inputValue();
  expect(originalClientRequestId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  await page.getByLabel("Client name").fill("Browser Fixture");
  await page.getByLabel("Email").fill("browser-fixture@vincere.local");
  await page.getByLabel("Phone").fill("555-010-8989");
  await page.getByLabel("Temporary password").fill("lowercase123!");
  await page.getByRole("button", { name: "Create client" }).click();
  await expect(page.getByText("Include an uppercase letter")).toBeVisible();
  await expect(createClientRequestId).toHaveValue(originalClientRequestId);
  await expect(page.getByLabel("Client name")).toHaveValue("Browser Fixture");
  await expect(page.getByLabel("Email")).toHaveValue("browser-fixture@vincere.local");
  await expect(page.getByLabel("Phone")).toHaveValue("555-010-8989");
  await page.getByLabel("Temporary password").fill("BrowserFixture!2026");
  await page.getByRole("button", { name: "Create client" }).click();
  await expect(page.getByText(/Client created/)).toBeVisible();
  await expect(createClientRequestId).not.toHaveValue(originalClientRequestId);
  let clients = await getJson<{ data: Array<{ name: string; email: string }> }>(page, "/api/v1/clients");
  expect(clients.data.map((client) => client.email)).toContain("browser-fixture@vincere.local");

  await createClientRequestId.evaluate((input: HTMLInputElement, value) => {
    input.value = String(value);
  }, originalClientRequestId);
  await page.getByLabel("Client name").fill("Browser Fixture");
  await page.getByLabel("Email").fill("browser-fixture@vincere.local");
  await page.getByLabel("Phone").fill("555-010-8989");
  await page.getByLabel("Timezone").fill("America/New_York");
  await page.getByLabel("Temporary password").fill("BrowserFixture!2026");
  await page.getByRole("button", { name: "Create client" }).click();
  await expect(page.getByText(/Client created/)).toBeVisible();
  clients = await getJson<{ data: Array<{ name: string; email: string }> }>(page, "/api/v1/clients");
  expect(clients.data.filter((client) => client.email === "browser-fixture@vincere.local")).toHaveLength(1);
  const clientAudit = await getJson<{ data: Array<{ action: string }> }>(page, "/api/v1/audit");
  expect(clientAudit.data.filter((event) => event.action === "client.created")).toHaveLength(1);

  await createClientRequestId.evaluate((input: HTMLInputElement, value) => {
    input.value = String(value);
  }, originalClientRequestId);
  await page.getByLabel("Client name").fill("Browser Fixture Changed");
  await page.getByLabel("Email").fill("browser-fixture@vincere.local");
  await page.getByLabel("Phone").fill("555-010-8989");
  await page.getByLabel("Timezone").fill("America/New_York");
  await page.getByLabel("Temporary password").fill("BrowserFixture!2026");
  await page.getByRole("button", { name: "Create client" }).click();
  await expect(page.getByRole("alert").filter({ hasText: /Request conflict/i })).toBeVisible();
  clients = await getJson<{ data: Array<{ name: string; email: string }> }>(page, "/api/v1/clients");
  expect(clients.data.filter((client) => client.email === "browser-fixture@vincere.local")).toEqual([
    expect.objectContaining({ name: "Browser Fixture" }),
  ]);

  let clientRow = page.getByRole("row").filter({ hasText: "Browser Fixture" });
  await clientRow.getByRole("button", { name: "Disable access" }).click();
  await expect(clientRow.getByText("disabled", { exact: true })).toBeVisible();
  clientRow = page.getByRole("row").filter({ hasText: "Browser Fixture" });
  await clientRow.getByRole("button", { name: "Enable access" }).click();
  await expect(clientRow.getByText("active", { exact: true })).toBeVisible();

  await page.goto("/staff/runtime");
  await expect(page.getByText("Supervised simulation evidence")).toBeVisible();
  await expect(page.getByText("partial", { exact: true })).toBeVisible();
  await expect(page.getByText("expired", { exact: true })).toBeVisible();
  await expect(page.getByRole("cell", { name: "****4821" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "running" })).toBeVisible();
  const commandLabels = page.getByText("DISCOVER RUNTIME STATE", { exact: true });
  const initialCommandCount = await commandLabels.count();

  await page.locator('input[name="agentId"]').evaluate((input: HTMLInputElement) => {
    input.value = "not-a-uuid";
  });
  await page.getByRole("button", { name: "Queue read-only discovery" }).click();
  await expect(page.getByRole("alert").filter({ hasText: /uuid/i })).toBeVisible();
  await expect(commandLabels).toHaveCount(initialCommandCount);

  await page.reload();
  const originalRequestId = await page.locator('input[name="requestId"]').inputValue();
  await page.route(/\/staff\/runtime/, async (route) => {
    if (route.request().method() === "POST") {
      await new Promise((resolve) => setTimeout(resolve, 1_200));
    }
    await route.continue();
  });
  await page.getByRole("button", { name: "Queue read-only discovery" }).click();
  await expect(page.getByRole("button", { name: /Working/ })).toBeDisabled();
  await expect(page.getByText(/Read-only discovery queued/)).toBeVisible();
  await page.unroute(/\/staff\/runtime/);
  await expect(page.getByText("DISCOVER RUNTIME STATE", { exact: true })).toHaveCount(initialCommandCount + 1);

  await page.locator('input[name="requestId"]').evaluate((input: HTMLInputElement, value) => {
    input.value = String(value);
  }, originalRequestId);
  await page.getByRole("button", { name: "Queue read-only discovery" }).click();
  await expect(page.getByText(/already queued/)).toBeVisible();
  await expect(page.getByText("DISCOVER RUNTIME STATE", { exact: true })).toHaveCount(initialCommandCount + 1);

  const unauthorizedPoll = await page.request.post("/api/v1/agent/commands/poll", {
    data: { limit: 1 },
  });
  expect(unauthorizedPoll.status()).toBe(401);
  const poll = await page.request.post("/api/v1/agent/commands/poll", {
    headers: {
      Authorization: "Bearer " + agentToken,
      "Content-Type": "application/json",
    },
    data: { limit: 1 },
  });
  expect(poll.status()).toBe(200);
  const pollBody = await poll.json();
  expect(pollBody.data.commands).toHaveLength(1);
  expect(pollBody.data.commands[0]).toMatchObject({
    envelope: {
      command: { commandType: "DISCOVER_RUNTIME_STATE", dryRun: true },
      integrity: { canonicalization: "RFC8785" },
    },
    deliveryAttempt: 1,
  });
  expect(pollBody.data.commands[0].envelope.integrity).toMatchObject({
    payloadHash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
    semanticHash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
    envelopeHash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
  });
  await page.reload();
  const deliveredRow = page.getByRole("row").filter({ hasText: "queued" }).first();
  await expect(deliveredRow).toContainText("1");

  await page.getByRole("link", { name: /Stale companion/ }).click();
  await expect(page.getByText(/Discovery unavailable: stale/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Queue read-only discovery" })).toBeDisabled();
  await page.getByRole("link", { name: /Offline companion/ }).click();
  await expect(page.getByText(/Discovery unavailable: offline/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Queue read-only discovery" })).toBeDisabled();
  await expectCleanBrowser(diagnostics);
});

test("client forms create two approval versions, a simulated incident, and tenant-scoped API evidence", async ({ page }) => {
  const diagnostics = monitorBrowser(page);
  await signIn(page, credentials.client, "/client");
  await page.goto("/staff/runtime");
  await expect(page).toHaveURL(/\/client$/);

  const routes = [
    ["/client", "NinjaTrader account manager"],
    ["/client/setup", "Connect the pieces once"],
    ["/client/strategy", "Map algorithms to accounts"],
    ["/client/activity", "Evidence-backed daily record"],
  ] as const;
  for (const [route, heading] of routes) {
    await page.goto(route);
    await expect(page.getByRole("heading", { name: new RegExp(heading) })).toBeVisible();
    await expectNoSeriousAccessibilityViolations(page);
  }

  await page.goto("/client/setup");
  await page.getByLabel("Phone").fill("555-010-7777");
  await page.getByLabel("Reporting timezone").fill("America/Chicago");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Complete onboarding" }).click();
  await expect(page.getByText("Onboarding profile completed.")).toBeVisible();

  await page.getByLabel("Prop firm / provider").fill("Apex");
  await page.getByLabel("Account label").fill("Browser evaluation");
  await page.getByLabel("Account identifier").fill("PLAYWRIGHT9876");
  await page.getByLabel("Account size").fill("50000");
  await page.getByLabel("Rule profile").fill("Standard trailing drawdown");
  await page.getByLabel("VPS provider").fill("Local fixture VPS");
  await page.getByLabel("VPS region").fill("New York");
  await page.getByLabel("NinjaTrader version").fill("8.1");
  await page.getByRole("button", { name: "Register account and environment" }).click();
  await expect(page.getByText(/Account and environment registered/)).toBeVisible();
  await expect(page.getByText(/Browser evaluation/)).toBeVisible();
  await expect(page.getByText(/9876/)).toBeVisible();

  await page.goto("/client/strategy");
  await completeStrategyQuestions(page, "Operate consistently");
  await page.getByRole("button", { name: "Generate safe recommendation" }).click();
  await expect(page.getByText(/Recommendation created/)).toBeVisible();
  await expect(page.getByText(/v1/)).toBeVisible();
  await page.reload();
  await completeStrategyQuestions(page, "Preserve and learn");
  await page.getByRole("button", { name: "Generate safe recommendation" }).click();
  await expect(page.getByText(/Recommendation created/)).toBeVisible();
  await expect(page.getByText(/v2/)).toBeVisible();

  await page.goto("/client/activity");
  await page.getByRole("button", { name: "Simulate VPS failure" }).click();
  await expect(page.getByText(/Safe offline simulation created an incident/)).toBeVisible();
  await expect(page.getByText("VPS connection offline")).toBeVisible();

  const workspace = await getJson<{
    data: { role: string; accountCount: number; latestConfigurationStatus: string; openIncidents: number };
  }>(page, "/api/v1/workspace");
  expect(workspace.data).toMatchObject({
    role: "client",
    accountCount: 2,
    latestConfigurationStatus: "pending_approval",
  });
  expect(workspace.data.openIncidents).toBeGreaterThanOrEqual(1);
  const clientListResponse = await page.request.get("/api/v1/clients");
  expect(clientListResponse.status()).toBe(403);
  const audit = await getJson<{ data: Array<{ action: string }> }>(page, "/api/v1/audit");
  expect(audit.data.map((event) => event.action)).toEqual(expect.arrayContaining([
    "onboarding.completed",
    "environment.registered",
    "strategy.approval_requested",
    "incident.simulated",
  ]));
  await signOut(page);
  await expectCleanBrowser(diagnostics);
});

test("staff approve/reject/incident controls and client deployment record persist real outcomes", async ({ page }) => {
  const diagnostics = monitorBrowser(page);
  await signIn(page, credentials.staff, "/staff");
  await page.goto("/staff/approvals");
  let pendingCards = page.locator('[data-slot="card"]').filter({
    has: page.getByRole("button", { name: "Approve" }),
  });
  await expect(pendingCards).toHaveCount(2);
  await pendingCards.first().getByLabel("Review notes").fill("Browser verified exact limits");
  await pendingCards.first().getByRole("button", { name: "Approve" }).click();
  await expect(pendingCards).toHaveCount(1);
  const approvedReview = page.locator('[data-slot="card"]').filter({ hasText: "Browser verified exact limits" });
  await expect(approvedReview.getByText("approved", { exact: true })).toBeVisible();
  pendingCards = page.locator('[data-slot="card"]').filter({
    has: page.getByRole("button", { name: "Reject" }),
  });
  await pendingCards.first().getByLabel("Review notes").fill("Superseded browser fixture");
  await pendingCards.first().getByRole("button", { name: "Reject" }).click();
  await expect(pendingCards).toHaveCount(0);
  const rejectedReview = page.locator('[data-slot="card"]').filter({ hasText: "Superseded browser fixture" });
  await expect(rejectedReview.getByText("rejected", { exact: true })).toBeVisible();

  await page.goto("/staff/incidents");
  await page.getByRole("button", { name: "Simulate VPS failure" }).click();
  await expect(page.getByText(/Safe offline simulation created an incident/)).toBeVisible();
  let incidentCard = page.locator('[data-slot="card"]').filter({
    has: page.getByRole("button", { name: "Resolve" }),
  }).first();
  await incidentCard.getByRole("button", { name: "Next step" }).click();
  await expect(incidentCard.getByText("investigating", { exact: true })).toBeVisible();
  incidentCard = page.locator('[data-slot="card"]').filter({
    has: page.getByRole("button", { name: "Resolve" }),
  }).first();
  await incidentCard.getByRole("button", { name: "Resolve" }).click();
  const resolvedIncident = page.locator('[data-slot="card"]').filter({
    has: page.getByText("resolved", { exact: true }),
  });
  await expect(resolvedIncident).toHaveCount(1);

  let audit = await getJson<{ data: Array<{ action: string }> }>(page, "/api/v1/audit");
  expect(audit.data.map((event) => event.action)).toEqual(expect.arrayContaining([
    "strategy.approved",
    "strategy.rejected",
    "incident.investigating",
    "incident.resolved",
  ]));
  await signOut(page);

  await signIn(page, credentials.client, "/client");
  await page.goto("/client/strategy");
  const approvedCard = page.locator('[data-slot="card"]').filter({
    has: page.getByRole("button", { name: "Record deployment" }),
  });
  await expect(approvedCard).toHaveCount(1);
  await approvedCard.getByRole("button", { name: "Record deployment" }).click();
  await expect(page.getByText("deployment recorded", { exact: true })).toBeVisible();
  audit = await getJson<{ data: Array<{ action: string }> }>(page, "/api/v1/audit");
  expect(audit.data.some((event) => event.action === "deployment.recorded")).toBe(true);
  await expectCleanBrowser(diagnostics);
});

test("empty state, keyboard mobile navigation, and central layouts pass four responsive widths", async ({ page }, testInfo) => {
  const diagnostics = monitorBrowser(page);
  await signIn(page, credentials.emptyStaff, "/staff");
  await page.goto("/staff/runtime");
  await expect(page.getByText("No companion agents enrolled")).toBeVisible();
  await signOut(page);

  await signIn(page, credentials.staff, "/staff");
  for (const [width, height] of [
    [360, 780],
    [768, 900],
    [1280, 800],
    [1600, 1000],
  ] as const) {
    await page.setViewportSize({ width, height });
    await page.goto("/staff/runtime");
    await expectNoHorizontalOverflow(page);
    await page.screenshot({
      path: testInfo.outputPath("central-runtime-" + width + ".png"),
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
  await expect(dialog.getByRole("link")).toHaveCount(5);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
  await trigger.press("Enter");
  await dialog.getByRole("link", { name: "Clients" }).click();
  await expect(page).toHaveURL(/\/staff\/clients$/);
  await expectNoHorizontalOverflow(page);
  await expectNoSeriousAccessibilityViolations(page);
  await expectCleanBrowser(diagnostics);
});
