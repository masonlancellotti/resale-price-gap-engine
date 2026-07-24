/**
 * Score-weight refit (plan §7.7, §7.6): regress realized outcome (e.g. $/hr) on the ranker's score
 * components and re-weight toward the ones that actually predicted profit. We use a robust,
 * dependency-free reweight — each component's positive correlation with the outcome, normalized and
 * shrunk toward the current priors so a thin window can't overreact. All ranker weights stay ≥ 0 and
 * sum to 1.
 */
export interface WeightRow {
  readonly components: Readonly<Record<string, number>>;
  readonly realized: number; // realized $/hr (or net) for the deal
}

function pearson(xs: readonly number[], ys: readonly number[]): number {
  const n = xs.length;
  if (n < 2) return 0;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let cov = 0;
  let vx = 0;
  let vy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i]! - mx;
    const dy = ys[i]! - my;
    cov += dx * dy;
    vx += dx * dx;
    vy += dy * dy;
  }
  if (vx === 0 || vy === 0) return 0;
  return cov / Math.sqrt(vx * vy);
}

function normalize(w: Record<string, number>): Record<string, number> {
  const total = Object.values(w).reduce((a, b) => a + b, 0);
  if (total <= 0) return w;
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(w)) out[k] = v / total;
  return out;
}

export function refitWeights(
  rows: readonly WeightRow[],
  priors: Readonly<Record<string, number>>,
  priorStrength = 10,
): Record<string, number> {
  const keys = Object.keys(priors);
  const realized = rows.map((r) => r.realized);

  const dataWeights: Record<string, number> = {};
  for (const key of keys) {
    const xs = rows.map((r) => r.components[key] ?? 0);
    dataWeights[key] = Math.max(0, pearson(xs, realized));
  }
  const dataNorm = normalize(dataWeights);

  // Blend data with priors by pseudo-count, then renormalize.
  const n = rows.length;
  const blended: Record<string, number> = {};
  for (const key of keys) {
    blended[key] = (n * (dataNorm[key] ?? 0) + priorStrength * (priors[key] ?? 0)) / (n + priorStrength);
  }
  return normalize(blended);
}
