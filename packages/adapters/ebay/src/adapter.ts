import type { AdapterContext, RawListing, SourceAdapter } from "@flip-desk/core";
import { parseJson, type Transport } from "@flip-desk/net";
import { EbayItemSchema } from "./normalize.js";
import type { EbayOAuth } from "./oauth.js";

/**
 * eBay Browse API source adapter (plan §4.2). The compliant, T0 sourcing engine: it polls newly
 * listed items in tracked queries/categories — the misprice-scanner input and the active side of
 * the liquidity math. Streams raw item summaries; honors the kill switch via `ctx.signal` (P7).
 */
export interface EbayBrowseConfig {
  readonly queries: readonly string[];
  readonly baseUrl?: string;
  readonly limit?: number;
  readonly now?: () => number;
}

interface EbaySearchResponse {
  readonly itemSummaries?: unknown[];
  readonly total?: number;
}

const SELF_TEST_ITEM = {
  itemId: "v1|selftest|0",
  title: "Self-test item",
  price: { value: "1.00", currency: "USD" },
};

export class EbayBrowseAdapter implements SourceAdapter {
  readonly code = "ebay";
  readonly tier = "T0" as const;
  readonly channel = "api" as const;

  constructor(
    private readonly transport: Transport,
    private readonly oauth: EbayOAuth,
    private readonly cfg: EbayBrowseConfig,
  ) {}

  async *poll(ctx: AdapterContext): AsyncIterable<RawListing> {
    const token = await this.oauth.token();
    const base = this.cfg.baseUrl ?? "https://api.ebay.com";
    const limit = this.cfg.limit ?? 50;
    const fetchedAt = new Date(this.cfg.now ? this.cfg.now() : Date.now()).toISOString();

    for (const q of this.cfg.queries) {
      if (ctx.signal?.aborted) return;
      const url = `${base}/buy/browse/v1/item_summary/search?q=${encodeURIComponent(q)}&limit=${limit}`;
      const res = await this.transport.request({
        method: "GET",
        url,
        headers: { authorization: `Bearer ${token}` },
        ...(ctx.signal ? { signal: ctx.signal } : {}),
      });
      const data = parseJson<EbaySearchResponse>(res, url);
      ctx.log(`ebay browse "${q}" → ${data.itemSummaries?.length ?? 0} items`);
      for (const item of data.itemSummaries ?? []) {
        if (ctx.signal?.aborted) return;
        const parsed = EbayItemSchema.safeParse(item);
        if (!parsed.success) continue; // skip malformed item; the rest of the page still flows
        yield {
          sourceCode: "ebay",
          externalId: parsed.data.itemId,
          channel: "api",
          fetchedAt,
          ...(parsed.data.itemWebUrl ? { url: parsed.data.itemWebUrl } : {}),
          payload: item,
        };
      }
    }
  }

  async selfTest(): Promise<boolean> {
    return EbayItemSchema.safeParse(SELF_TEST_ITEM).success;
  }
}
