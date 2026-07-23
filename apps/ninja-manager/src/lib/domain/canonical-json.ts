import { createHash } from "node:crypto";

function canonicalizeJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalizeJson);
  if (value && typeof value === "object") {
    for (const key of Object.keys(value as Record<string, unknown>)) assertValidUnicode(key);
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((key) => [key, canonicalizeJson((value as Record<string, unknown>)[key])]),
    );
  }
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new Error("Canonical JSON cannot contain a non-finite number");
  }
  if (
    value === undefined
    || typeof value === "function"
    || typeof value === "symbol"
    || typeof value === "bigint"
  ) {
    throw new Error("Canonical JSON contains an unsupported value");
  }
  if (typeof value === "string") assertValidUnicode(value);
  return value;
}

function assertValidUnicode(value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        throw new Error("Canonical JSON cannot contain a lone Unicode surrogate");
      }
      index += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      throw new Error("Canonical JSON cannot contain a lone Unicode surrogate");
    }
  }
}

export function canonicalizeJsonForHash(value: unknown): string {
  // RFC 8785 uses ECMAScript serialization and UTF-16 code-unit property ordering.
  const serialized = JSON.stringify(canonicalizeJson(value));
  if (serialized === undefined) throw new Error("Canonical JSON cannot be undefined");
  return serialized;
}

export function hashCanonicalPayload(payload: unknown): string {
  return "sha256:" + createHash("sha256").update(canonicalizeJsonForHash(payload), "utf8").digest("hex");
}
