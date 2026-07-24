import { describe, expect, test } from "vitest";
import type { AdapterContext } from "@flip-desk/core";
import { FakeTransport, jsonResponse } from "@flip-desk/net";
import { normalizeShopGoodwill, ShopGoodwillWatchlistAdapter } from "../src/index.js";

const ctx: AdapterContext = { log: () => {} };

describe("ShopGoodwill watchlist adapter (T2)", () => {
  test("streams watchlist lots, skipping malformed ones", async () => {
    const t = new FakeTransport().on("/watchlist", jsonResponse(200, {
      items: [
        { itemId: 101, title: "Vintage camera lot", currentPrice: 24.5, numberOfBids: 3, categoryName: "Cameras" },
        { title: "no id — dropped", currentPrice: 5 },
        { itemId: 102, title: "Sealed game", currentPrice: 60, buyNowPrice: 90 },
      ],
    }));
    const adapter = new ShopGoodwillWatchlistAdapter(t, { watchlistUrl: "https://sg.test/watchlist", now: () => Date.parse("2026-07-04T00:00:00Z") });

    const out = [];
    for await (const raw of adapter.poll(ctx)) out.push(raw);

    expect(out).toHaveLength(2);
    expect(out[0]?.externalId).toBe("101");
    expect(out[0]?.tier).toBeUndefined(); // raw listings don't carry tier; the adapter does
    expect(adapter.tier).toBe("T2");
    expect(out[0]?.url).toBe("https://shopgoodwill.com/item/101");
  });

  test("normalizer converts auction dollar-numbers to exact cents", () => {
    const n = normalizeShopGoodwill({
      sourceCode: "shopgoodwill",
      externalId: "102",
      channel: "export",
      fetchedAt: "2026-07-04T00:00:00Z",
      payload: { itemId: 102, title: "Sealed game", currentPrice: 60.25, buyNowPrice: 90, numberOfBids: 0, categoryName: "Video Games" },
    });
    expect(n.priceCents).toBe(6_025n);
    expect(n.attrs["auction"]).toBe(true);
    expect(n.attrs["buyNowCents"]).toBe(9_000);
    expect(n.attrs["category"]).toBe("Video Games");
  });

  test("selfTest canary passes", async () => {
    const adapter = new ShopGoodwillWatchlistAdapter(new FakeTransport(), { watchlistUrl: "x" });
    expect(await adapter.selfTest()).toBe(true);
  });
});
