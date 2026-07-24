import type { Cents } from "@flip-desk/money";

/** One simulated marketplace listing, with its hidden ground truth (realized price, time to sale). */
export interface SimListing {
  readonly g: number; // globally unique index → product model tag `M{g}`
  readonly day: number; // day it appears
  readonly category: string;
  readonly title: string;
  readonly trueValueCents: number;
  readonly askCents: number;
  /** Hidden truth: the price the item would clear at (good condition), drawn from the same
   *  distribution the comps are — so appraisal P10/P90 coverage is honest. */
  readonly realizedSaleCents: number;
  /** Hidden truth: days on hand before it sells, once listed. */
  readonly holdDays: number;
}

/** A completed flip: bought, held, sold — with the appraisal band captured at buy time. */
export interface FlipRecord {
  readonly g: number;
  readonly sku: string;
  readonly category: string;
  readonly title: string;
  readonly buyDay: number;
  readonly sellDay: number;
  readonly holdDays: number;
  readonly costBasisCents: Cents;
  readonly saleCents: Cents;
  readonly feesCents: Cents;
  readonly netCents: Cents;
  readonly roi: number;
  // appraisal band captured when the buy was underwritten (for calibration)
  readonly predP10Cents: Cents;
  readonly predP50Cents: Cents;
  readonly predP90Cents: Cents;
}

/** Daily mark-to-market snapshot. */
export interface DailyPoint {
  readonly day: number;
  readonly dateIso: string;
  readonly cashCents: Cents;
  readonly inventoryValueCents: Cents;
  readonly equityCents: Cents;
  readonly openPositions: number;
  readonly cumulativeFlips: number;
  readonly ledgerBalanced: boolean;
}

/** An external investor cash flow (contributions are negative from the investor's perspective). */
export interface CashFlow {
  readonly day: number;
  readonly amountCents: Cents; // signed: contributions negative, terminal value positive
}

export interface SimResult {
  readonly seed: number;
  readonly days: number;
  readonly startDateIso: string;
  readonly categories: readonly string[];
  readonly daily: readonly DailyPoint[];
  readonly flips: readonly FlipRecord[];
  readonly contributions: readonly CashFlow[];
  readonly finalEquityCents: Cents;
  readonly listingsSeen: number;
  readonly listingsTaken: number;
}
