import { describe, expect, test } from "vitest";
import type { CompQuery, Product } from "@flip-desk/core";
import { FakeTransport, jsonResponse } from "@flip-desk/net";
import {
  BrickLinkProvider,
  conditionToBand,
  DiscogsProvider,
  ReverbProvider,
  VendorCompProvider,
} from "../src/index.js";

const now = () => new Date("2026-07-04T00:00:00.000Z");
function product(over: Partial<Product>): Product {
  return { id: 1, canonicalKey: "x:1", categoryId: 1, variant: {}, title: "Thing", ...over };
}

describe("Discogs provider (vinyl)", () => {
  test("maps grade suggestions to condition bands", async () => {
    const transport = new FakeTransport().on(
      "/marketplace/price_suggestions/",
      jsonResponse(200, {
        "Mint (M)": { value: 30, currency: "USD" },
        "Near Mint (NM or M-)": { value: 24, currency: "USD" },
        "Very Good (VG)": { value: 12.5, currency: "USD" },
      }),
    );
    const comps = await new DiscogsProvider(transport, { now }).fetchComps({
      product: product({ canonicalKey: "discogs:249504", categoryId: 3 }),
    });
    const byBand = comps.map((c) => [c.conditionBand, c.priceCents] as const);
    expect(byBand).toContainEqual(["new", 3000n]);
    expect(byBand).toContainEqual(["like_new", 2400n]);
    expect(byBand).toContainEqual(["good", 1250n]); // Very Good (VG) → good
  });
});

describe("BrickLink provider (LEGO)", () => {
  test("maps used/new averages", async () => {
    const transport = new FakeTransport().on("/price?guide_type=sold", jsonResponse(200, { usedAvgCents: 14500, newAvgCents: 26000 }));
    const comps = await new BrickLinkProvider(transport, { now }).fetchComps({
      product: product({ canonicalKey: "bl:75192-1", categoryId: 4 }),
    });
    expect(comps.find((c) => c.conditionBand === "good")?.priceCents).toBe(14500n);
    expect(comps.find((c) => c.conditionBand === "new")?.priceCents).toBe(26000n);
  });
});

describe("Reverb provider (music gear)", () => {
  test("maps low/median/high to fair/good/like_new", async () => {
    const transport = new FakeTransport().on("/priceguide/", jsonResponse(200, { lowCents: 18000, medianCents: 22000, highCents: 26000 }));
    const comps = await new ReverbProvider(transport, { now }).fetchComps({
      product: product({ canonicalKey: "reverb:abc", categoryId: 5 }),
    });
    expect(comps.map((c) => c.conditionBand).sort()).toEqual(["fair", "good", "like_new"]);
  });
});

describe("VendorCompProvider (T1 gap-filler)", () => {
  const query: CompQuery = { product: product({ brand: "Sony", model: "PS5" }) };

  test("returns individual sold comps with real seller diversity", async () => {
    const transport = new FakeTransport().on("/sold?q=", jsonResponse(200, {
      items: [
        { priceCents: 30000, condition: "Used - Good", soldDate: "2026-06-28", seller: "buyer_a" },
        { priceCents: 32000, condition: "brand new", soldDate: "2026-06-29", seller: "buyer_b" },
        { priceCents: 0, condition: "junk", seller: "buyer_c" }, // dropped (non-positive)
      ],
    }));
    const provider = new VendorCompProvider("vendor:apify", transport, { apiKey: "k", now });
    const comps = await provider.fetchComps(query);
    expect(comps).toHaveLength(2);
    expect(new Set(comps.map((c) => c.sellerKey)).size).toBe(2);
    expect(comps.find((c) => c.conditionBand === "new")?.priceCents).toBe(32000n);
    expect(provider.tier).toBe("T1");
  });

  test("sends the vendor API key", async () => {
    const transport = new FakeTransport().on("/sold?q=", jsonResponse(200, { items: [] }));
    await new VendorCompProvider("vendor:x", transport, { apiKey: "secret" }).fetchComps(query);
    expect(transport.calls[0]!.headers?.["x-api-key"]).toBe("secret");
  });
});

describe("conditionToBand", () => {
  test.each([
    ["Brand New (Sealed)", "new"],
    ["Like New / Mint", "like_new"],
    ["Used - Good", "good"],
    ["Acceptable, worn", "fair"],
    ["For parts / not working", "parts"],
  ] as const)("%s -> %s", (input, band) => {
    expect(conditionToBand(input)).toBe(band);
  });
});
