import { contentHash, type NormalizedListing, parseUntrusted, type RawListing, z } from "@flip-desk/core";
import { dollarsToCents } from "@flip-desk/money";

/** eBay Browse `item_summary` shape (subset). Validated as untrusted input (plan §12.5). */
export const EbayItemSchema = z.object({
  itemId: z.string(),
  title: z.string().min(1),
  price: z.object({ value: z.string(), currency: z.string() }),
  itemWebUrl: z.string().optional(),
  condition: z.string().optional(),
  conditionId: z.string().optional(),
  seller: z.object({ username: z.string().optional(), feedbackPercentage: z.string().optional() }).optional(),
  itemLocation: z.object({ postalCode: z.string().optional() }).optional(),
});
export type EbayItem = z.infer<typeof EbayItemSchema>;

export function normalizeEbay(raw: RawListing): NormalizedListing {
  const item = parseUntrusted(EbayItemSchema, raw.payload, `ebay:${raw.externalId}`);
  const url = raw.url ?? item.itemWebUrl;
  return {
    sourceCode: "ebay",
    externalId: raw.externalId,
    title: item.title,
    priceCents: dollarsToCents(item.price.value),
    attrs: {
      currency: item.price.currency,
      ...(item.seller?.username ? { seller: item.seller.username } : {}),
      ...(item.itemLocation?.postalCode ? { postalCode: item.itemLocation.postalCode } : {}),
    },
    contentHash: contentHash(raw.payload),
    ...(url !== undefined ? { url } : {}),
    ...(item.condition !== undefined ? { conditionClaimed: item.condition } : {}),
  };
}

export const ebayNormalizer = { sourceCode: "ebay", normalize: normalizeEbay };
