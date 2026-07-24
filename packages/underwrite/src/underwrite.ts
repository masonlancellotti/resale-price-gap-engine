import {
  carryCost,
  type Cents,
  laborCost,
  mulBp,
  roundDivToNearest,
} from "@flip-desk/money";
import { lognormalCdf, lognormalFromQuantiles } from "@flip-desk/stats";
import type { PlatformFee } from "./fees.js";

/** Deal floors (plan §7.5): a deal must clear ALL three. Per-category overridable. */
export interface UnderwriteFloors {
  readonly netP50Cents: Cents;
  readonly roi: number;
  readonly dollarPerLaborHourCents: Cents;
}

export const DEFAULT_FLOORS: UnderwriteFloors = {
  netP50Cents: 2500n, // $25
  roi: 0.3,
  dollarPerLaborHourCents: 3000n, // $30/hr
};

export interface UnderwriteInput {
  readonly channel: string;
  readonly resaleP50Cents: Cents;
  readonly resaleP10Cents?: Cents;
  readonly resaleP90Cents?: Cents;
  readonly fee: PlatformFee;
  readonly promotedRateBp?: number;
  readonly outboundShipCents: Cents;
  readonly packagingCents?: Cents;
  readonly returns?: { readonly pReturnBp: number; readonly expectedLossCents: Cents };
  readonly fraudReserveCents?: Cents;
  readonly doaRiskCents?: Cents;
  readonly purchaseCents: Cents;
  readonly acquisitionTaxCents?: Cents;
  readonly inboundShipCents?: Cents;
  readonly travelMiles?: number;
  readonly irsCentsPerMile?: number;
  readonly aprBp?: number;
  readonly expTtsDays: number;
  readonly laborMinutes: number;
  readonly laborRatePerHourCents?: Cents;
  readonly floors?: UnderwriteFloors;
}

export type WaterfallKind = "resale" | "sell_cost" | "buy_cost" | "carry" | "labor" | "subtotal" | "total";

export interface WaterfallLine {
  readonly label: string;
  readonly amountCents: Cents; // signed: resale/subtotals positive, costs negative
  readonly kind: WaterfallKind;
}

export interface UnderwriteResult {
  readonly netResaleProceedsCents: Cents;
  readonly cashAtRiskCents: Cents;
  readonly netP50Cents: Cents; // accounting-true (labor charged)
  readonly cashNetCents: Cents; // labor not charged to self
  readonly netP10Cents: Cents; // margin of safety (resale at P10)
  readonly roi: number;
  readonly cashRoi: number;
  readonly dollarPerLaborHourCents: Cents;
  readonly dollarPerCapitalDayCents: Cents;
  readonly breakEvenResaleCents: Cents;
  readonly pProfit: number | undefined;
  readonly floors: { netP50: boolean; roi: boolean; laborHr: boolean; pass: boolean };
  readonly waterfall: readonly WaterfallLine[];
}

const zero = 0n;

/**
 * The net-profit waterfall (plan §7.5). Every line is integer cents; percentage lines round once,
 * half away from zero. Reproduces the §13.2 worked example to the cent (see the golden test).
 */
