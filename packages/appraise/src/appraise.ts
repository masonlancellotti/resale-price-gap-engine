import { CONDITION_BANDS, type Comp, type ConditionBand } from "@flip-desk/core";
import type { Cents } from "@flip-desk/money";
import { clamp, decayWeight, madFilter, weightedQuantile } from "@flip-desk/stats";

/**
 * Condition-band multipliers relative to `like_new = 1.0` (plan §7.3). A comp sold in band B is
 * transformed to the target band T by `price × mult[T] / mult[B]`. Category rubrics override this.
 */
export const DEFAULT_BAND_MULTIPLIERS: Readonly<Record<ConditionBand, number>> = {
  new: 1.15,
  like_new: 1.0,
  good: 0.8,
  fair: 0.6,
  parts: 0.3,
};

const DAY_MS = 86_400_000;

export type AppraisalFlag =
  | "thin_comps"
  | "low_seller_diversity"
  | "high_dispersion"
  | "category_drift"
  | "stale_comps";

export interface AppraiseInput {
  readonly productId: number;
  readonly targetBand: ConditionBand;
  readonly comps: readonly Comp[];
  /** ISO date treated as "now" for recency. */
  readonly asOf: string;
  readonly activeCount?: number;
  readonly matchConfidence?: number; // [0,1] from the identifier
  readonly conditionCertainty?: number; // [0,1] from grading
  readonly categoryTrend30d?: number; // signed EWMA move; |·|>0.15 → drift
  readonly bandMultipliers?: Readonly<Record<ConditionBand, number>>;
  readonly windowDays?: number; // default 90 (extends to 180 when thin)
  readonly halfLifeDays?: number; // default 30
  readonly minComps?: number; // default 5
  readonly modelVersion?: string;
}

export interface TtsPoint {
  readonly priceRatio: number;
  readonly expDays: number;
}

export interface Appraisal {
  readonly productId: number;
  readonly conditionBand: ConditionBand;
  readonly modelVersion: string;
  readonly nComps: number;
  readonly windowDaysUsed: number;
  readonly providers: readonly string[];
  readonly p10Cents: Cents;
  readonly p50Cents: Cents;
  readonly p90Cents: Cents;
  readonly sellThrough90d: number | undefined;
  readonly ttsDaysP50: number | undefined;
  readonly ttsDaysP90: number | undefined;
  readonly priceTtsCurve: readonly TtsPoint[];
  readonly trend30d: number | undefined;
  readonly confidence: number;
  readonly flags: readonly AppraisalFlag[];
}

function bandIndex(b: ConditionBand): number {
  return CONDITION_BANDS.indexOf(b);
}

function ageDays(soldAt: string, asOf: string): number {
  return (Date.parse(asOf) - Date.parse(soldAt)) / DAY_MS;
}

/**
 * Turn a set of sold comps into a condition-adjusted valuation distribution with calibrated
 * uncertainty (plan §7.4). Robust throughout: adjacent-band transforms, seller-diversity guard
 * against shill comps, MAD outlier rejection, recency-decayed weighted quantiles.
 */
