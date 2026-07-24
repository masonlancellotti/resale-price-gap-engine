import { type Cents, mulBp } from "@flip-desk/money";

/**
 * The Pricer (plan §5.3, §8.8): time-on-site repricing. Every listing ages against its predicted
 * time-to-sale curve; the longer it sits past that curve, the deeper the markdown — but NEVER below
 * the floor (cost basis + minimum margin). It also fires Best-Offer style nudges to watchers once a
 * listing is stale enough. Pure function of (listing age, TTS estimate, watchers) + an injected clock.
 */
const DAY_MS = 86_400_000;

export interface LadderStep {
  readonly atAgeRatio: number; // daysListed / ttsDaysP50 threshold
  readonly cutBp: number; // basis points off the ORIGINAL list price
}

export interface PricePolicy {
  readonly minMarginCents: Cents;
  readonly minMarginBp: number; // floor margin is max(abs, relative) over cost basis
  readonly ladder: readonly LadderStep[]; // ascending by atAgeRatio
  readonly watcherOffer: {
    readonly minWatchers: number;
    readonly atAgeRatio: number;
    readonly cutBp: number;
    readonly cooldownDays: number;
  };
}

export const DEFAULT_PRICE_POLICY: PricePolicy = {
  minMarginCents: 500n,
  minMarginBp: 1000,
  ladder: [
    { atAgeRatio: 1.0, cutBp: 800 },
    { atAgeRatio: 1.5, cutBp: 1500 },
    { atAgeRatio: 2.0, cutBp: 2500 },
  ],
  watcherOffer: { minWatchers: 2, atAgeRatio: 0.75, cutBp: 1000, cooldownDays: 3 },
};

export interface RepriceInput {
  readonly costBasisCents: Cents;
  readonly originalListCents: Cents;
  readonly currentPriceCents: Cents;
  readonly listedAt: string; // ISO
  readonly ttsDaysP50: number;
  readonly watcherCount?: number;
  readonly lastOfferAt?: string; // ISO
  readonly policy?: PricePolicy;
}

export type RepriceAction = "hold" | "markdown" | "offer_watchers";

export interface RepriceDecision {
  readonly action: RepriceAction;
  readonly newPriceCents: Cents;
  readonly offerPriceCents?: Cents;
  readonly floorCents: Cents;
  readonly ageRatio: number;
  readonly reason: string;
}

export function floorPrice(costBasisCents: Cents, policy: PricePolicy): Cents {
  const relative = mulBp(costBasisCents, policy.minMarginBp);
  const margin = relative > policy.minMarginCents ? relative : policy.minMarginCents;
  return costBasisCents + margin;
}

function daysBetween(fromIso: string, now: Date): number {
  return (now.getTime() - Date.parse(fromIso)) / DAY_MS;
}

/** Deepest ladder cut whose age threshold we've passed (0 if still fresh). */
function ladderCutBp(ageRatio: number, ladder: readonly LadderStep[]): number {
  let cut = 0;
  for (const step of ladder) if (ageRatio >= step.atAgeRatio && step.cutBp > cut) cut = step.cutBp;
  return cut;
}

export function reprice(input: RepriceInput, now: Date): RepriceDecision {
  const policy = input.policy ?? DEFAULT_PRICE_POLICY;
  const floor = floorPrice(input.costBasisCents, policy);
  const tts = input.ttsDaysP50 > 0 ? input.ttsDaysP50 : 1;
  const ageRatio = daysBetween(input.listedAt, now) / tts;

  // --- markdown ladder (never below floor, never a price increase) ---
  const cutBp = ladderCutBp(ageRatio, policy.ladder);
  const ladderTarget = mulBp(input.originalListCents, 10_000 - cutBp);
  const bounded = ladderTarget < input.currentPriceCents ? ladderTarget : input.currentPriceCents;
  const newPrice = bounded > floor ? bounded : floor;
  const markdown = newPrice < input.currentPriceCents;

  // --- watcher offer (independent nudge) ---
  const wo = policy.watcherOffer;
  const watchers = input.watcherCount ?? 0;
  const cooledDown = input.lastOfferAt === undefined || daysBetween(input.lastOfferAt, now) >= wo.cooldownDays;
  const offerEligible = watchers >= wo.minWatchers && ageRatio >= wo.atAgeRatio && cooledDown;
  let offerPriceCents: Cents | undefined;
  if (offerEligible) {
    const base = mulBp(newPrice, 10_000 - wo.cutBp);
    offerPriceCents = base > floor ? base : floor;
    if (offerPriceCents >= newPrice) offerPriceCents = undefined; // nothing to offer once at floor
  }

  const action: RepriceAction = markdown ? "markdown" : offerPriceCents !== undefined ? "offer_watchers" : "hold";
  const reason = markdown
    ? `age ${ageRatio.toFixed(2)}× TTS → cut ${cutBp / 100}%`
    : offerPriceCents !== undefined
      ? `${watchers} watchers, age ${ageRatio.toFixed(2)}× TTS → offer`
      : `age ${ageRatio.toFixed(2)}× TTS → hold`;

  return {
    action,
    newPriceCents: newPrice,
    ...(offerPriceCents !== undefined ? { offerPriceCents } : {}),
    floorCents: floor,
    ageRatio,
    reason,
  };
}
