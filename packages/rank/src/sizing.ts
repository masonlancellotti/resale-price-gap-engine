import { type Cents, mulBp } from "@flip-desk/money";

/**
 * Position sizing (plan §7.6): fractional-Kelly with hard caps. max cash/deal = 5% of bankroll;
 * category exposure ≤ 25% of bankroll; total deployed ≤ 80%; confidence < 0.6 halves the per-deal
 * cap. The Sentinel's bankroll policy is a second, independent guard above this (plan §12.1).
 */
export interface SizingPolicy {
  readonly maxPerDealPct: number;
  readonly maxDeployedPct: number;
  readonly categoryExposurePct: number;
  readonly lowConfidenceThreshold: number;
}

export const DEFAULT_SIZING: SizingPolicy = {
  maxPerDealPct: 5,
  maxDeployedPct: 80,
  categoryExposurePct: 25,
  lowConfidenceThreshold: 0.6,
};

export interface Bankroll {
  readonly totalCents: Cents;
  readonly deployedCents: Cents;
  readonly categoryDeployedCents?: Cents;
}

export interface SizingInput {
  readonly bankroll: Bankroll;
  readonly confidence: number;
  readonly allInCents: Cents; // the deal's cash requirement
  readonly bandCapCents?: Cents; // optional per-band ceiling
  readonly policy?: SizingPolicy;
}

export type BindingConstraint = "per_deal" | "deployed_room" | "category_room" | "band_cap" | "confidence_halved";

export interface SizingResult {
  readonly capCents: Cents; // most you may commit to this deal right now
  readonly allowed: boolean; // allInCents fits within the cap (and is positive)
  readonly bindingConstraint: BindingConstraint;
  readonly confidenceHalved: boolean;
}

function pctCents(total: Cents, pct: number): Cents {
  return mulBp(total, Math.round(pct * 100)); // 5% = 500 bp
}

function roomAbove(limit: Cents, used: Cents): Cents {
  const room = limit - used;
  return room > 0n ? room : 0n;
}

export function positionSize(input: SizingInput): SizingResult {
  const policy = input.policy ?? DEFAULT_SIZING;
  const { totalCents, deployedCents } = input.bankroll;
  const categoryDeployed = input.bankroll.categoryDeployedCents ?? 0n;

  const confidenceHalved = input.confidence < policy.lowConfidenceThreshold;
  const perDeal = confidenceHalved
    ? pctCents(totalCents, policy.maxPerDealPct) / 2n
    : pctCents(totalCents, policy.maxPerDealPct);
  const deployedRoom = roomAbove(pctCents(totalCents, policy.maxDeployedPct), deployedCents);
  const categoryRoom = roomAbove(pctCents(totalCents, policy.categoryExposurePct), categoryDeployed);

  const candidates: Array<{ cap: Cents; who: BindingConstraint }> = [
    { cap: perDeal, who: confidenceHalved ? "confidence_halved" : "per_deal" },
    { cap: deployedRoom, who: "deployed_room" },
    { cap: categoryRoom, who: "category_room" },
  ];
  if (input.bandCapCents !== undefined) candidates.push({ cap: input.bandCapCents, who: "band_cap" });

  let binding = candidates[0]!;
  for (const c of candidates) if (c.cap < binding.cap) binding = c;

  return {
    capCents: binding.cap,
    allowed: input.allInCents > 0n && input.allInCents <= binding.cap,
    bindingConstraint: binding.who,
    confidenceHalved,
  };
}
