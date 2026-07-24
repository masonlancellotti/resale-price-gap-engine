import { describe, expect, test } from "vitest";
import { floorPrice, DEFAULT_PRICE_POLICY, reprice, type RepriceInput } from "../src/index.js";

const LISTED = "2026-06-01T00:00:00.000Z";
function at(days: number): Date {
  return new Date(Date.parse(LISTED) + days * 86_400_000);
}
function input(over: Partial<RepriceInput> = {}): RepriceInput {
  return {
    costBasisCents: 5_000n,
    originalListCents: 12_000n,
    currentPriceCents: 12_000n,
    listedAt: LISTED,
    ttsDaysP50: 10,
    ...over,
  };
}

describe("Pricer — TTS-curve markdown ladder", () => {
  test("fresh listing holds", () => {
    const d = reprice(input(), at(3)); // 0.3× TTS
    expect(d.action).toBe("hold");
    expect(d.newPriceCents).toBe(12_000n);
  });

  test("past 1× TTS → 8% cut", () => {
    const d = reprice(input(), at(11)); // 1.1× TTS
    expect(d.action).toBe("markdown");
    expect(d.newPriceCents).toBe(11_040n); // 12000 × 0.92
  });

  test("deep age → 25% cut, applied off the ORIGINAL list", () => {
    const d = reprice(input({ currentPriceCents: 11_040n }), at(25)); // 2.5× TTS
    expect(d.action).toBe("markdown");
    expect(d.newPriceCents).toBe(9_000n); // 12000 × 0.75
  });

  test("markdown never drops below the floor", () => {
    // floor = 5000 + max(500, 10%·5000=500) = 5500
    const floor = floorPrice(5_000n, DEFAULT_PRICE_POLICY);
    expect(floor).toBe(5_500n);
    const d = reprice(input({ originalListCents: 6_000n, currentPriceCents: 6_000n }), at(100));
    expect(d.newPriceCents).toBe(floor); // 6000×0.75=4500 < floor → clamped to 5500
    expect(d.newPriceCents).toBeGreaterThanOrEqual(floor);
  });

  test("never raises price", () => {
    const d = reprice(input({ currentPriceCents: 8_000n }), at(11)); // ladder target 11040 > current
    expect(d.newPriceCents).toBe(8_000n);
    expect(d.action).toBe("hold");
  });
});

describe("Pricer — watcher offers", () => {
  test("enough watchers on a stale listing → an offer below list", () => {
    const d = reprice(input({ watcherCount: 3 }), at(8)); // 0.8× TTS, ≥0.75 threshold
    expect(d.offerPriceCents).toBe(10_800n); // 12000 × 0.90
    expect(d.action).toBe("offer_watchers");
  });

  test("too few watchers → no offer", () => {
    const d = reprice(input({ watcherCount: 1 }), at(8));
    expect(d.offerPriceCents).toBeUndefined();
  });

  test("respects the offer cooldown", () => {
    const d = reprice(input({ watcherCount: 3, lastOfferAt: at(7).toISOString() }), at(8)); // 1 day < 3-day cooldown
    expect(d.offerPriceCents).toBeUndefined();
  });

  test("markdown takes priority but still emits the offer price", () => {
    const d = reprice(input({ watcherCount: 3 }), at(12)); // markdown age + watchers
    expect(d.action).toBe("markdown");
    expect(d.offerPriceCents).toBeDefined();
  });
});
