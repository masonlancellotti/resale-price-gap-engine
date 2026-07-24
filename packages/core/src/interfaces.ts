import type { Cents } from "@flip-desk/money";
import type { Channel, Tier } from "./tiers.js";
import type { Comp, ConditionBand, Product, RawListing } from "./types.js";

/** Ambient context handed to long-running adapter work: cooperative cancellation + structured logging. */
export interface AdapterContext {
  readonly signal?: AbortSignal;
  readonly log: (msg: string, meta?: Record<string, unknown>) => void;
}

/**
 * The one interface every ingestion source implements (plan §5.3 #1). Each adapter owns its rate
 * budget and a `selfTest` canary (plan §10.1) so schema drift quarantines *that* adapter without
 * stalling the others. `poll` streams raw payloads; the normalizer canonicalizes and dedupes them.
 */
export interface SourceAdapter {
  readonly code: string;
  readonly tier: Tier;
  readonly channel: Channel;
  /** Yield raw listings. Must honor `ctx.signal` so the Sentinel's kill switch can stop it (P7). */
  poll(ctx: AdapterContext): AsyncIterable<RawListing>;
  /** Parse a known fixture and confirm the adapter still understands the source's shape. */
  selfTest(): Promise<boolean>;
}

export interface CompQuery {
  readonly product: Product;
  readonly conditionBand?: ConditionBand;
  readonly windowDays?: number;
}

/**
 * A licensed/official sold-comp source (plan §4.1). Comps arrive through this abstraction with
 * per-category routing (games→PriceCharting, LEGO→BrickLink, vinyl→Discogs, gear→Reverb, …), each
 * returning normalized {@link Comp} rows tagged with provenance.
 */
export interface CompProvider {
  readonly name: string;
  readonly tier: Tier;
  supports(categoryId: number): boolean;
  fetchComps(query: CompQuery): Promise<Comp[]>;
}

export interface PublishInput {
  readonly platform: string;
  readonly title: string;
  readonly description: string;
  readonly priceCents: Cents;
  readonly specifics: Record<string, unknown>;
  readonly photoKeys: readonly string[];
  /** Natural idempotency key so publish retries are exactly-once-effective (plan §5.4). */
  readonly idempotencyKey: string;
}

export interface PublishResult {
  readonly externalId: string;
  readonly url?: string;
}

/** An exit channel we can list on (plan §4.3). `end` is what the delist saga calls on a sale (§8.7). */
export interface Publisher {
  readonly platform: string;
  readonly tier: Tier;
  publish(input: PublishInput): Promise<PublishResult>;
  end(externalId: string): Promise<void>;
}
