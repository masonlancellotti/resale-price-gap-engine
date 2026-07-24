import { createHash } from "node:crypto";

/**
 * Deterministic JSON with sorted keys, so the same logical payload always hashes identically
 * regardless of key order. Used for content-addressed dedupe of raw listings (plan §5.4:
 * "idempotent by content hash").
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = sortKeys((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

/** SHA-256 hex of the canonical JSON of a payload. The dedupe key for `listing_raw`. */
export function contentHash(payload: unknown): string {
  return createHash("sha256").update(canonicalJson(payload)).digest("hex");
}
