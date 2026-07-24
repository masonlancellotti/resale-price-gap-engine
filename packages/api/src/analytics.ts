import { computeTearsheet, DEFAULT_CONFIG, runSim } from "@flip-desk/sim";
import { type Money, money } from "./dto.js";

/**
 * Analytics DTOs for the terminal's Analytics pages (V2 WS3). Computed once, at seed time, by running
 * the REAL simulation (packages/sim) and its tearsheet — not hardcoded. Every number here traces to
 * committed code + a committed seed. The whole payload is JSON-safe: money crosses as {@link Money}
 * (cents string + display), chart series as plain integer-cent numbers (small, exact).
 */
export const ANALYTICS_SEED = 42;
export const ANALYTICS_DAYS = 90;

export interface EquityPoint {
  readonly day: number;
  readonly date: string; // YYYY-MM-DD
  readonly cashCents: number;
  readonly inventoryCents: number;
  readonly equityCents: number;
}

export interface CalibrationPointDTO {
  readonly category: string;
  readonly p10Cents: number;
  readonly p50Cents: number;
  readonly p90Cents: number;
  readonly realizedCents: number;
  readonly inside: boolean;
}

export interface CategoryStatDTO {
  readonly slug: string;
  readonly label: string;
  readonly flips: number;
  readonly cost: Money;
  readonly revenue: Money;
  readonly net: Money;
  readonly roi: number;
}

export interface AnalyticsDTO {
  readonly meta: {
    readonly seed: number;
    readonly days: number;
    readonly startDate: string;
    readonly listingsSeen: number;
    readonly listingsTaken: number;
    readonly flips: number;
  };
  readonly kpis: {
    readonly moneyWeightedReturn: number;
    readonly totalReturn: number;
    readonly irrAnnual: number;
    readonly hitRate: number;
    readonly maxDrawdown: number;
    readonly capitalDeployed: number;
    readonly feeBurden: number;
    readonly medianHoldDays: number;
    readonly p90HoldDays: number;
    readonly netProfit: Money;
    readonly finalEquity: Money;
    readonly totalContributions: Money;
  };
  readonly equity: readonly EquityPoint[];
  readonly calibration: {
    readonly n: number;
    readonly coverageP10P90: number;
    readonly coverageP25P75: number;
    readonly nominalP10P90: number;
    readonly nominalP25P75: number;
    readonly belowP10: number;
    readonly aboveP90: number;
    readonly points: readonly CalibrationPointDTO[];
  };
  readonly categories: readonly CategoryStatDTO[];
}

/**
 * Run the canned demo simulation and project it into the Analytics DTO. Deterministic: fixed seed and
 * horizon → identical payload every process start. Async because the engine loop is async.
 */
export async function computeDemoAnalytics(): Promise<AnalyticsDTO> {
  const result = await runSim({ days: ANALYTICS_DAYS, seed: ANALYTICS_SEED });
  const t = computeTearsheet(result, DEFAULT_CONFIG);

  return {
    meta: {
      seed: result.seed,
      days: result.days,
      startDate: result.startDateIso.slice(0, 10),
      listingsSeen: result.listingsSeen,
      listingsTaken: result.listingsTaken,
      flips: t.flips,
    },
    kpis: {
      moneyWeightedReturn: t.moneyWeightedReturn,
      totalReturn: t.totalReturn,
      irrAnnual: t.irrAnnual,
      hitRate: t.hitRate,
      maxDrawdown: t.maxDrawdown,
      capitalDeployed: t.capitalUtilization,
      feeBurden: t.feeBurden,
      medianHoldDays: t.medianHoldDays,
      p90HoldDays: t.p90HoldDays,
      netProfit: money(t.netProfitCents),
      finalEquity: money(t.finalEquityCents),
      totalContributions: money(t.totalContributionsCents),
    },
    equity: result.daily.map((d) => ({
      day: d.day,
      date: d.dateIso.slice(0, 10),
      cashCents: Number(d.cashCents),
      inventoryCents: Number(d.inventoryValueCents),
      equityCents: Number(d.equityCents),
    })),
    calibration: {
      n: t.calibration.n,
      coverageP10P90: t.calibration.coverageP10P90,
      coverageP25P75: t.calibration.coverageP25P75,
      nominalP10P90: t.calibration.nominalP10P90,
      nominalP25P75: t.calibration.nominalP25P75,
      belowP10: t.calibration.belowP10,
      aboveP90: t.calibration.aboveP90,
      points: t.calibrationPoints.map((p) => ({
        category: p.category,
        p10Cents: Number(p.predP10Cents),
        p50Cents: Number(p.predP50Cents),
        p90Cents: Number(p.predP90Cents),
        realizedCents: Number(p.realizedCents),
        inside: p.inside,
      })),
    },
    categories: t.categories.map((c) => ({
      slug: c.slug,
      label: c.label,
      flips: c.flips,
      cost: money(c.costCents),
      revenue: money(c.revenueCents),
      net: money(c.netCents),
      roi: c.roi,
    })),
  };
}
