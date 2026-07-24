import type { Cents } from "@flip-desk/money";

/** A minimal listing shape the funnel needs — decoupled from the full `listing` row. */
export interface IdentifyListing {
  readonly externalId: string;
  readonly title: string;
  readonly description?: string;
  readonly priceCents: Cents;
  readonly conditionClaimed?: string;
  readonly sellerHandle?: string;
  readonly distanceMi?: number;
  readonly attrs?: Record<string, unknown>;
}

/** F0 filter config (plan §7.1). Cheap keyword/price/geo/blocklist rules run before any LLM spend. */
export interface FilterConfig {
  readonly minPriceCents?: Cents;
  readonly maxPriceCents?: Cents;
  /** Title must contain at least one of these (category relevance). */
  readonly requireKeywords?: readonly string[];
  readonly blockedSellers?: readonly string[];
  /** Dropship / spam template patterns to drop outright. */
  readonly blockedTitlePatterns?: readonly RegExp[];
  readonly maxDistanceMi?: number;
}

export interface FilterResult {
  readonly pass: boolean;
  readonly reason?: string;
}

const PASS: FilterResult = { pass: true };

/** F0 — the cheapest gate. Returns the first failing reason, or pass (plan §7.1, ~30% pass). */
export function f0Filter(listing: IdentifyListing, cfg: FilterConfig): FilterResult {
  if (cfg.minPriceCents !== undefined && listing.priceCents < cfg.minPriceCents) {
    return { pass: false, reason: "below_min_price" };
  }
  if (cfg.maxPriceCents !== undefined && listing.priceCents > cfg.maxPriceCents) {
    return { pass: false, reason: "above_max_price" };
  }
  if (cfg.maxDistanceMi !== undefined && listing.distanceMi !== undefined && listing.distanceMi > cfg.maxDistanceMi) {
    return { pass: false, reason: "too_far" };
  }
  if (cfg.blockedSellers && listing.sellerHandle && cfg.blockedSellers.includes(listing.sellerHandle)) {
    return { pass: false, reason: "blocked_seller" };
  }
  const title = listing.title.toLowerCase();
  if (cfg.blockedTitlePatterns?.some((re) => re.test(title))) {
    return { pass: false, reason: "dropship_template" };
  }
  if (cfg.requireKeywords && cfg.requireKeywords.length > 0) {
    const hit = cfg.requireKeywords.some((k) => title.includes(k.toLowerCase()));
    if (!hit) return { pass: false, reason: "off_category" };
  }
  return PASS;
}
