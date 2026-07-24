import { type Cents, mulBp, sumCents } from "@flip-desk/money";
import type { BuyerStrategy, NegotiationContext, ThreadState } from "./strategy.js";

/**
 * Seller model for offline strategy evaluation (plan §7.7 acceptance-curve fitting). Sellers accept
 * offers at/above their hidden reservation, decline insulting lowballs outright, and otherwise make
 * one firm counter at their reservation. Simple, deterministic, and enough to show a calibrated
 * anchor beats a fixed lowball.
 */
export type SellerResponse = { kind: "accept" } | { kind: "counter"; cents: Cents } | { kind: "decline" };

export interface SellerModel {
  respond(offerCents: Cents, ctx: NegotiationContext): SellerResponse;
}

export class DeterministicSeller implements SellerModel {
  constructor(
    private readonly reservationCents: Cents,
    private readonly insultBp = 7000, // offers below reservation·0.70 are declined as insulting
  ) {}
  respond(offerCents: Cents): SellerResponse {
    if (offerCents >= this.reservationCents) return { kind: "accept" };
    if (offerCents < mulBp(this.reservationCents, this.insultBp)) return { kind: "decline" };
    return { kind: "counter", cents: this.reservationCents };
  }
}

export interface NegotiationOutcome {
  readonly state: ThreadState;
  readonly closed: boolean;
  readonly priceCents?: Cents;
  readonly surplusCents: Cents; // walkAway − price (value captured), 0 if not closed
  readonly rounds: number;
}

export function simulateNegotiation(
  strategy: BuyerStrategy,
  seller: SellerModel,
  ctx: NegotiationContext,
): NegotiationOutcome {
  const open = strategy.open(ctx);
  const first = seller.respond(open, ctx);
  if (first.kind === "accept") return closed(open, ctx, 1);
  if (first.kind === "decline") return notClosed("declined", 1);

  const move = strategy.onCounter(ctx, first.cents);
  if (move.kind === "accept") return closed(move.cents, ctx, 2);
  return notClosed("expired", 2);
}

function closed(priceCents: Cents, ctx: NegotiationContext, rounds: number): NegotiationOutcome {
  return { state: "accepted", closed: true, priceCents, surplusCents: ctx.walkAwayCents - priceCents, rounds };
}
function notClosed(state: ThreadState, rounds: number): NegotiationOutcome {
  return { state, closed: false, surplusCents: 0n, rounds };
}

export interface PopulationStats {
  readonly n: number;
  readonly closed: number;
  readonly closeRate: number;
  readonly totalSurplusCents: Cents;
  readonly avgPriceCents: Cents;
  readonly maxPriceCents: Cents;
}

export function runPopulation(
  strategy: BuyerStrategy,
  population: ReadonlyArray<{ seller: SellerModel; ctx: NegotiationContext }>,
): PopulationStats {
  const outcomes = population.map(({ seller, ctx }) => simulateNegotiation(strategy, seller, ctx));
  const closedOutcomes = outcomes.filter((o) => o.closed);
  const prices = closedOutcomes.map((o) => o.priceCents!);
  const totalSurplus = sumCents(outcomes.map((o) => o.surplusCents));
  const avgPrice = prices.length > 0 ? sumCents(prices) / BigInt(prices.length) : 0n;
  const maxPrice = prices.reduce((m, p) => (p > m ? p : m), 0n);
  return {
    n: population.length,
    closed: closedOutcomes.length,
    closeRate: population.length > 0 ? closedOutcomes.length / population.length : 0,
    totalSurplusCents: totalSurplus,
    avgPriceCents: avgPrice,
    maxPriceCents: maxPrice,
  };
}
