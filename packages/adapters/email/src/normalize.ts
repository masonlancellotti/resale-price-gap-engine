import { contentHash, type NormalizedListing, parseUntrusted, type RawListing, z } from "@flip-desk/core";
import { dollarsToCents } from "@flip-desk/money";

/** The payload an email parser emits, validated as untrusted input (plan §12.5). */
export const EmailPayloadSchema = z.object({
  title: z.string().min(1),
  priceUsd: z.string(),
  url: z.string(),
  location: z.string().optional(),
});

export function normalizeEmail(raw: RawListing): NormalizedListing {
  const p = parseUntrusted(EmailPayloadSchema, raw.payload, `email:${raw.externalId}`);
  const url = raw.url ?? p.url;
  return {
    sourceCode: raw.sourceCode,
    externalId: raw.externalId,
    title: p.title,
    priceCents: dollarsToCents(p.priceUsd),
    attrs: { ...(p.location !== undefined ? { location: p.location } : {}) },
    contentHash: contentHash(raw.payload),
    ...(url !== undefined ? { url } : {}),
  };
}

/** A pipeline normalizer bound to one source code (register one per email source). */
export function makeEmailNormalizer(sourceCode: string): { sourceCode: string; normalize: (raw: RawListing) => NormalizedListing } {
  return { sourceCode, normalize: normalizeEmail };
}
