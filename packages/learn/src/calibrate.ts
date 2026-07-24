import type { Cents } from "@flip-desk/money";

/**
 * Calibration metrics (plan §7.7): how well predictions matched reality, so the learner can decide
 * whether a refit actually improves things. Valuation error is MAPE; probability calibration is the
 * Brier score. Percentages/scores are plain floats (not currency), so float math is fine here.
 */
export interface ValuationPair {
  readonly predictedCents: Cents;
  readonly realizedCents: Cents;
}

export function mape(pairs: readonly ValuationPair[]): number {
  if (pairs.length === 0) return 0;
  let sum = 0;
  for (const p of pairs) {
    const realized = Number(p.realizedCents);
    sum += Math.abs(Number(p.predictedCents) - realized) / Math.max(1, Math.abs(realized));
  }
  return sum / pairs.length;
}

export interface ProbPair {
  readonly predictedProb: number; // p_profit in [0,1]
  readonly outcome: 0 | 1; // did it actually clear a profit?
}

export function brier(pairs: readonly ProbPair[]): number {
  if (pairs.length === 0) return 0;
  let sum = 0;
  for (const p of pairs) sum += (p.predictedProb - p.outcome) ** 2;
  return sum / pairs.length;
}

export interface BucketCalibration {
  readonly bucket: string;
  readonly n: number;
  readonly mape: number;
}

/** Group valuation pairs by an arbitrary bucket key (e.g. confidence band or category) and score each. */
export function calibrationByBucket(
  rows: ReadonlyArray<ValuationPair & { bucket: string }>,
): BucketCalibration[] {
  const groups = new Map<string, ValuationPair[]>();
  for (const r of rows) {
    const g = groups.get(r.bucket) ?? [];
    g.push(r);
    groups.set(r.bucket, g);
  }
  return [...groups.entries()]
    .map(([bucket, pairs]) => ({ bucket, n: pairs.length, mape: mape(pairs) }))
    .sort((a, b) => a.bucket.localeCompare(b.bucket));
}
