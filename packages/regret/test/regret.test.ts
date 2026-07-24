import { describe, expect, test } from "vitest";
import { RegretWatcher } from "../src/index.js";

describe("RegretWatcher (§7.7)", () => {
  function seeded(): RegretWatcher {
    const w = new RegretWatcher();
    w.watch({ listingId: "A", skippedAt: "2026-07-01T00:00:00Z", skipReason: "below_floor", askCents: 5_000n, predictedResaleP50Cents: 9_000n, predictedNetCents: 2_000n });
    w.watch({ listingId: "B", skippedAt: "2026-07-01T00:00:00Z", skipReason: "unprofitable", askCents: 8_000n, predictedResaleP50Cents: 9_000n, predictedNetCents: -500n });
    w.watch({ listingId: "C", skippedAt: "2026-07-01T00:00:00Z", skipReason: "low_confidence", askCents: 4_000n, predictedResaleP50Cents: 12_000n, predictedNetCents: 3_000n });
    return w;
  }

  test("a profitable listing that sold elsewhere is a miss with a delta", () => {
    const w = seeded();
    const rec = w.resolve("A", { finalStatus: "sold", finalPriceCents: 10_000n });
    expect(rec?.missed).toBe(true);
    expect(rec?.deltaVsPredictionCents).toBe(1_000n); // 10000 − 9000 predicted
  });

  test("a correctly-skipped unprofitable listing is not a miss even if it sold", () => {
    const w = seeded();
    const rec = w.resolve("B", { finalStatus: "sold" });
    expect(rec?.missed).toBe(false);
  });

  test("an expired listing is never a miss", () => {
    const w = seeded();
    const rec = w.resolve("C", { finalStatus: "expired" });
    expect(rec?.missed).toBe(false);
  });

  test("summary computes regret rate over resolved listings", () => {
    const w = seeded();
    w.resolve("A", { finalStatus: "sold", finalPriceCents: 10_000n });
    w.resolve("B", { finalStatus: "sold" });
    w.resolve("C", { finalStatus: "expired" });
    const s = w.summary();
    expect(s.watched).toBe(3);
    expect(s.resolved).toBe(3);
    expect(s.sold).toBe(2);
    expect(s.missedDeals).toBe(1);
    expect(s.regretRate).toBeCloseTo(1 / 3, 5);
  });

  test("resolving an unknown listing returns undefined", () => {
    expect(new RegretWatcher().resolve("nope", { finalStatus: "sold" })).toBeUndefined();
  });
});
