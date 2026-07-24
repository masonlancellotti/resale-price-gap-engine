import { contentHash, type NormalizedListing, parseUntrusted, type RawListing, z } from "@flip-desk/core";
import { centsFromInt } from "@flip-desk/money";

/**
 * ShopGoodwill watchlist item (subset). National thrift-auction site — chronically under-described
 * items are where our identification pipeline shines (plan §4.2, a Phase-3 favorite). Validated as
 * untrusted input (plan §12.5).
 */
export const ShopGoodwillItemSchema = z.object({
  itemId: z.union([z.string(), z.number()]).transform((v) => String(v)),
  title: z.string().min(1),
  currentPrice: z.number().nonnegative(),
  buyNowPrice: z.number().nonnegative().optional(),
  endTime: z.string().optional(),
  categoryName: z.string().optional(),
  imageUrl: z.string().optional(),
  numberOfBids: z.number().int().nonnegative().optional(),
});
export type ShopGoodwillItem = z.infer<typeof ShopGoodwillItemSchema>;

/** Auction prices arrive as dollar *numbers*; convert to integer cents without float drift. */
function dollarsNumberToCents(v: number): bigint {
  return centsFromInt(Math.round(v * 100));
}

export function normalizeShopGoodwill(raw: RawListing): NormalizedListing {
  const item = parseUntrusted(ShopGoodwillItemSchema, raw.payload, `shopgoodwill:${raw.externalId}`);
  return {
    sourceCode: "shopgoodwill",
    externalId: raw.externalId,
    title: item.title,
    priceCents: dollarsNumberToCents(item.currentPrice),
    attrs: {
      auction: true,
      ...(item.buyNowPrice !== undefined ? { buyNowCents: Number(dollarsNumberToCents(item.buyNowPrice)) } : {}),
      ...(item.endTime ? { endTime: item.endTime } : {}),
      ...(item.categoryName ? { category: item.categoryName } : {}),
      ...(item.numberOfBids !== undefined ? { bids: item.numberOfBids } : {}),
    },
    contentHash: contentHash(raw.payload),
    ...(raw.url !== undefined ? { url: raw.url } : {}),
  };
}

export const shopGoodwillNormalizer = { sourceCode: "shopgoodwill", normalize: normalizeShopGoodwill };
