import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

export const credentials = {
  staff: { email: "staff@vincere.local", password: "VincereStaff!2026" },
  emptyStaff: { email: "empty-staff@vincere.local", password: "VincereStaff!2026" },
  client: { email: "client@vincere.local", password: "VincereClient!2026" },
};

export interface BrowserDiagnostics {
  consoleErrors: string[];
  pageErrors: string[];
  requestFailures: string[];
}

export function monitorBrowser(page: Page): BrowserDiagnostics {
  const diagnostics: BrowserDiagnostics = {
    consoleErrors: [],
    pageErrors: [],
    requestFailures: [],
  };
  page.on("console", (message) => {
    if (message.type() === "error") diagnostics.consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => diagnostics.pageErrors.push(error.message));
  page.on("requestfailed", (request) => {
    const failure = request.failure()?.errorText ?? "unknown";
    if (!failure.includes("ERR_ABORTED")) {
      diagnostics.requestFailures.push(request.method() + " " + request.url() + " " + failure);
    }
  });
  return diagnostics;
}

export async function expectCleanBrowser(diagnostics: BrowserDiagnostics): Promise<void> {
  expect(diagnostics.consoleErrors, "browser console errors").toEqual([]);
  expect(diagnostics.pageErrors, "browser runtime errors").toEqual([]);
  expect(diagnostics.requestFailures, "unexpected network failures").toEqual([]);
}

export async function signIn(
  page: Page,
  identity: { email: string; password: string },
  expectedPath: string,
): Promise<void> {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(identity.email);
  await page.getByLabel("Password").fill(identity.password);
  await page.getByRole("button", { name: "Sign in securely" }).click();
  await expect(page).toHaveURL(new RegExp(expectedPath.replaceAll("/", "\\/") + "$"));
}

export async function signOut(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/sign-in$/);
}

export async function expectNoSeriousAccessibilityViolations(page: Page): Promise<void> {
  const result = await new AxeBuilder({ page }).analyze();
  const serious = result.violations.filter((violation) =>
    violation.impact === "serious" || violation.impact === "critical",
  );
  expect(
    serious.map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      targets: violation.nodes.map((node) => node.target),
    })),
  ).toEqual([]);
}

export async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
}

export async function getJson<T>(page: Page, path: string): Promise<T> {
  return page.evaluate(async (requestPath) => {
    const response = await fetch(requestPath, { cache: "no-store" });
    if (!response.ok) throw new Error("GET " + requestPath + " returned " + response.status);
    return response.json() as Promise<T>;
  }, path);
}
