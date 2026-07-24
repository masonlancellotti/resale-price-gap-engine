import { describe, expect, test } from "vitest";
import { Analyst } from "@flip-desk/analyst";
import { GraduationEngine } from "@flip-desk/graduate";
import { FakeLlm } from "@flip-desk/llm";
import {
  anchoredStrategy,
  DeterministicSeller,
  fixedLowballStrategy,
  type NegotiationContext,
  runPopulation,
} from "@flip-desk/negotiate";
import {
  type LabeledSample,
  ModelRegistry,
  MultiplierValuationModel,
  type MultiplierObservation,
  refitMultipliers,
} from "@flip-desk/learn";

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

describe("Phase 4 gate — negotiation beats lowball, a refit ships, a class graduates", () => {
  test("all three gate conditions hold and the Analyst narrates them", async () => {
    const rng = mulberry32(4);

    // (1) Negotiation acceptance beats a fixed-lowball baseline.
    const ctx = (): NegotiationContext => ({ askCents: 10_000n, walkAwayCents: 8_500n, categorySlug: "games" });
    const population = Array.from({ length: 300 }, () => ({
      seller: new DeterministicSeller(BigInt(7_000 + Math.floor(rng() * 2_500))),
      ctx: ctx(),
    }));
    const anchored = runPopulation(anchoredStrategy(), population);
    const lowball = runPopulation(fixedLowballStrategy(), population);
    expect(anchored.closeRate).toBeGreaterThan(lowball.closeRate);
    expect(anchored.totalSurplusCents).toBeGreaterThan(lowball.totalSurplusCents);

    // (2) A model refit ships via the registry and improves calibration.
    const training: MultiplierObservation[] = Array.from({ length: 60 }, () => ({
      categoryId: 1,
      parentId: 10,
      band: "good",
      ratio: 0.8 * (1 + (rng() - 0.5) * 0.06),
    }));
    const validation: LabeledSample[] = Array.from({ length: 40 }, () => {
      const base = BigInt(5_000 + Math.floor(rng() * 10_000));
      return {
        features: { categoryId: 1, band: "good" as const, baseCents: base },
        realizedCents: BigInt(Math.round(Number(base) * 0.8)),
      };
    });
    const registry = new ModelRegistry(new MultiplierValuationModel("v1-prior", new Map([["1:good", 1.0]])));
    registry.proposeChallenger(new MultiplierValuationModel("v2-refit", refitMultipliers(training)));
    const promo = registry.tryPromote(validation);
    expect(promo.promote).toBe(true);
    expect(promo.challengerMape).toBeLessThan(promo.championMape);
    expect(registry.champion.version).toBe("v2-refit");

    // (3) At least one action class graduates L2 → L3 on merit.
    const grad = new GraduationEngine({ send_offer_ebay: "L2" });
    for (let i = 0; i < 25; i++) grad.record("send_offer_ebay", { approved: true, followedRecommendation: true, realizedOk: true });
    const graduated = grad.tryPromote("send_offer_ebay");
    expect(graduated).toBe(true);
    expect(grad.level("send_offer_ebay")).toBe("L3");

    // Analyst narrates the week over the real outputs above.
    const memo = await new Analyst(new FakeLlm(() => "Solid week: refit landed, offers auto-send now.")).memo({
      weekOf: "2026-08-24",
      flips: 14,
      netCents: 48_230n,
      regretRate: 1 - anchored.closeRate,
      calibration: { championMape: promo.championMape, challengerMape: promo.challengerMape, promotedVersion: registry.champion.version },
      graduations: [{ actionClass: "send_offer_ebay", from: "L2", to: "L3" }],
      requests: ["Enable T3 overlay on OfferUp"],
    });
    expect(memo.whatChanged.some((s) => s.includes("v2-refit"))).toBe(true);
    expect(memo.whatChanged.some((s) => s.includes("send_offer_ebay"))).toBe(true);
    expect(memo.wantsPermission).toContain("Enable T3 overlay on OfferUp");
  });
});
