import { describe, expect, test } from "vitest";
import type { Comp, ConditionBand } from "@flip-desk/core";
import { appraise } from "../src/index.js";

const AS_OF = "2026-07-04T00:00:00.000Z";
const DAY = 86_400_000;

function comp(
  priceCents: bigint,
  opts: { band?: ConditionBand; daysAgo?: number; seller?: string; provider?: string } = {},
): Comp {
  const daysAgo = opts.daysAgo ?? 10;
  return {
    productId: 1,
    provider: opts.provider ?? "pricecharting",
    conditionBand: opts.band ?? "good",
    priceCents,
    soldAt: new Date(Date.parse(AS_OF) - daysAgo * DAY).toISOString().slice(0, 10),
    ...(opts.seller !== undefined ? { sellerKey: opts.seller } : {}),
  };
}

describe("appraise — valuation from comps (§7.4)", () => {
  test("robust P50 near the true median; MAD rejects an outlier", () => {
    const prices = [13_800n, 14_000n, 14_200n, 14_300n, 14_500n, 14_600n, 14_800n, 15_000n, 15_200n];
    const comps = prices.map((p, i) => comp(p, { seller: `seller-${i}`, daysAgo: 5 + i * 3 }));
    comps.push(comp(20_000n, { seller: "seller-outlier", daysAgo: 8 })); // fat outlier

    const a = appraise({ productId: 1, targetBand: "good", comps, asOf: AS_OF });

    expect(a.nComps).toBe(9); // outlier rejected
    expect(a.p50Cents).toBeGreaterThan(13_800n);
    expect(a.p50Cents).toBeLessThan(15_200n);
    expect(a.p90Cents).toBeLessThan(16_500n); // outlier didn't drag P90 to 20k
    expect(a.p10Cents).toBeLessThanOrEqual(a.p50Cents);
    expect(a.p50Cents).toBeLessThanOrEqual(a.p90Cents);
    expect(a.flags).not.toContain("low_seller_diversity");
    expect(a.confidence).toBeGreaterThan(0.6);
  });

  test("adjacent-band comps are transformed to the target band", () => {
    // 6 like_new comps at ~$200 → target 'good' should land near $200 × 0.8 = $160.
    const comps = Array.from({ length: 6 }, (_, i) =>
      comp(20_000n + BigInt(i * 100), { band: "like_new", seller: `s${i}`, daysAgo: 10 + i }),
    );
    const a = appraise({ productId: 1, targetBand: "good", comps, asOf: AS_OF });
    expect(a.p50Cents).toBeGreaterThan(15_000n);
    expect(a.p50Cents).toBeLessThan(17_000n);
  });

  test("flags low seller diversity and dents confidence", () => {
    const shill = Array.from({ length: 6 }, (_, i) => comp(14_000n + BigInt(i * 50), { seller: "one-guy" }));
    const diverse = Array.from({ length: 6 }, (_, i) => comp(14_000n + BigInt(i * 50), { seller: `s${i}` }));
    const a = appraise({ productId: 1, targetBand: "good", comps: shill, asOf: AS_OF });
    const b = appraise({ productId: 1, targetBand: "good", comps: diverse, asOf: AS_OF });
    expect(a.flags).toContain("low_seller_diversity");
    expect(b.flags).not.toContain("low_seller_diversity");
    expect(a.confidence).toBeLessThan(b.confidence);
  });

  test("thin comps widen the window, flag, and lower confidence", () => {
    const recent = [comp(14_000n, { seller: "a", daysAgo: 5 }), comp(14_200n, { seller: "b", daysAgo: 6 })];
    const older = [comp(14_100n, { seller: "c", daysAgo: 120 }), comp(14_300n, { seller: "d", daysAgo: 140 })];
    const a = appraise({ productId: 1, targetBand: "good", comps: [...recent, ...older], asOf: AS_OF });
    expect(a.windowDaysUsed).toBe(180);
    expect(a.flags).toContain("stale_comps");
    // 4 comps < min 5 → also thin
    expect(a.flags).toContain("thin_comps");
    expect(a.confidence).toBeLessThan(0.6);
  });

  test("liquidity: TTS curve is monotonic (cheaper → sells faster) and sell-through in (0,1)", () => {
    const comps = Array.from({ length: 12 }, (_, i) =>
      comp(14_000n + BigInt(i * 40), { seller: `s${i}`, daysAgo: 3 + i * 5 }),
    );
    const a = appraise({ productId: 1, targetBand: "good", comps, asOf: AS_OF, activeCount: 20 });
    expect(a.priceTtsCurve).toHaveLength(5);
    const days = a.priceTtsCurve.map((p) => p.expDays);
    for (let i = 1; i < days.length; i++) expect(days[i]!).toBeGreaterThanOrEqual(days[i - 1]!);
    expect(a.sellThrough90d).toBeGreaterThan(0);
    expect(a.sellThrough90d).toBeLessThan(1);
    expect(a.ttsDaysP50).toBeDefined();
    expect(a.ttsDaysP90!).toBeGreaterThan(a.ttsDaysP50!);
  });

  test("category drift flag and confidence haircut", () => {
    const comps = Array.from({ length: 10 }, (_, i) => comp(14_000n + BigInt(i * 50), { seller: `s${i}` }));
    const stable = appraise({ productId: 1, targetBand: "good", comps, asOf: AS_OF, categoryTrend30d: 0.05 });
    const drifting = appraise({ productId: 1, targetBand: "good", comps, asOf: AS_OF, categoryTrend30d: -0.22 });
    expect(stable.flags).not.toContain("category_drift");
    expect(drifting.flags).toContain("category_drift");
    expect(drifting.confidence).toBeLessThan(stable.confidence);
  });
});
