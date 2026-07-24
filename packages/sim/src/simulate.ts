import { Bookkeeper } from "@flip-desk/bookkeeper";
import type { OpportunityResult } from "@flip-desk/engine";
import { type Cents, mulBp } from "@flip-desk/money";
import { DEFAULT_CONFIG, type SimConfig } from "./config.js";
import { EngineHarness } from "./harness.js";
import { generateMarket } from "./market.js";
import type { CashFlow, DailyPoint, FlipRecord, SimResult } from "./types.js";

const DAY_MS = 86_400_000;

export interface SimOptions {
  readonly days: number;
  readonly seed: number;
  readonly config?: SimConfig;
}

interface OpenPosition {
  readonly sku: string;
  readonly g: number;
  readonly category: string;
  readonly title: string;
  readonly buyDay: number;
  readonly sellDay: number;
  readonly costBasisCents: Cents;
  readonly realizedSaleCents: number;
  readonly holdDays: number;
  readonly predP10Cents: Cents;
  readonly predP50Cents: Cents;
  readonly predP90Cents: Cents;
}

/**
 * Run the deterministic marketplace simulation. It drives the REAL engine (ingest → identify →
 * appraise → underwrite → rank) day by day and books every buy and sale into the REAL double-entry
 * ledger via the {@link Bookkeeper}. Acquisition is L2 auto-approve-in-sim: any floors-passing,
 * non-hard-blocked take is bought, in score order, under a per-day deployment cap. Same seed →
 * identical result.
 */
export async function runSim(opts: SimOptions): Promise<SimResult> {
  const config = opts.config ?? DEFAULT_CONFIG;
  const { days, seed } = opts;
  const startMs = Date.parse(config.startDateIso);
  const startYear = new Date(startMs).getUTCFullYear();

  const market = generateMarket(config, seed, days);
  const harness = new EngineHarness(market, startMs);
  const book = new Bookkeeper();

  const contributions: CashFlow[] = [];
  let cumulativeCapital = 0;
  const inject = (day: number, amountCents: number): void => {
    book.injectCapital(BigInt(amountCents), new Date(startMs + day * DAY_MS).toISOString());
    cumulativeCapital += amountCents;
    contributions.push({ day, amountCents: BigInt(-amountCents) }); // negative = investor outflow
  };

  const open: OpenPosition[] = [];
  const flips: FlipRecord[] = [];
  const daily: DailyPoint[] = [];
  let skuSeq = 0;
  let listingsSeen = 0;
  let listingsTaken = 0;

  const cash = (): Cents => book.ledger.balanceOf("cash");
  const inventoryValue = (): Cents => book.ledger.balanceOf("inventory");

  for (let day = 0; day < days; day++) {
    harness.setDay(startMs, day);
    const ts = new Date(startMs + day * DAY_MS).toISOString();

    // 0) Scheduled investor contributions land at the start of the day.
    for (const c of config.contributionSchedule) {
      if (c.day === day && cumulativeCapital + c.amountCents <= config.maxCapitalCents) inject(day, c.amountCents);
    }

    // 1) Settle sales due today (frees capital before the day's buys).
    for (let i = open.length - 1; i >= 0; i--) {
      const pos = open[i]!;
      if (pos.sellDay !== day) continue;
      const gross = BigInt(pos.realizedSaleCents);
      const fees = mulBp(gross, config.feePctBp) + BigInt(config.feeFixedCents);
      book.recordSale({
        sku: pos.sku,
        grossCents: gross,
        feesCents: fees,
        shipLabelCents: BigInt(config.outboundShipCents),
        ts,
      });
      const net = gross - fees - BigInt(config.outboundShipCents) - pos.costBasisCents;
      flips.push({
        g: pos.g,
        sku: pos.sku,
        category: pos.category,
        title: pos.title,
        buyDay: pos.buyDay,
        sellDay: day,
        holdDays: pos.holdDays,
        costBasisCents: pos.costBasisCents,
        saleCents: gross,
        feesCents: fees,
        netCents: net,
        roi: Number(net) / Number(pos.costBasisCents),
        predP10Cents: pos.predP10Cents,
        predP50Cents: pos.predP50Cents,
        predP90Cents: pos.predP90Cents,
      });
      open.splice(i, 1);
    }

    // 2) Underwrite the day's listings through the REAL engine.
    const raws = market.rawsByDay[day] ?? [];
    const listings = market.listingsByDay[day] ?? [];
    const takes: Array<{ result: OpportunityResult; askCents: number; realized: number; holdDays: number; category: string; title: string; g: number }> = [];
    for (let k = 0; k < raws.length; k++) {
      listingsSeen += 1;
      const result = await harness.engine.underwriteRaw(raws[k]!);
      if (result.taken && result.valuationP50Cents !== undefined) {
        const l = listings[k]!;
        takes.push({ result, askCents: l.askCents, realized: l.realizedSaleCents, holdDays: l.holdDays, category: l.category, title: l.title, g: l.g });
      }
    }

    // 3) Acquire in score order under the per-day deployment cap (L2 auto-approve-in-sim).
    takes.sort((a, b) => (b.result.score ?? 0) - (a.result.score ?? 0));
    let spentToday = 0;
    for (const t of takes) {
      const cost = t.askCents;
      if (spentToday + cost > config.perDayBuyCapCents) continue;
      // Top up investor capital if cash is short (bounded) — these dated flows make IRR money-weighted.
      const shortfall = cost - Number(cash());
      if (shortfall > 0) {
        const topup = Math.ceil(shortfall / 10_000) * 10_000;
        if (cumulativeCapital + topup > config.maxCapitalCents) continue;
        inject(day, topup);
      }
      const sku = `FD-${startYear}-${String(++skuSeq).padStart(5, "0")}`;
      book.recordPurchase({ sku, pricePaidCents: BigInt(cost), ts });
      const r = t.result;
      const p50 = r.valuationP50Cents!;
      open.push({
        sku,
        g: t.g,
        category: t.category,
        title: t.title,
        buyDay: day,
        sellDay: day + t.holdDays,
        costBasisCents: BigInt(cost),
        realizedSaleCents: t.realized,
        holdDays: t.holdDays,
        predP10Cents: r.valuationP10Cents ?? p50,
        predP50Cents: p50,
        predP90Cents: r.valuationP90Cents ?? p50,
      });
      spentToday += cost;
      listingsTaken += 1;
    }

    // 4) Mark to market.
    const c = cash();
    const inv = inventoryValue();
    daily.push({
      day,
      dateIso: ts,
      cashCents: c,
      inventoryValueCents: inv,
      equityCents: c + inv,
      openPositions: open.length,
      cumulativeFlips: flips.length,
      ledgerBalanced: book.ledger.isBalanced(),
    });
  }

  const finalEquityCents = daily.length > 0 ? daily[daily.length - 1]!.equityCents : 0n;
  return {
    seed,
    days,
    startDateIso: config.startDateIso,
    categories: config.categories.map((c) => c.slug),
    daily,
    flips,
    contributions,
    finalEquityCents,
    listingsSeen,
    listingsTaken,
  };
}
