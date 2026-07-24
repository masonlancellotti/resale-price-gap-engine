import { type Cents, sumCents } from "@flip-desk/money";
import { lognormalFromQuantiles, lognormalQuantile } from "@flip-desk/stats";
import { DEFAULT_CONFIG, type SimConfig } from "./config.js";
import type { CashFlow, SimResult } from "./types.js";

export interface CategoryStat {
  readonly slug: string;
  readonly label: string;
  readonly flips: number;
  readonly costCents: Cents;
  readonly revenueCents: Cents;
  readonly netCents: Cents;
  readonly roi: number;
}

export interface Calibration {
  readonly n: number;
  /** Empirical share of realized sales inside the predicted band; nominal target in the label. */
  readonly coverageP10P90: number;
  readonly coverageP25P75: number;
  readonly nominalP10P90: number; // 0.80
  readonly nominalP25P75: number; // 0.50
  readonly belowP10: number; // tail balance: share landing below P10
  readonly aboveP90: number; // and above P90
}

/** Predicted-vs-realized point for the calibration scatter (all cents). */
export interface CalibrationPoint {
  readonly category: string;
  readonly predP10Cents: Cents;
  readonly predP50Cents: Cents;
  readonly predP90Cents: Cents;
  readonly realizedCents: Cents;
  readonly inside: boolean;
}

export interface Tearsheet {
  readonly totalReturn: number;
  /** Money-weighted period return (Modified Dietz): the gain over the horizon divided by the
   *  time-weighted average capital deployed. Bounded and intuitive — the headline return figure. */
  readonly moneyWeightedReturn: number;
  /** True annualized IRR. Directional only: annualizing a ~90-day window inflates it heavily. */
  readonly irrAnnual: number;
  readonly hitRate: number;
  readonly flips: number;
  readonly medianHoldDays: number;
  readonly p90HoldDays: number;
  readonly maxDrawdown: number;
  readonly capitalUtilization: number;
  readonly feeBurden: number;
  readonly totalContributionsCents: Cents;
  readonly finalEquityCents: Cents;
  readonly netProfitCents: Cents;
  readonly totalRevenueCents: Cents;
  readonly totalFeesCents: Cents;
  readonly categories: readonly CategoryStat[];
  readonly calibration: Calibration;
  readonly calibrationPoints: readonly CalibrationPoint[];
}

function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return 0;
  const idx = q * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo]!;
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (idx - lo);
}

/**
 * Money-weighted IRR (annualized). Solves NPV(r) = Σ amount / (1+r)^(day/365) = 0 by bisection over
 * the annual rate. Cashflows are the investor contributions (negative) plus the terminal equity
 * (positive) — a genuine dated series, so the answer differs from a simple total return.
 */
export function xirr(cashflows: readonly CashFlow[]): number {
  const flows = cashflows.map((c) => ({ t: c.day / 365, amt: Number(c.amountCents) }));
  const hasNeg = flows.some((f) => f.amt < 0);
  const hasPos = flows.some((f) => f.amt > 0);
  if (!hasNeg || !hasPos) return 0;
  const npv = (rate: number): number => flows.reduce((s, f) => s + f.amt / Math.pow(1 + rate, f.t), 0);
  let lo = -0.9999;
  // Upper bracket large enough to contain the (possibly very high) annualized rate a short,
  // capital-efficient window can produce; the caller labels annualized IRR as directional.
  let hi = 1e6;
  let fLo = npv(lo);
  if (!Number.isFinite(fLo)) fLo = npv((lo = -0.99));
  const fHi = npv(hi);
  if (fLo * fHi > 0) return 0; // no sign change in range
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    const fMid = npv(mid);
    if (Math.abs(fMid) < 1e-6) return mid;
    if (fLo * fMid < 0) hi = mid;
    else {
      lo = mid;
      fLo = fMid;
    }
  }
  return (lo + hi) / 2;
}

/**
 * Money-weighted period return (Modified Dietz): gain ÷ time-weighted average capital. Each
 * contribution is weighted by the fraction of the horizon it was actually invested, so a dollar
 * added late counts less than a dollar present from day one. Bounded, not annualized.
 */
export function modifiedDietz(contributions: readonly CashFlow[], finalEquityCents: Cents, days: number): number {
  const T = Math.max(1, days);
  let weightedCapital = 0;
  let totalContributed = 0;
  for (const c of contributions) {
    const amt = -Number(c.amountCents); // contributions are stored negative (investor outflow)
    weightedCapital += ((T - c.day) / T) * amt;
    totalContributed += amt;
  }
  const gain = Number(finalEquityCents) - totalContributed;
  return weightedCapital > 0 ? gain / weightedCapital : 0;
}

