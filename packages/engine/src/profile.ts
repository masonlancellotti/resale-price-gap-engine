import type { Cents } from "@flip-desk/money";

/**
 * Category cost/handling defaults fed into the underwriter and ranker (plan §7.5). Phase 1 ships one
 * vertical — video games/consoles — because PriceCharting gives the best licensed comps for early
 * valuation feedback (plan §16 Phase 1).
 */
export interface CategoryProfile {
  readonly channel: string; // primary exit
  readonly outboundShipCents: Cents;
  readonly packagingCents?: Cents;
  readonly returns?: { readonly pReturnBp: number; readonly expectedLossCents: Cents };
  readonly laborMinutes: number;
  readonly aprBp?: number;
  readonly defaultTtsDays: number;
  readonly promotedRateBp?: number;
}

export const GAMES_PROFILE: CategoryProfile = {
  channel: "ebay",
  outboundShipCents: 900n, // ~$9 small padded flat
  packagingCents: 150n,
  returns: { pReturnBp: 600, expectedLossCents: 3_000n }, // ~6% return, ~$30 loss
  laborMinutes: 20, // low-touch: test disc, photo, list, pack
  aprBp: 800,
  defaultTtsDays: 12,
  promotedRateBp: 300,
};

export type ProfileResolver = (categoryId: number) => CategoryProfile;

/** Phase 1: a single vertical, so every category resolves to the games profile. */
export const defaultProfileFor: ProfileResolver = () => GAMES_PROFILE;
