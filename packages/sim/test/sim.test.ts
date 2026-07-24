import { describe, expect, test } from "vitest";
import { computeTearsheet, renderHtml, renderMarkdown, runSim, xirr } from "../src/index.js";

describe("simulation — determinism", () => {
  test("same seed → identical result, tearsheet, and HTML bytes", async () => {
    const a = await runSim({ days: 45, seed: 42 });
    const b = await runSim({ days: 45, seed: 42 });
    expect(JSON.stringify(a, jsonBig)).toEqual(JSON.stringify(b, jsonBig));

    const ta = computeTearsheet(a);
    const tb = computeTearsheet(b);
    expect(ta.finalEquityCents).toEqual(tb.finalEquityCents);
    expect(renderHtml(a, ta)).toEqual(renderHtml(b, tb));
    expect(renderMarkdown(a, ta)).toEqual(renderMarkdown(b, tb));
  });

  test("different seeds → different runs", async () => {
    const a = await runSim({ days: 45, seed: 42 });
    const b = await runSim({ days: 45, seed: 7 });
    expect(a.finalEquityCents).not.toEqual(b.finalEquityCents);
  });
});

describe("simulation — invariants", () => {
  test("ledger is balanced at every day boundary", async () => {
    const r = await runSim({ days: 60, seed: 42 });
    expect(r.daily).not.toHaveLength(0);
    for (const d of r.daily) expect(d.ledgerBalanced).toBe(true);
  });

  test("drives the real engine: it buys, holds, and settles real flips", async () => {
    const r = await runSim({ days: 90, seed: 42 });
    expect(r.listingsSeen).toBeGreaterThan(100);
    expect(r.listingsTaken).toBeGreaterThan(0);
    expect(r.flips.length).toBeGreaterThan(0);
    // Every flip carries a real appraisal band and a hold time.
    for (const f of r.flips) {
      expect(f.predP10Cents).toBeLessThanOrEqual(f.predP90Cents);
      expect(f.holdDays).toBeGreaterThanOrEqual(1);
    }
  });

  test("equity accounting closes: final equity = contributions + net profit", async () => {
    const r = await runSim({ days: 90, seed: 42 });
    const t = computeTearsheet(r);
    // net profit reflects only SETTLED flips; open inventory sits at cost basis (no P&L yet), so
    // equity = contributions + realized net + (unrealized markup on open stock = 0 at cost).
    expect(t.finalEquityCents).toEqual(t.totalContributionsCents + t.netProfitCents);
  });
});

describe("tearsheet math", () => {
  test("IRR of a single-contribution, single-return series matches the closed form", () => {
    // -$1000 at day 0, +$1100 at day 365 → 10% annual.
    const irr = xirr([
      { day: 0, amountCents: -100_000n },
      { day: 365, amountCents: 110_000n },
    ]);
    expect(irr).toBeCloseTo(0.1, 3);
  });

  test("IRR is 0 when there is no sign change", () => {
    expect(xirr([{ day: 0, amountCents: -100_000n }])).toBe(0);
  });

  test("calibration coverage is a proper fraction in [0,1]", async () => {
    const r = await runSim({ days: 90, seed: 42 });
    const t = computeTearsheet(r);
    expect(t.calibration.n).toBe(r.flips.length);
    expect(t.calibration.coverageP10P90).toBeGreaterThanOrEqual(0);
    expect(t.calibration.coverageP10P90).toBeLessThanOrEqual(1);
    expect(t.calibration.coverageP25P75).toBeGreaterThanOrEqual(0);
    expect(t.calibration.coverageP25P75).toBeLessThanOrEqual(1);
  });

  test("per-category rollup sums to the whole", async () => {
    const r = await runSim({ days: 90, seed: 42 });
    const t = computeTearsheet(r);
    const catFlips = t.categories.reduce((s, c) => s + c.flips, 0);
    expect(catFlips).toBe(t.flips);
    const catNet = t.categories.reduce((s, c) => s + c.netCents, 0n);
    expect(catNet).toEqual(t.netProfitCents);
  });
});

/** JSON replacer that stringifies bigint so deep-equality survives serialization. */
function jsonBig(_k: string, v: unknown): unknown {
  return typeof v === "bigint" ? `${v}n` : v;
}
