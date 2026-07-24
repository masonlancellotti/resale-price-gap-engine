import { type Cents, mulBp } from "@flip-desk/money";

/**
 * Negotiation strategy (plan §8.5, §7.7). The opening anchor is the lever: the learner tunes the
 * "acceptance curve by anchor depth → optimal opening offer per category". A calibrated anchor closes
 * deals a fixed lowball leaves on the table (sellers decline insulting offers) while never paying
 * above the underwrite walk-away.
 */
export interface NegotiationContext {
  readonly askCents: Cents;
  /** Max we will pay and still clear the underwrite floors (plan §7.5). */
  readonly walkAwayCents: Cents;
  readonly categorySlug: string;
}

export type ThreadState = "open" | "offered" | "countered" | "accepted" | "declined" | "expired";

export type Move =
  | { readonly kind: "offer"; readonly cents: Cents }
  | { readonly kind: "accept"; readonly cents: Cents }
  | { readonly kind: "walk" };

export interface NegotiationPolicy {
  /** category slug → opening discount off ask, in basis points. */
  readonly anchorDepthBp: Readonly<Record<string, number>>;
  readonly defaultAnchorBp: number;
  readonly maxRounds: number;
}

export const DEFAULT_NEG_POLICY: NegotiationPolicy = {
  anchorDepthBp: { games: 2200, console: 2000, lego: 1800, vinyl: 2500, gear: 1500 },
  defaultAnchorBp: 2000,
  maxRounds: 3,
};

export function anchorDepthBp(categorySlug: string, policy: NegotiationPolicy): number {
  return policy.anchorDepthBp[categorySlug] ?? policy.defaultAnchorBp;
}

export function openingOfferCents(ctx: NegotiationContext, policy: NegotiationPolicy): Cents {
  return mulBp(ctx.askCents, 10_000 - anchorDepthBp(ctx.categorySlug, policy));
}

/** Core counter-evaluation: accept anything at or under the walk-away, else walk. */
export function evaluateCounter(counterCents: Cents, walkAwayCents: Cents): "accept" | "walk" {
  return counterCents <= walkAwayCents ? "accept" : "walk";
}

export interface BuyerStrategy {
  readonly name: string;
  open(ctx: NegotiationContext): Cents;
  onCounter(ctx: NegotiationContext, counterCents: Cents): Move;
}

/** Category-anchored opening + accept-under-walk-away. */
export function anchoredStrategy(policy: NegotiationPolicy = DEFAULT_NEG_POLICY): BuyerStrategy {
  return {
    name: "anchored",
    open: (ctx) => openingOfferCents(ctx, policy),
    onCounter: (ctx, counter) =>
      evaluateCounter(counter, ctx.walkAwayCents) === "accept" ? { kind: "accept", cents: counter } : { kind: "walk" },
  };
}

/** The naive baseline: always open at a fixed deep lowball, same accept rule. */
export function fixedLowballStrategy(lowballBp = 5000): BuyerStrategy {
  return {
    name: "fixed_lowball",
    open: (ctx) => mulBp(ctx.askCents, 10_000 - lowballBp),
    onCounter: (ctx, counter) =>
      evaluateCounter(counter, ctx.walkAwayCents) === "accept" ? { kind: "accept", cents: counter } : { kind: "walk" },
  };
}
