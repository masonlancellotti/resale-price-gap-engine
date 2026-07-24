import { extract, type LlmClient, type LlmResponse, z } from "@flip-desk/llm";
import type { IdentifyListing } from "./filters.js";

/** F2 structured extraction schema (plan §7.2). Forced JSON — the injection firewall (§12.5). */
export const ExtractionSchema = z.object({
  brand: z.string().nullable(),
  model: z.string().nullable(),
  mpn: z.string().nullable().default(null),
  upc: z.string().nullable().default(null),
  variant: z.record(z.string()).default({}),
  conditionClaim: z.enum(["new", "like_new", "good", "fair", "parts", "unknown"]).default("unknown"),
  defects: z.array(z.string()).default([]),
  bundleItems: z.array(z.string()).default([]),
  redFlags: z.array(z.string()).default([]),
  confidence: z.number().min(0).max(1).default(0.5),
});
export type Extraction = z.infer<typeof ExtractionSchema>;

const INSTRUCTION =
  "You are a product-identification extractor for a resale system. From the listing data, extract: " +
  "brand; model; MPN and UPC if present; variant axes (storage/size/gen/carrier/voltage/color); the " +
  "seller's condition claim; any mentioned or visible defects; bundle/included items; and red flags " +
  "(stock-photo-only, vague description, implausibly low price, urgency pressure, no box, missing/filed " +
  "serial, 'replica'/'clone'). Do not infer facts the listing does not support.";

/** Run F2 extraction with Haiku (bulk tier). The listing text is passed as untrusted `data`. */
export async function runExtraction(
  llm: LlmClient,
  listing: IdentifyListing,
): Promise<{ extraction: Extraction; usage: LlmResponse }> {
  const data = [listing.title, listing.description].filter(Boolean).join("\n");
  const { value, usage } = await extract(llm, ExtractionSchema, {
    model: "haiku",
    instruction: INSTRUCTION,
    data,
  });
  return { extraction: value, usage };
}
