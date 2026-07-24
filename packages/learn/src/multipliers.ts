import type { ConditionBand } from "@flip-desk/core";

/**
 * Condition-multiplier refit with hierarchical shrinkage (plan §7.7): the multiplier for a
 * (category, band) is estimated from that category's own sales, but shrunk toward its PARENT
 * category's estimate, which is itself shrunk toward the GLOBAL mean. Thin categories borrow
 * strength from their parent so a handful of noisy sales can't swing them; rich categories rely on
 * their own data. This is the "category ← parent ← global" pooling the plan calls for.
 */
export interface MultiplierObservation {
  readonly categoryId: number;
  readonly parentId: number;
  readonly band: ConditionBand;
  /** realized sale price ÷ the band's base/reference price. */
  readonly ratio: number;
}

export interface ShrinkageConfig {
  /** Pseudo-count k: higher = stronger pull toward the parent/global prior. */
  readonly priorStrength: number;
  /** Global fallback when there's no data at all. */
  readonly globalPrior?: number;
}

export const DEFAULT_SHRINKAGE: ShrinkageConfig = { priorStrength: 8, globalPrior: 1 };

function mean(xs: readonly number[]): number {
  return xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;
}

/** Shrink a group's raw mean toward a prior by pseudo-count k. */
function shrink(groupMean: number, n: number, prior: number, k: number): number {
  return (n * groupMean + k * prior) / (n + k);
}

export function refitMultipliers(
  obs: readonly MultiplierObservation[],
  cfg: ShrinkageConfig = DEFAULT_SHRINKAGE,
): Map<string, number> {
  const k = cfg.priorStrength;
  const globalMean = obs.length > 0 ? mean(obs.map((o) => o.ratio)) : (cfg.globalPrior ?? 1);

  // parent×band means, each shrunk toward the global mean.
  const parentGroups = new Map<string, number[]>();
  for (const o of obs) {
    const key = `${o.parentId}:${o.band}`;
    (parentGroups.get(key) ?? parentGroups.set(key, []).get(key)!).push(o.ratio);
  }
  const parentEstimate = new Map<string, number>();
  for (const [key, ratios] of parentGroups) {
    parentEstimate.set(key, shrink(mean(ratios), ratios.length, globalMean, k));
  }

  // category×band means, shrunk toward their parent estimate.
  const catGroups = new Map<string, { ratios: number[]; parentId: number; band: ConditionBand }>();
  for (const o of obs) {
    const key = `${o.categoryId}:${o.band}`;
    const g = catGroups.get(key) ?? { ratios: [], parentId: o.parentId, band: o.band };
    g.ratios.push(o.ratio);
    catGroups.set(key, g);
  }

  const out = new Map<string, number>();
  for (const [key, g] of catGroups) {
    const parentPrior = parentEstimate.get(`${g.parentId}:${g.band}`) ?? globalMean;
    out.set(key, shrink(mean(g.ratios), g.ratios.length, parentPrior, k));
  }
  return out;
}
