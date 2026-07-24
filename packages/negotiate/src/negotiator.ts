import type { LlmClient } from "@flip-desk/llm";
import type { Cents } from "@flip-desk/money";
import { draftReply, type DraftParams } from "./draft.js";
import { sendPolicyFor } from "./sending.js";
import {
  anchoredStrategy,
  type BuyerStrategy,
  DEFAULT_NEG_POLICY,
  evaluateCounter,
  type NegotiationContext,
  type NegotiationPolicy,
  openingOfferCents,
} from "./strategy.js";

/**
 * The Negotiator (plan §5.3 #7, §8.5): opening-offer selection, counter evaluation against the
 * underwrite walk-away, message drafting (untrusted seller text fenced), and the per-platform send
 * policy. The heavy strategy tuning lives in {@link import("./simulate.js")} so the learner can fit it.
 */
export class Negotiator {
  constructor(
    private readonly llm: LlmClient,
    private readonly policy: NegotiationPolicy = DEFAULT_NEG_POLICY,
  ) {}

  opening(ctx: NegotiationContext): Cents {
    return openingOfferCents(ctx, this.policy);
  }

  evaluate(counterCents: Cents, ctx: NegotiationContext): "accept" | "walk" {
    return evaluateCounter(counterCents, ctx.walkAwayCents);
  }

  strategy(): BuyerStrategy {
    return anchoredStrategy(this.policy);
  }

  draft(params: DraftParams): Promise<string> {
    return draftReply(this.llm, params);
  }

  sendPolicy(platform: string) {
    return sendPolicyFor(platform);
  }
}
