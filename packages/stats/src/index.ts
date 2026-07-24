/**
 * Small numeric toolkit shared by the appraiser and underwriter (plan §7.4, §7.5). Stats run in
 * float `number`; money is rounded back to integer cents at the boundary by callers. Nothing here
 * touches currency directly.
 */

/** z-score for the 90th percentile of the standard normal (Φ⁻¹(0.9)). */
export const Z90 = 1.2815515655446004;

export function mean(xs: readonly number[]): number {
  if (xs.length === 0) return NaN;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

/** Plain median (linear interpolation on even counts). */
export function median(xs: readonly number[]): number {
  if (xs.length === 0) return NaN;
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Median absolute deviation, scaled by 1.4826 to be a consistent σ estimator under normality. */
export function mad(xs: readonly number[]): number {
  if (xs.length === 0) return NaN;
  const m = median(xs);
  const devs = xs.map((x) => Math.abs(x - m));
  return 1.4826 * median(devs);
}

/**
 * Reject points more than `k` MADs from the median (robust outlier filter, plan §7.4). Returns the
 * kept subset; if MAD is 0 (all equal) nothing is rejected.
 */
export function madFilter<T>(items: readonly T[], value: (t: T) => number, k = 3): T[] {
  if (items.length === 0) return [];
  const xs = items.map(value);
  const m = median(xs);
  const scale = mad(xs);
  if (scale === 0) return [...items];
  return items.filter((t) => Math.abs(value(t) - m) <= k * scale);
}

export interface Weighted {
  readonly value: number;
  readonly weight: number;
}

/** Weighted quantile via cumulative weights (q in [0,1]). Used for decay-weighted P10/P50/P90. */
export function weightedQuantile(points: readonly Weighted[], q: number): number {
  const pts = points.filter((p) => p.weight > 0).sort((a, b) => a.value - b.value);
  if (pts.length === 0) return NaN;
  const total = pts.reduce((s, p) => s + p.weight, 0);
  const target = q * total;
  let cum = 0;
  for (let i = 0; i < pts.length; i++) {
    cum += pts[i]!.weight;
    if (cum >= target) return pts[i]!.value;
  }
  return pts[pts.length - 1]!.value;
}

/** Exponential recency weight with a given half-life in days (plan §7.4: half-life 30d). */
export function decayWeight(ageDays: number, halfLifeDays: number): number {
  return Math.pow(0.5, Math.max(0, ageDays) / halfLifeDays);
}

// ---- normal / lognormal (for p_profit, plan §7.5) ----------------------------------------------

/** Abramowitz–Stegun 7.1.26 error function (|error| < 1.5e-7). */
export function erf(x: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-x * x);
  return x >= 0 ? y : -y;
}

export function normalCdf(z: number): number {
  return 0.5 * (1 + erf(z / Math.SQRT2));
}

export interface Lognormal {
  readonly mu: number;
  readonly sigma: number;
}

/** Fit a lognormal to (P10, P50, P90) resale quantiles. Median → μ; the P10/P90 spread → σ. */
export function lognormalFromQuantiles(p10: number, p50: number, p90: number): Lognormal {
  const mu = Math.log(p50);
  const sigma = Math.max(1e-9, (Math.log(p90) - Math.log(p10)) / (2 * Z90));
  return { mu, sigma };
}

/** P(X ≤ x) for a lognormal. Used to turn "break-even resale" into P(profit>0). */
export function lognormalCdf(x: number, { mu, sigma }: Lognormal): number {
  if (x <= 0) return 0;
  return normalCdf((Math.log(x) - mu) / sigma);
}

export function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}