/** Compute the full tearsheet from a simulation result. */
export function computeTearsheet(result: SimResult, config: SimConfig = DEFAULT_CONFIG): Tearsheet {
  const labelOf = new Map(config.categories.map((c) => [c.slug, c.label]));
  const flips = result.flips;

  // Money-weighted return (period) + true annualized IRR (directional).
  const lastDay = result.days - 1;
  const cashflows: CashFlow[] = [...result.contributions, { day: lastDay, amountCents: result.finalEquityCents }];
  const irrAnnual = xirr(cashflows);
  const moneyWeightedReturn = modifiedDietz(result.contributions, result.finalEquityCents, result.days);

  const totalContributionsCents = sumCents(result.contributions.map((c) => -c.amountCents));
  const totalReturn =
    totalContributionsCents > 0n
      ? Number(result.finalEquityCents - totalContributionsCents) / Number(totalContributionsCents)
      : 0;

  const wins = flips.filter((f) => f.netCents > 0n).length;
  const hitRate = flips.length > 0 ? wins / flips.length : 0;

  const holds = flips.map((f) => f.holdDays).sort((a, b) => a - b);
  const medianHoldDays = quantile(holds, 0.5);
  const p90HoldDays = quantile(holds, 0.9);

  // Max drawdown on the equity curve.
  let peak = 0;
  let maxDrawdown = 0;
  for (const d of result.daily) {
    const e = Number(d.equityCents);
    if (e > peak) peak = e;
    if (peak > 0) maxDrawdown = Math.max(maxDrawdown, (peak - e) / peak);
  }

  // Capital utilization: average fraction of equity deployed in inventory.
  const utilDays = result.daily.filter((d) => d.equityCents > 0n);
  const capitalUtilization =
    utilDays.length > 0
      ? utilDays.reduce((s, d) => s + Number(d.inventoryValueCents) / Number(d.equityCents), 0) / utilDays.length
      : 0;

  const totalRevenueCents = sumCents(flips.map((f) => f.saleCents));
  const totalFeesCents = sumCents(flips.map((f) => f.feesCents));
  const netProfitCents = sumCents(flips.map((f) => f.netCents));
  const feeBurden = totalRevenueCents > 0n ? Number(totalFeesCents) / Number(totalRevenueCents) : 0;

  // Per-category rollup.
  const byCat = new Map<string, { flips: number; cost: Cents; rev: Cents; net: Cents }>();
  for (const f of flips) {
    const cur = byCat.get(f.category) ?? { flips: 0, cost: 0n, rev: 0n, net: 0n };
    cur.flips += 1;
    cur.cost += f.costBasisCents;
    cur.rev += f.saleCents;
    cur.net += f.netCents;
    byCat.set(f.category, cur);
  }
  const categories: CategoryStat[] = [...byCat.entries()]
    .map(([slug, v]) => ({
      slug,
      label: labelOf.get(slug) ?? slug,
      flips: v.flips,
      costCents: v.cost,
      revenueCents: v.rev,
      netCents: v.net,
      roi: v.cost > 0n ? Number(v.net) / Number(v.cost) : 0,
    }))
    .sort((a, b) => b.netCents - a.netCents > 0n ? 1 : b.netCents - a.netCents < 0n ? -1 : 0);

  // Band calibration: realized vs predicted P10–P90 and (lognormal-implied) P25–P75.
  const points: CalibrationPoint[] = [];
  let insideP10P90 = 0;
  let insideP25P75 = 0;
  let belowP10 = 0;
  let aboveP90 = 0;
  for (const f of flips) {
    const p10 = Number(f.predP10Cents);
    const p50 = Number(f.predP50Cents);
    const p90 = Number(f.predP90Cents);
    const realized = Number(f.saleCents);
    const inside = realized >= p10 && realized <= p90;
    if (inside) insideP10P90 += 1;
    if (realized < p10) belowP10 += 1;
    if (realized > p90) aboveP90 += 1;
    if (p10 > 0 && p50 > 0 && p90 > 0 && p90 > p10) {
      const ln = lognormalFromQuantiles(p10, p50, p90);
      const p25 = lognormalQuantile(0.25, ln);
      const p75 = lognormalQuantile(0.75, ln);
      if (realized >= p25 && realized <= p75) insideP25P75 += 1;
    }
    points.push({
      category: f.category,
      predP10Cents: f.predP10Cents,
      predP50Cents: f.predP50Cents,
      predP90Cents: f.predP90Cents,
      realizedCents: f.saleCents,
      inside,
    });
  }
  const n = flips.length;
  const calibration: Calibration = {
    n,
    coverageP10P90: n > 0 ? insideP10P90 / n : 0,
    coverageP25P75: n > 0 ? insideP25P75 / n : 0,
    nominalP10P90: 0.8,
    nominalP25P75: 0.5,
    belowP10: n > 0 ? belowP10 / n : 0,
    aboveP90: n > 0 ? aboveP90 / n : 0,
  };

  return {
    totalReturn,
    moneyWeightedReturn,
    irrAnnual,
    hitRate,
    flips: flips.length,
    medianHoldDays,
    p90HoldDays,
    maxDrawdown,
    capitalUtilization,
    feeBurden,
    totalContributionsCents,
    finalEquityCents: result.finalEquityCents,
    netProfitCents,
    totalRevenueCents,
    totalFeesCents,
    categories,
    calibration,
    calibrationPoints: points,
  };
}
