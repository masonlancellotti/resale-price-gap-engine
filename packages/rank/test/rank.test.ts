import { describe, expect, test } from "vitest";
import {
  bandFor,
  DEFAULT_SIZING,
  liquidityScore,
  positionSize,
  score,
} from "../src/index.js";

describe("opportunity score (§7.6)", () => {
  test("a strong deal lands in push band", () => {
    const r = score({ roi: 1.5, pProfit: 0.95, confidence: 0.95, laborMinutes: 15, sellThrough90d: 0.85, ttsDaysP50: 4 });
    expect(r.score).toBeGreaterThanOrEqual(85);
    expect(r.band).toBe("push");
    expect(r.hardBlock).toBe(false);
  });

  test("a weak deal lands in archive band", () => {
    const r = score({ roi: 0.15, pProfit: 0.4, confidence: 0.4, laborMinutes: 110, sellThrough90d: 0.1, ttsDaysP50: 55 });
    expect(r.score).toBeLessThan(55);
    expect(r.band).toBe("archive");
  });

  test("risk penalties lower the score", () => {
    const base = score({ roi: 1.0, pProfit: 0.8, confidence: 0.8, laborMinutes: 30, sellThrough90d: 0.6, ttsDaysP50: 10 });
    const penalized = score({
      roi: 1.0,
      pProfit: 0.8,
      confidence: 0.8,
      laborMinutes: 30,
      sellThrough90d: 0.6,
      ttsDaysP50: 10,
      riskFlags: ["counterfeit_risk", "oversize"],
    });
    expect(penalized.penalties).toBe(26);
    expect(penalized.score).toBe(Math.max(0, base.score - 26));
  });

  test("stolen_risk hard-blocks to archive regardless of a great score", () => {
    const r = score({
      roi: 1.5,
      pProfit: 0.99,
      confidence: 0.95,
      laborMinutes: 10,
      sellThrough90d: 0.9,
      ttsDaysP50: 3,
      riskFlags: ["stolen_risk"],
    });
    expect(r.hardBlock).toBe(true);
    expect(r.band).toBe("archive");
  });

  test("bandFor thresholds", () => {
    expect(bandFor(85, false)).toBe("push");
    expect(bandFor(84.9, false)).toBe("feed");
    expect(bandFor(70, false)).toBe("feed");
    expect(bandFor(55, false)).toBe("digest");
    expect(bandFor(54.9, false)).toBe("archive");
  });

  test("liquidityScore: cheaper/faster is more liquid; no signal is neutral", () => {
    expect(liquidityScore(0.8, 5)).toBeGreaterThan(liquidityScore(0.2, 50));
    expect(liquidityScore(undefined, undefined)).toBe(0.5);
  });
});

describe("position sizing (§7.6)", () => {
  const bankroll = { totalCents: 350_000n, deployedCents: 0n }; // $3,500 bankroll (Appendix B)

  test("per-deal cap is 5% of bankroll", () => {
    const r = positionSize({ bankroll, confidence: 0.9, allInCents: 10_000n });
    expect(r.capCents).toBe(17_500n); // 5% of $3,500 = $175
    expect(r.allowed).toBe(true);
    expect(r.bindingConstraint).toBe("per_deal");
  });

  test("low confidence halves the per-deal cap", () => {
    const r = positionSize({ bankroll, confidence: 0.5, allInCents: 10_000n });
    expect(r.capCents).toBe(8_750n); // halved
    expect(r.confidenceHalved).toBe(true);
    expect(r.bindingConstraint).toBe("confidence_halved");
  });

  test("deployed ceiling (80%) binds when the bankroll is nearly full", () => {
    const r = positionSize({
      bankroll: { totalCents: 350_000n, deployedCents: 279_000n },
      confidence: 0.9,
      allInCents: 5_000n,
    });
    expect(r.capCents).toBe(1_000n); // 80% of 3,500 = 2,800 deployed limit; 2,800 - 2,790 = $10 room
    expect(r.allowed).toBe(false); // needs $50, only $10 of room
    expect(r.bindingConstraint).toBe("deployed_room");
  });

  test("category exposure (25%) binds", () => {
    const r = positionSize({
      bankroll: { totalCents: 350_000n, deployedCents: 50_000n, categoryDeployedCents: 86_000n },
      confidence: 0.9,
      allInCents: 5_000n,
    });
    // 25% of 3,500 = $875 category cap; 875 - 860 = $15 room, tighter than the $175 per-deal cap.
    expect(r.capCents).toBe(1_500n);
    expect(r.bindingConstraint).toBe("category_room");
  });

  test("DEFAULT_SIZING matches the plan", () => {
    expect(DEFAULT_SIZING).toEqual({
      maxPerDealPct: 5,
      maxDeployedPct: 80,
      categoryExposurePct: 25,
      lowConfidenceThreshold: 0.6,
    });
  });
});
