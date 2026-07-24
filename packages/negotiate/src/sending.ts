import type { Autonomy, Tier } from "@flip-desk/core";

/**
 * Sending tiers (plan §8.5). Drafting is always T0. Auto-SEND depends on the platform: eBay Best
 * Offer and Mercari offers are official mechanisms (T0) and can run L3 on day one; on API-less
 * platforms (FB/OfferUp/Craigslist) auto-send is T4 territory — default-off, assisted at most.
 */
export interface SendPolicy {
  readonly platform: string;
  /** Drafting into the UI is always permitted (just text). */
  readonly draftAllowed: true;
  /** Tier required to AUTO-send without a human tap. */
  readonly autoSendTier: Tier;
  /** Highest autonomy this platform's official channel supports. */
  readonly autoSendAutonomy: Autonomy;
}

const OFFICIAL_OFFER_PLATFORMS = new Set(["ebay", "mercari"]);

export function sendPolicyFor(platform: string): SendPolicy {
  if (OFFICIAL_OFFER_PLATFORMS.has(platform)) {
    return { platform, draftAllowed: true, autoSendTier: "T0", autoSendAutonomy: "L3" };
  }
  // fb_mkt / offerup / craigslist and friends: auto-send is unattended own-account automation.
  return { platform, draftAllowed: true, autoSendTier: "T4", autoSendAutonomy: "L2" };
}
