import { describe, expect, test } from "vitest";
import type { Product } from "@flip-desk/core";
import { buildTitle, conditionPhrase, Lister, type ListableItem, profileFor } from "../src/index.js";

const product: Product = {
  id: 1,
  canonicalKey: "epid:123",
  categoryId: 1,
  brand: "Sony",
  model: "CECH-2001A",
  variant: { Storage: "160GB" },
  identifiers: { upc: "711719813125" },
  title: "PlayStation 3 Slim Console",
};

function item(over: Partial<ListableItem> = {}): ListableItem {
  return {
    sku: "FD-2026-00001",
    product,
    conditionBand: "good",
    priceCents: 12_000n,
    sourcePhotoKeys: ["img-a.jpg", "img-b.jpg"],
    ...over,
  };
}

describe("Lister content generation", () => {
  test("eBay title is keyword-packed, deduped, and within 80 chars", () => {
    const title = buildTitle(product, "good", profileFor("ebay"));
    expect(title.length).toBeLessThanOrEqual(80);
    expect(title).toContain("Sony");
    expect(title).toContain("CECH-2001A");
    // "PlayStation" appears once even though brand/model/title could repeat tokens
    expect(title.match(/PlayStation/gi)?.length ?? 0).toBeLessThanOrEqual(1);
  });

  test("Mercari title leads with brand, casual", () => {
    const title = buildTitle(product, "like_new", profileFor("mercari"));
    expect(title.startsWith("Sony")).toBe(true);
    expect(title).toContain("Like New");
  });

  test("draft carries honest condition + specifics + stable idempotency key", async () => {
    const draft = await new Lister().draftFor(item({ conditionBand: "fair", defects: ["light scratches"] }), "ebay");
    expect(draft.honestCondition).toBe("fair");
    expect(draft.description).toContain(conditionPhrase("fair"));
    expect(draft.description).toContain("light scratches");
    expect(draft.description).toContain("actual item");
    expect(draft.specifics["Brand"]).toBe("Sony");
    expect(draft.specifics["Storage"]).toBe("160GB");
    expect(draft.specifics["UPC"]).toBe("711719813125");
    expect(draft.idempotencyKey).toBe("list:FD-2026-00001:ebay");
  });

  test("photo pipeline strips EXIF/GPS and crops to the platform spec", async () => {
    const draft = await new Lister().draftFor(item(), "ebay");
    expect(draft.photos).toHaveLength(2);
    for (const p of draft.photos) {
      expect(p.gpsStripped).toBe(true);
      expect(p.exifStripped).toBe(true);
      expect(p.aspect).toBe("1:1");
    }
  });

  test("draftAll produces one draft per channel", async () => {
    const drafts = await new Lister().draftAll(item(), ["ebay", "mercari"]);
    expect(drafts.map((d) => d.platform)).toEqual(["ebay", "mercari"]);
    expect(new Set(drafts.map((d) => d.idempotencyKey)).size).toBe(2);
  });
});
