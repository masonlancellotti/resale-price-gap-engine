import type { Autonomy } from "@flip-desk/core";
import type { Cents } from "@flip-desk/money";

/**
 * Auto-buy envelope (plan §8.6, §9.3, §16 Phase 5). Graduation (L2→L3) is necessary but NOT sufficient
 * to auto-commit money: an L3 platform-checkout buy runs unattended ONLY inside a tight envelope —
 * small ticket, high confidence, whitelisted category, and under a daily aggregate cap. Anything
 * outside the envelope falls back to a one-tap human approval. This is the belt to graduation's
 * suspenders; the Sentinel's hard daily cap (plan §12.1) is a third, independent guard.
 */
export interface AutoBuyEnvelope {
  readonly maxDealCents: Cents; // e.g. $50
  readonly minConfidence: number; // e.g. 0.8
  readonly whitelistedCategories: readonly string[];
  readonly dayCapCents: Cents; // e.g. $200 aggregate/day
}

export const DEFAULT_AUTOBUY_ENVELOPE: AutoBuyEnvelope = {
  maxDealCents: 5_000n,
  minConfidence: 0.8,
  whitelistedCategories: ["games"],
  dayCapCents: 20_000n,
};

export interface AutoBuyContext {
  readonly level: Autonomy; // the graduated level for this action class
  readonly allInCents: Cents;
  readonly confidence: number;
  readonly categorySlug: string;
  readonly daySpentCents: Cents; // auto-buy spend already committed today
}

export type AutoBuyReason =
  | "ok"
  | "not_graduated"
  | "over_deal_cap"
  | "low_confidence"
  | "category_not_whitelisted"
  | "day_cap_exceeded";

export interface AutoBuyDecision {
  readonly permitted: boolean;
  readonly reason: AutoBuyReason;
}

const ok: AutoBuyDecision = { permitted: true, reason: "ok" };
const no = (reason: AutoBuyReason): AutoBuyDecision => ({ permitted: false, reason });

export function autoBuyPermitted(env: AutoBuyEnvelope, ctx: AutoBuyContext): AutoBuyDecision {
  if (ctx.level !== "L3" && ctx.level !== "L4") return no("not_graduated");
  if (ctx.allInCents > env.maxDealCents) return no("over_deal_cap");
  if (ctx.confidence < env.minConfidence) return no("low_confidence");
  if (!env.whitelistedCategories.includes(ctx.categorySlug)) return no("category_not_whitelisted");
  if (ctx.daySpentCents + ctx.allInCents > env.dayCapCents) return no("day_cap_exceeded");
  return ok;
}
