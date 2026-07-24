import type { Cents } from "./cents.js";

/**
 * Exact integer-cent arithmetic for percentages and rates. Fees, ad rates, APR carry, and labor
 * are all "fraction of a base" computations; doing them in floating point would drift by fractions
 * of a cent and break the ledger's exactness (plan §2.3 P4). We keep everything in bigint and round
 * once, half-away-from-zero, at the end.
 */

/** Round `numer / denom` to the nearest integer, half away from zero. `denom` must be > 0. */
export function roundDivToNearest(numer: bigint, denom: bigint): bigint {
  if (denom <= 0n) throw new RangeError(`denominator must be > 0, got ${denom}`);
  const negative = numer < 0n;
  const abs = negative ? -numer : numer;
  const quotient = (abs + denom / 2n) / denom;
  return negative ? -quotient : quotient;
}

/** `base × (bp / 10000)`, rounded to the nearest cent. 1360 bp = 13.6%. */
export function mulBp(base: Cents, bp: number): Cents {
  if (!Number.isInteger(bp)) throw new RangeError(`basis points must be an integer, got ${bp}`);
  return roundDivToNearest(base * BigInt(bp), 10_000n);
}

/** Percent (as a decimal string or integer-ish) → basis points. "13.6" → 1360, "3" → 300. */
export function pctToBp(pct: string | number): number {
  const s = typeof pct === "number" ? pct.toString() : pct.trim();
  const m = /^(-)?(\d+)(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) throw new RangeError(`pctToBp: not a ≤2-decimal percentage: ${JSON.stringify(pct)}`);
  const sign = m[1] ? -1 : 1;
  const whole = Number(m[2]);
  const frac = Number((m[3] ?? "").padEnd(2, "0"));
  return sign * (whole * 100 + frac);
}

/**
 * Prorated carrying cost: `principal × aprBp/10000 × days / 365`, rounded to the nearest cent.
 * (plan §7.5 capital carry line.)
 */
export function carryCost(principal: Cents, aprBp: number, days: number): Cents {
  if (!Number.isInteger(aprBp)) throw new RangeError(`aprBp must be an integer, got ${aprBp}`);
  const dayNum = BigInt(Math.round(days * 1000)); // keep 3 decimals of days precision
  return roundDivToNearest(principal * BigInt(aprBp) * dayNum, 10_000n * 365n * 1000n);
}

/** Labor cost: `minutes × ratePerHourCents / 60`, rounded to the nearest cent. */
export function laborCost(minutes: number, ratePerHourCents: Cents): Cents {
  const minNum = BigInt(Math.round(minutes * 1000));
  return roundDivToNearest(ratePerHourCents * minNum, 60n * 1000n);
}
