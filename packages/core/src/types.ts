import type { Cents } from "@flip-desk/money";
import type { Channel } from "./tiers.js";

// ---- condition & status vocabularies (plan §6, §7.3) -------------------------------------------

export const CONDITION_BANDS = ["new", "like_new", "good", "fair", "parts"] as const;
export type ConditionBand = (typeof CONDITION_BANDS)[number];

export const LISTING_STATUSES = ["active", "pending", "sold", "removed", "stale"] as const;
export type ListingStatus = (typeof LISTING_STATUSES)[number];

// ---- sourcing side ------------------------------------------------------------------------------

/**
 * What a {@link SourceAdapter} emits. `payload` is **attacker-controlled** (plan §12.5 P5): it is
 * adapter-specific data, never trusted as instructions and never fed to an LLM except inside a
 * fenced, labeled data block. Downstream code reads it only through schema-validated extraction.
 */
export interface RawListing {
  readonly sourceCode: string;
  readonly externalId: string;
  readonly channel: Channel;
  readonly url?: string;
  /** ISO-8601 UTC. Clock discipline: everything is UTC in storage (plan §5.4). */
  readonly fetchedAt: string;
  readonly payload: unknown;
}

/** The canonical fields a normalizer extracts from a {@link RawListing}, before the store assigns identity. */
export interface NormalizedListing {
  readonly sourceCode: string;
  readonly externalId: string;
  readonly url?: string;
  readonly title: string;
  readonly description?: string;
  readonly priceCents: Cents;
  readonly conditionClaimed?: string;
  readonly attrs: Record<string, unknown>;
  readonly postedAt?: string;
  /** SHA-256 of the source payload — the dedupe key (plan §5.4). */
  readonly contentHash: string;
}

/** A persisted, deduped listing (plan §6, `listing`). */
export interface Listing extends NormalizedListing {
  readonly id: number;
  readonly status: ListingStatus;
  readonly firstSeen: string;
  readonly lastSeen: string;
}

// ---- catalog & valuation (plan §6) --------------------------------------------------------------

export interface Product {
  readonly id: number;
  readonly canonicalKey: string; // 'upc:…' | 'epid:…' | 'pcid:…' | 'bl:…'
  readonly categoryId: number;
  readonly brand?: string;
  readonly model?: string;
  readonly variant: Record<string, unknown>;
  readonly identifiers?: Record<string, unknown>; // { upc: string|string[], mpn, asin, epid }
  readonly title: string;
  /** Category trap checklist injected into adjudication (plan §7.2). */
  readonly gotchas?: readonly string[];
}

export interface Comp {
  readonly productId: number;
  readonly provider: string; // 'terapeak' | 'pricecharting' | 'discogs' | 'vendor:apify' | …
  readonly conditionBand: ConditionBand;
  readonly completeness?: "complete" | "item_only" | "sealed";
  readonly priceCents: Cents;
  readonly soldAt: string; // ISO date
  /** Hashed seller identity — powers the anti-shill seller-diversity check (plan §7.4). */
  readonly sellerKey?: string;
}

export interface Valuation {
  readonly productId: number;
  readonly conditionBand: ConditionBand;
  readonly modelVersion: string;
  readonly nComps: number;
  readonly providers: readonly string[];
  readonly p10Cents: Cents;
  readonly p50Cents: Cents;
  readonly p90Cents: Cents;
  readonly sellThrough90d?: number;
  readonly ttsDaysP50?: number;
  readonly confidence: number; // [0,1]
}

// ---- deal flow (slim; fleshed out in Phase 1) --------------------------------------------------

export const RISK_FLAGS = [
  "untested",
  "stolen_risk",
  "counterfeit_risk",
  "no_return_exit",
  "oversize",
  "condition_conflict",
  "single_provider_comps",
] as const;
export type RiskFlag = (typeof RISK_FLAGS)[number];

export interface Opportunity {
  readonly id: number;
  readonly listingId: number;
  readonly productId?: number;
  readonly valuationId?: number;
  readonly state: string;
  readonly netP50Cents?: Cents;
  readonly netP10Cents?: Cents;
  readonly roi?: number;
  readonly score?: number;
  readonly pProfit?: number;
  readonly riskFlags: readonly RiskFlag[];
}
