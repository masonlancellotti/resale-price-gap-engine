import type { AdapterContext, RawListing, SourceAdapter } from "@flip-desk/core";
import { parseJson, type Transport } from "@flip-desk/net";
import { ShopGoodwillItemSchema } from "./normalize.js";

/**
 * ShopGoodwill watchlist adapter (plan §4.2, §16 Phase 3). Compliant T2 sourcing: the operator keeps
 * a saved watchlist/search on shopgoodwill.com; this pulls that watchlist feed (no evasion, no
 * hammering — the T4-lite polling variant stays default-off). Honors the kill switch via ctx.signal.
 */
export interface ShopGoodwillConfig {
  readonly watchlistUrl: string;
  readonly now?: () => number;
}

interface WatchlistResponse {
  readonly items?: unknown[];
}

const SELF_TEST_ITEM = { itemId: 1, title: "Self-test lot", currentPrice: 5 };

export class ShopGoodwillWatchlistAdapter implements SourceAdapter {
  readonly code = "shopgoodwill";
  readonly tier = "T2" as const;
  readonly channel = "export" as const;

  constructor(
    private readonly transport: Transport,
    private readonly cfg: ShopGoodwillConfig,
  ) {}

  async *poll(ctx: AdapterContext): AsyncIterable<RawListing> {
    if (ctx.signal?.aborted) return;
    const fetchedAt = new Date(this.cfg.now ? this.cfg.now() : Date.now()).toISOString();
    const res = await this.transport.request({
      method: "GET",
      url: this.cfg.watchlistUrl,
      ...(ctx.signal ? { signal: ctx.signal } : {}),
    });
    const data = parseJson<WatchlistResponse>(res, this.cfg.watchlistUrl);
    ctx.log(`shopgoodwill watchlist → ${data.items?.length ?? 0} items`);
    for (const item of data.items ?? []) {
      if (ctx.signal?.aborted) return;
      const parsed = ShopGoodwillItemSchema.safeParse(item);
      if (!parsed.success) continue; // skip malformed lot; the rest of the watchlist still flows
      yield {
        sourceCode: "shopgoodwill",
        externalId: parsed.data.itemId,
        channel: "export",
        fetchedAt,
        url: `https://shopgoodwill.com/item/${parsed.data.itemId}`,
        payload: item,
      };
    }
  }

  async selfTest(): Promise<boolean> {
    return ShopGoodwillItemSchema.safeParse(SELF_TEST_ITEM).success;
  }
}