export function underwrite(input: UnderwriteInput): UnderwriteResult {
  const promoBp = input.promotedRateBp ?? 0;
  const packaging = input.packagingCents ?? zero;
  const fraud = input.fraudReserveCents ?? zero;
  const doa = input.doaRiskCents ?? zero;
  const acquisitionTax = input.acquisitionTaxCents ?? zero;
  const inbound = input.inboundShipCents ?? zero;
  const aprBp = input.aprBp ?? 800;
  const laborRate = input.laborRatePerHourCents ?? 2500n;
  const irsPerMile = input.irsCentsPerMile ?? 70;
  const floors = input.floors ?? DEFAULT_FLOORS;

  const travel = input.travelMiles ? BigInt(Math.round(input.travelMiles * irsPerMile)) : zero;
  const returnsReserve = input.returns
    ? mulBp(input.returns.expectedLossCents, input.returns.pReturnBp)
    : zero;

  // Selling-cost components. Percentage lines depend on the resale price point; fixed ones don't.
  const platformPct = (resale: Cents): Cents => mulBp(resale, input.fee.pctBp) + input.fee.fixedCents;
  const paymentFee = (resale: Cents): Cents =>
    input.fee.paymentPctBp !== undefined
      ? mulBp(resale, input.fee.paymentPctBp) + (input.fee.paymentFixedCents ?? zero)
      : zero;
  const promo = (resale: Cents): Cents => mulBp(resale, promoBp);
  const fixedSellCosts = input.outboundShipCents + packaging + returnsReserve + fraud + doa;

  const netResaleProceedsAt = (resale: Cents): Cents =>
    resale - platformPct(resale) - paymentFee(resale) - promo(resale) - fixedSellCosts;

  const cashAtRisk = input.purchaseCents + acquisitionTax + inbound + travel;
  const capitalCarry = carryCost(cashAtRisk, aprBp, input.expTtsDays);
  const labor = laborCost(input.laborMinutes, laborRate);

  // buy-side + carry costs sit below "net resale proceeds"; labor is charged only to accounting-net.
  const belowLineExLabor = input.purchaseCents + acquisitionTax + inbound + travel + capitalCarry;

  const netResaleProceeds = netResaleProceedsAt(input.resaleP50Cents);
  const netP50 = netResaleProceeds - belowLineExLabor - labor;
  const cashNet = netP50 + labor;
  const netP10 =
    input.resaleP10Cents !== undefined
      ? netResaleProceedsAt(input.resaleP10Cents) - belowLineExLabor - labor
      : netP50;

  const cashAtRiskNum = Number(cashAtRisk);
  const roi = cashAtRiskNum > 0 ? Number(netP50) / cashAtRiskNum : 0;
  const cashRoi = cashAtRiskNum > 0 ? Number(cashNet) / cashAtRiskNum : 0;

  const dollarPerLaborHour =
    input.laborMinutes > 0
      ? roundDivToNearest(cashNet * 60_000n, BigInt(Math.round(input.laborMinutes * 1000)))
      : cashNet;
  const dollarPerCapitalDay =
    input.expTtsDays > 0
      ? roundDivToNearest(netP50 * 1000n, BigInt(Math.round(input.expTtsDays * 1000)))
      : netP50;

  // Break-even resale (net = 0), then P(net>0) from the resale distribution (plan §7.5).
  const effRateBp = input.fee.pctBp + (input.fee.paymentPctBp ?? 0) + promoBp;
  const slope = 1 - effRateBp / 10_000;
  const fixedFees = Number(input.fee.fixedCents + (input.fee.paymentFixedCents ?? zero));
  const K = fixedFees + Number(fixedSellCosts) + Number(belowLineExLabor) + Number(labor);
  const breakEvenResale = slope > 0 ? K / slope : Number.POSITIVE_INFINITY;
  const breakEvenResaleCents = Number.isFinite(breakEvenResale)
    ? BigInt(Math.max(0, Math.round(breakEvenResale)))
    : BigInt(Number.MAX_SAFE_INTEGER);

  let pProfit: number | undefined;
  if (input.resaleP10Cents !== undefined && input.resaleP90Cents !== undefined) {
    const ln = lognormalFromQuantiles(
      Number(input.resaleP10Cents),
      Number(input.resaleP50Cents),
      Number(input.resaleP90Cents),
    );
    pProfit = 1 - lognormalCdf(breakEvenResale, ln);
  }

  const floorsResult = {
    netP50: netP50 >= floors.netP50Cents,
    roi: roi >= floors.roi,
    laborHr: dollarPerLaborHour >= floors.dollarPerLaborHourCents,
    pass: false,
  };
  floorsResult.pass = floorsResult.netP50 && floorsResult.roi && floorsResult.laborHr;

  const waterfall: WaterfallLine[] = [
    { label: "Resale P50", amountCents: input.resaleP50Cents, kind: "resale" },
    { label: `Platform fee (${(input.fee.pctBp / 100).toFixed(2)}% + fixed)`, amountCents: -platformPct(input.resaleP50Cents), kind: "sell_cost" },
  ];
  const payment = paymentFee(input.resaleP50Cents);
  if (payment > 0n) waterfall.push({ label: "Payment processing", amountCents: -payment, kind: "sell_cost" });
  if (promoBp > 0) waterfall.push({ label: `Promoted ads (${(promoBp / 100).toFixed(2)}%)`, amountCents: -promo(input.resaleP50Cents), kind: "sell_cost" });
  waterfall.push({ label: "Outbound shipping", amountCents: -input.outboundShipCents, kind: "sell_cost" });
  if (packaging > 0n) waterfall.push({ label: "Packaging", amountCents: -packaging, kind: "sell_cost" });
  if (returnsReserve > 0n) waterfall.push({ label: "Returns reserve", amountCents: -returnsReserve, kind: "sell_cost" });
  if (fraud > 0n) waterfall.push({ label: "Fraud/INAD reserve", amountCents: -fraud, kind: "sell_cost" });
  if (doa > 0n) waterfall.push({ label: "DOA risk (untested)", amountCents: -doa, kind: "sell_cost" });
  waterfall.push({ label: "Net resale proceeds", amountCents: netResaleProceeds, kind: "subtotal" });
  waterfall.push({ label: "Purchase", amountCents: -input.purchaseCents, kind: "buy_cost" });
  if (acquisitionTax > 0n) waterfall.push({ label: "Acquisition tax", amountCents: -acquisitionTax, kind: "buy_cost" });
  if (inbound > 0n) waterfall.push({ label: "Inbound shipping", amountCents: -inbound, kind: "buy_cost" });
  if (travel > 0n) waterfall.push({ label: "Travel", amountCents: -travel, kind: "buy_cost" });
  waterfall.push({ label: "Capital carry", amountCents: -capitalCarry, kind: "carry" });
  waterfall.push({ label: "Labor", amountCents: -labor, kind: "labor" });
  waterfall.push({ label: "True net (P50)", amountCents: netP50, kind: "total" });

  return {
    netResaleProceedsCents: netResaleProceeds,
    cashAtRiskCents: cashAtRisk,
    netP50Cents: netP50,
    cashNetCents: cashNet,
    netP10Cents: netP10,
    roi,
    cashRoi,
    dollarPerLaborHourCents: dollarPerLaborHour,
    dollarPerCapitalDayCents: dollarPerCapitalDay,
    breakEvenResaleCents,
    pProfit,
    floors: floorsResult,
    waterfall,
  };
}
