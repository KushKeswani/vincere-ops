import { expect, test as base } from "@playwright/test";

export interface NinjaManagerTestOptions {
  agentToken: string;
}

export const test = base.extend<NinjaManagerTestOptions>({
  agentToken: ["", { option: true }],
});

export { expect };
export type { Page } from "@playwright/test";
