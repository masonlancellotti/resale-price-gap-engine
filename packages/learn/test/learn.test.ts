import { describe, expect, test } from "vitest";
import {
  brier,
  calibrationByBucket,
  type LabeledSample,
  mape,
  ModelRegistry,
  MultiplierValuationModel,
  type MultiplierObservation,
  refitMultipliers,
  refitWeights,
} from "../src/index.js";

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("calibration metrics", () => {
  test("MAPE and Brier compute as expected", () => {
    expect(mape([{ predictedCents: 100n, realizedCents: 80n }])).toBeCloseTo(0.25, 6);
    expect(brier([{ predictedProb: 0.9, outcome: 1 }, { predictedProb: 0.2, outcome: 0 }])).toBeCloseTo((0.01 + 0.04) / 2, 6);
  });
  test("calibrationByBucket groups and scores", () => {
    const rows = [
      { bucket: "high", predictedCents: 100n, realizedCents: 100n },
      { bucket: "low", predictedCents: 100n, realizedCents: 50n },
    ];
    const cal = calibrationByBucket(rows);
    expect(cal.find((c) => c.bucket === "high")?.mape).toBeCloseTo(0, 6);
    expect(cal.find((c) => c.bucket === "low")?.mape).toBeCloseTo(1, 6);
  });
});

describe("condition-multiplier refit with hierarchical shrinkage", () => {
  test("a thin category is pulled toward its parent, not its own noisy sample", () => {
    const obs: MultiplierObservation[] = [
      // category 2 has ONE noisy observation
      { categoryId: 2, parentId: 20, band: "good", ratio: 0.5 },
      // sibling category 3 under the same parent has lots of clean data ~0.9
      ...Array.from({ length: 20 }, () => ({ categoryId: 3, parentId: 20, band: "good" as const, ratio: 0.9 })),
    ];
    const m = refitMultipliers(obs, { priorStrength: 8, globalPrior: 1 });
    const thin = m.get("2:good")!;
    expect(thin).toBeGreaterThan(0.75); // pulled well above its own 0.5 toward the parent's ~0.9
    expect(thin).toBeLessThan(0.9);
  });
});

describe("score-weight refit", () => {
  test("up-weights the component that actually predicted profit", () => {
    // realized tracks `roi` and is independent of `effort`
    const rows = Array.from({ length: 30 }, (_, i) => ({
      components: { roi: i / 30, pProfit: 0.5, effort: (i % 3) / 3 },
      realized: i / 30,
    }));
    const priors = { roi: 0.34, pProfit: 0.33, effort: 0.33 };
    const w = refitWeights(rows, priors);
    expect(w.roi!).toBeGreaterThan(priors.roi);
    expect(Object.values(w).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
  });
});

describe("GATE — a refit ships via the registry and improves calibration", () => {
  test("champion (biased) → challenger (refit) promoted on strictly better MAPE", () => {
    const rng = mulberry32(11);
    // ground truth: category 1's 'good' items sell at 0.8× base
    const training: MultiplierObservation[] = Array.from({ length: 60 }, () => ({
      categoryId: 1,
      parentId: 10,
      band: "good",
      ratio: 0.8 * (1 + (rng() - 0.5) * 0.06),
    }));
    const validation: LabeledSample[] = Array.from({ length: 40 }, () => {
      const base = BigInt(5_000 + Math.floor(rng() * 10_000));
      const realized = BigInt(Math.round(Number(base) * 0.8 * (1 + (rng() - 0.5) * 0.06)));
      return { features: { categoryId: 1, band: "good", baseCents: base }, realizedCents: realized };
    });

    // champion assumes the wrong 1.0 multiplier → systematically overprices
    const champion = new MultiplierValuationModel("v1-prior", new Map([["1:good", 1.0]]));
    const registry = new ModelRegistry(champion);

    // challenger built from the refit
    const refit = refitMultipliers(training, { priorStrength: 8, globalPrior: 1 });
    registry.proposeChallenger(new MultiplierValuationModel("v2-refit", refit));

    const result = registry.tryPromote(validation);
    expect(result.promote).toBe(true);
    expect(result.challengerMape).toBeLessThan(result.championMape);
    expect(result.championMape).toBeGreaterThan(0.2); // ~25% off with the wrong multiplier
    expect(result.challengerMape).toBeLessThan(0.06); // refit is well-calibrated
    expect(registry.champion.version).toBe("v2-refit"); // it shipped
    expect(registry.history()[0]?.version).toBe("v1-prior"); // old champion archived
  });

  test("a challenger that doesn't beat the champion is NOT promoted", () => {
    const validation: LabeledSample[] = [
      { features: { categoryId: 1, band: "good", baseCents: 10_000n }, realizedCents: 8_000n },
    ];
    const champion = new MultiplierValuationModel("v1", new Map([["1:good", 0.8]])); // already perfect
    const registry = new ModelRegistry(champion);
    registry.proposeChallenger(new MultiplierValuationModel("v2", new Map([["1:good", 0.6]]))); // worse
    const result = registry.tryPromote(validation);
    expect(result.promote).toBe(false);
    expect(registry.champion.version).toBe("v1");
  });
});