export function appraise(input: AppraiseInput): Appraisal {
  const mult = input.bandMultipliers ?? DEFAULT_BAND_MULTIPLIERS;
  const halfLife = input.halfLifeDays ?? 30;
  const minComps = input.minComps ?? 5;
  const baseWindow = input.windowDays ?? 90;
  const targetIdx = bandIndex(input.targetBand);
  const flags = new Set<AppraisalFlag>();

  // Keep comps within one band of target (transform admits adjacent bands; far bands excluded).
  const admissible = input.comps.filter((c) => Math.abs(bandIndex(c.conditionBand) - targetIdx) <= 1);

  const transformedAt = (windowDays: number) =>
    admissible
      .filter((c) => ageDays(c.soldAt, input.asOf) <= windowDays)
      .map((c) => {
        const from = mult[c.conditionBand];
        const to = mult[input.targetBand];
        return {
          comp: c,
          price: Number(c.priceCents) * (to / from),
          age: Math.max(0, ageDays(c.soldAt, input.asOf)),
        };
      });

  // Widen the window if the base window is thin (plan §7.4: extend to 180d with recency decay).
  let windowUsed = baseWindow;
  let points = transformedAt(baseWindow);
  if (points.length < minComps && baseWindow < 180) {
    windowUsed = 180;
    points = transformedAt(180);
    flags.add("stale_comps");
  }

  // MAD outlier rejection on transformed prices.
  const kept = madFilter(points, (p) => p.price, 3);

  // Distinct sellers — the shill-comp diversity guard (plan §7.4). Fall back to a synthetic key
  // when a comp has no seller_key so we don't over-count anonymous comps as one seller.
  const sellerCount = new Set(kept.map((p) => p.comp.sellerKey ?? `anon:${p.comp.provider}:${p.price}`)).size;
  if (sellerCount < 3) flags.add("low_seller_diversity");

  const n = kept.length;
  if (n < minComps) flags.add("thin_comps");

  // Recency-decayed weighted quantiles.
  const weighted = kept.map((p) => ({ value: p.price, weight: decayWeight(p.age, halfLife) }));
  const q = (frac: number): Cents =>
    weighted.length > 0 ? BigInt(Math.max(0, Math.round(weightedQuantile(weighted, frac)))) : 0n;
  const p10 = q(0.1);
  const p50 = q(0.5);
  const p90 = q(0.9);

  // Dispersion flag: a wide relative spread widens uncertainty and dents confidence.
  const dispersion = Number(p50) > 0 ? Number(p90 - p10) / Number(p50) : 1;
  if (dispersion > 0.8) flags.add("high_dispersion");

  // Liquidity + time-to-sale (plan §7.4).
  const sold90 = admissible.filter((c) => ageDays(c.soldAt, input.asOf) <= 90).length;
  let sellThrough: number | undefined;
  let ttsP50: number | undefined;
  let ttsP90: number | undefined;
  const curve: TtsPoint[] = [];
  if (input.activeCount !== undefined) {
    sellThrough = sold90 + input.activeCount > 0 ? sold90 / (sold90 + input.activeCount) : undefined;
    const dailySold = sold90 / 90;
    const hazardP50 = dailySold / (input.activeCount + 1); // your item vs the competing actives
    if (hazardP50 > 0) {
      ttsP50 = Math.min(365, Math.round(1 / hazardP50));
      ttsP90 = Math.min(730, Math.round(2.302585 / hazardP50)); // exp dist P90 ≈ 2.303·mean
      const elasticity = 3;
      for (const r of [0.85, 0.95, 1.0, 1.05, 1.15]) {
        const hazard = hazardP50 * Math.exp(-elasticity * (r - 1));
        curve.push({ priceRatio: r, expDays: Math.min(365, Math.round(1 / hazard)) });
      }
    }
  }

  // Drift.
  const trend = input.categoryTrend30d;
  if (trend !== undefined && Math.abs(trend) > 0.15) flags.add("category_drift");

  // Confidence — multiplicative haircuts, clamped to [0,1] (plan §7.4).
  let confidence = 1;
  confidence *= clamp(n / 12, 0.3, 1); // comp count
  confidence *= clamp(1 - dispersion / 2, 0.3, 1); // dispersion
  confidence *= input.matchConfidence ?? 1;
  confidence *= input.conditionCertainty ?? 1;
  if (flags.has("low_seller_diversity")) confidence *= 0.7;
  if (flags.has("stale_comps")) confidence *= 0.85;
  if (flags.has("category_drift")) confidence *= 0.8;
  confidence = clamp(confidence, 0, 1);

  const providers = [...new Set(kept.map((p) => p.comp.provider))].sort();

  return {
    productId: input.productId,
    conditionBand: input.targetBand,
    modelVersion: input.modelVersion ?? "appraise-v1",
    nComps: n,
    windowDaysUsed: windowUsed,
    providers,
    p10Cents: p10,
    p50Cents: p50,
    p90Cents: p90,
    sellThrough90d: sellThrough,
    ttsDaysP50: ttsP50,
    ttsDaysP90: ttsP90,
    priceTtsCurve: curve,
    trend30d: trend,
    confidence,
    flags: [...flags],
  };
}
