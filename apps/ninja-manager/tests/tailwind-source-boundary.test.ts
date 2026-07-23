import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const globalsPath = fileURLToPath(new URL("../src/app/globals.css", import.meta.url));
const sourceRoot = resolve(dirname(globalsPath), "..");

describe("Tailwind source boundary", () => {
  it("pins automatic detection to the application source tree", async () => {
    const css = (await readFile(globalsPath, "utf8")).replace(/\/\*[\s\S]*?\*\//g, "");
    const tailwindImports = [...css.matchAll(
      /@import\s+(?:url\(\s*)?["']tailwindcss["']\s*\)?([^;]*);/gi,
    )];

    expect(tailwindImports).toHaveLength(1);
    const sourceBase = tailwindImports[0]?.[1].match(/^\s*source\s*\(\s*["']([^"']+)["']\s*\)\s*$/i)?.[1];
    expect(resolve(dirname(globalsPath), sourceBase ?? "")).toBe(sourceRoot);

    const explicitSources = [...css.matchAll(/@source\s+["']([^"']+)["']\s*;/gi)]
      .map((match) => resolve(dirname(globalsPath), match[1]));

    expect(explicitSources).toEqual([]);
  });
});
