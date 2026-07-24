import { describe, expect, test } from "vitest";
import type { Comp, CompProvider, CompQuery, Product } from "@flip-desk/core";
import { FakeTransport, jsonResponse } from "@flip-desk/net";
import {
  CompRouter,
  KeepaProvider,
  PriceChartingProvider,
  TerapeakCache,
  TerapeakCacheProvider,
} from "../src/index.js";

const now = () => new Date("2026-07-04T00:00:00.000Z");
const product: Product = {
  id: 10,
  canonicalKey: "pcid:6910",
  categoryId: 1,
  brand: "Sony",
  model: "PS5",
  variant: {},
  identifiers: { pcid: "6910", asin: "B0ABCDEF" },
  title: "Sony PlayStation 5",
};
const query: CompQuery = { product };

describe("PriceCharting provider", () => {
  test("maps the price guide to condition-banded comps", async () => {
    const transport = new FakeTransport().on(
      "/api/product",
      jsonResponse(200, { "loose-price": 14000, "cib-price": 18000, "new-price": 25000 }),
    );
    const provider = new PriceChartingProvider(transport, { apiKey: "k", now });
    const comps = await provider.fetchComps(query);

    expect(comps).toHaveLength(3);
    const byBand = Object.fromEntries(comps.map((c) => [c.conditionBand, c.priceCents]));
    expect(byBand).toEqual({ good: 14000n, like_new: 18000n, new: 25000n });
    expect(comps.every((c) => c.provider === "pricecharting")).toBe(true);
    expect(comps[0]!.soldAt).toBe("2026-07-04");
  });

  test("category routing gate", () => {
    const p = new PriceChartingProvider(new FakeTransport(), { categories: [1, 2] });
    expect(p.supports(1)).toBe(true);
    expect(p.supports(99)).toBe(false);
  });
});

describe("Keepa provider", () => {
  test("maps Amazon average to a proxy comp", async () => {
    const transport = new FakeTransport().on("/product", jsonResponse(200, { avg30Cents: 20000 }));
    const comps = await new KeepaProvider(transport, { now }).fetchComps(query);
    expect(comps).toHaveLength(1);
    expect(comps[0]!.priceCents).toBe(20000n);
    expect(comps[0]!.conditionBand).toBe("new");
  });
});

describe("Terapeak export cache provider", () => {
  test("returns cached comps for the product", async () => {
    const cache = new TerapeakCache();
    const cached: Comp[] = [
      { productId: 10, provider: "terapeak", conditionBand: "good", priceCents: 15000n, soldAt: "2026-06-30", sellerKey: "s1" },
    ];
    cache.put(10, cached);
    const comps = await new TerapeakCacheProvider(cache).fetchComps(query);
    expect(comps).toEqual(cached);
  });
});

describe("CompRouter", () => {
  test("fans out by category and records provenance", async () => {
    const transport = new FakeTransport().on("/api/product", jsonResponse(200, { "loose-price": 14000 }));
    const cache = new TerapeakCache();
    cache.put(10, [{ productId: 10, provider: "terapeak", conditionBand: "good", priceCents: 15000n, soldAt: "2026-06-30", sellerKey: "s1" }]);
    const router = new CompRouter([
      new PriceChartingProvider(transport, { apiKey: "k", now, categories: [1] }),
      new TerapeakCacheProvider(cache),
    ]);
    const res = await router.fetch(query);
    expect(res.providers.sort()).toEqual(["pricecharting", "terapeak"]);
    expect(res.comps.length).toBe(2);
    expect(res.failed).toEqual([]);
  });

  test("isolates a failing provider (blast-radius)", async () => {
    const boom: CompProvider = {
      name: "flaky",
      tier: "T1",
      supports: () => true,
      fetchComps: () => Promise.reject(new Error("provider down")),
    };
    const cache = new TerapeakCache();
    cache.put(10, [{ productId: 10, provider: "terapeak", conditionBand: "good", priceCents: 15000n, soldAt: "2026-06-30", sellerKey: "s1" }]);
    const router = new CompRouter([boom, new TerapeakCacheProvider(cache)]);
    const res = await router.fetch(query);
    expect(res.failed).toContain("flaky");
    expect(res.providers).toContain("terapeak");
    expect(res.comps).toHaveLength(1);
  });
});
