/**
 * Seeded category models for the marketplace simulation (V2 WS2).
 *
 * ⚠ SYNTHETIC. Every number here is a hand-chosen, plausible parameter — not measured market data.
 * The simulation exists to exercise the REAL engine (identify → appraise → underwrite → rank) and the
 * REAL double-entry ledger against a controllable, reproducible listing stream, and to measure the
 * result like a fund. It validates the *machinery and the math*, not a live trading edge. Full
 * methodology, and what this does / does not validate, lives in docs/SIMULATION.md.
 */

export interface CategoryModel {
  readonly slug: string;
  readonly label: string;
  /** Share of daily listing arrivals drawn from this category (weights sum to 1). */
  readonly weight: number;
  /** Median good-condition market value of a product in this category (cents). */
  readonly medianValueCents: number;
  /** Lognormal spread of true value ACROSS products in the category. */
  readonly sigmaValue: number;
  /** Lognormal noise of sold comps AND realized sale prices around a product's true value.
   *  Comps and realized draws share this σ, so calibration is honest by construction. */
  readonly sigmaComp: number;
  /** P(a new listing is underpriced enough to be worth underwriting) — the rest are fair/high. */
  readonly dealRate: number;
  /** Within deals, P(a deep steal) vs a modest deal. */
  readonly stealRate: number;
  /** P(a listed item sells on any given day) → geometric time-to-sale. */
  readonly dailySaleHazard: number;
  /** P(a bad outcome on sale: return, DOA, or misgrade) — realized price takes a haircut. */
  readonly badOutcomeRate: number;
}

export interface CapitalContribution {
  readonly day: number;
  readonly amountCents: number;
}

export interface SimConfig {
  /** Virtual "day 0" — the clock the engine appraises against advances one day per sim step. */
  readonly startDateIso: string;
  readonly listingsPerDay: number;
  /** Investor capital phased in on a schedule (dollar-cost-averaged), so IRR is genuinely
   *  money-weighted — later dollars have had less time to compound. */
  readonly contributionSchedule: readonly CapitalContribution[];
  /** Cap on cumulative investor contributions (top-ups stop here — beyond it, deals are skipped). */
  readonly maxCapitalCents: number;
  /** Discipline: max cash deployed into buys on any single day. */
  readonly perDayBuyCapCents: number;
  /** Marketplace take rate applied to realized sales (basis points) + fixed cents. */
  readonly feePctBp: number;
  readonly feeFixedCents: number;
  readonly outboundShipCents: number;
  readonly categories: readonly CategoryModel[];
}

/**
 * The default synthetic marketplace: six resale categories with distinct value scales, dispersion,
 * deal incidence, and liquidity. Chosen to be plausible and varied, never to flatter the engine.
 */
export const DEFAULT_CONFIG: SimConfig = {
  startDateIso: "2026-01-05T12:00:00.000Z",
  listingsPerDay: 18,
  // $800 seed, then $600 added at day 30 and day 60 — a realistic "add capital as it proves out"
  // ramp that also makes the money-weighted IRR distinct from the simple total return.
  contributionSchedule: [
    { day: 0, amountCents: 80_000 },
    { day: 30, amountCents: 60_000 },
    { day: 60, amountCents: 60_000 },
  ],
  maxCapitalCents: 1_200_000, // top-ups capped at $12,000 cumulative
  perDayBuyCapCents: 90_000, // $900/day deployment ceiling
  feePctBp: 1310, // ~13.1% marketplace take
  feeFixedCents: 30,
  outboundShipCents: 650,
  categories: [
    { slug: "retro_games", label: "Retro games", weight: 0.22, medianValueCents: 12_000, sigmaValue: 0.6, sigmaComp: 0.17, dealRate: 0.4, stealRate: 0.3, dailySaleHazard: 0.06, badOutcomeRate: 0.09 },
    { slug: "lego_sets", label: "LEGO sets", weight: 0.18, medianValueCents: 18_000, sigmaValue: 0.5, sigmaComp: 0.14, dealRate: 0.34, stealRate: 0.25, dailySaleHazard: 0.05, badOutcomeRate: 0.06 },
    { slug: "vinyl_records", label: "Vinyl records", weight: 0.16, medianValueCents: 4_500, sigmaValue: 0.7, sigmaComp: 0.22, dealRate: 0.46, stealRate: 0.35, dailySaleHazard: 0.045, badOutcomeRate: 0.12 },
    { slug: "music_gear", label: "Music gear", weight: 0.16, medianValueCents: 26_000, sigmaValue: 0.55, sigmaComp: 0.15, dealRate: 0.3, stealRate: 0.2, dailySaleHazard: 0.035, badOutcomeRate: 0.14 },
    { slug: "vintage_cameras", label: "Vintage cameras", weight: 0.14, medianValueCents: 15_000, sigmaValue: 0.65, sigmaComp: 0.2, dealRate: 0.38, stealRate: 0.3, dailySaleHazard: 0.04, badOutcomeRate: 0.13 },
    { slug: "calculators", label: "Graphing calculators", weight: 0.14, medianValueCents: 7_000, sigmaValue: 0.4, sigmaComp: 0.12, dealRate: 0.44, stealRate: 0.28, dailySaleHazard: 0.07, badOutcomeRate: 0.05 },
  ],
};
