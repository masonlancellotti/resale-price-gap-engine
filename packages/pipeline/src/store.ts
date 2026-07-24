import type { Listing, NormalizedListing } from "@flip-desk/core";
import type { Cents } from "@flip-desk/money";

export interface PriceEvent {
  readonly listingKey: string;
  readonly observedAt: string;
  readonly priceCents: Cents;
}

export interface UpsertResult {
  readonly created: boolean;
  readonly updated: boolean;
  readonly listing: Listing;
}

/** Injectable clock so tests are deterministic and everything is UTC (plan §5.4). */
export interface Clock {
  now(): string;
}
const systemClock: Clock = { now: () => new Date().toISOString() };

/**
 * In-memory canonical listing store (plan §6, `listing`). Production backs this with Postgres, but
 * the upsert/dedupe semantics are identical: keyed by (source, external_id), content-hash decides
 * whether a re-observation is a no-op dedupe or a real edit that emits a price event.
 */
export class ListingStore {
  #byKey = new Map<string, Listing>();
  #priceEvents: PriceEvent[] = [];
  #nextId = 1;

  constructor(private readonly clock: Clock = systemClock) {}

  static key(sourceCode: string, externalId: string): string {
    return `${sourceCode}::${externalId}`;
  }

  upsert(n: NormalizedListing): UpsertResult {
    const key = ListingStore.key(n.sourceCode, n.externalId);
    const now = this.clock.now();
    const existing = this.#byKey.get(key);

    if (!existing) {
      const listing: Listing = { id: this.#nextId++, status: "active", firstSeen: now, lastSeen: now, ...n };
      this.#byKey.set(key, listing);
      this.#priceEvents.push({ listingKey: key, observedAt: now, priceCents: n.priceCents });
      return { created: true, updated: false, listing };
    }

    // Identical content → a re-observation. Refresh lastSeen only; this is the dedupe path.
    if (existing.contentHash === n.contentHash) {
      const listing: Listing = { ...existing, lastSeen: now };
      this.#byKey.set(key, listing);
      return { created: false, updated: false, listing };
    }

    // Content changed (price drop, edited title, …) → update and, if price moved, record the event.
    const priceChanged = existing.priceCents !== n.priceCents;
    const listing: Listing = {
      ...existing,
      ...n,
      id: existing.id,
      status: existing.status,
      firstSeen: existing.firstSeen,
      lastSeen: now,
    };
    this.#byKey.set(key, listing);
    if (priceChanged) this.#priceEvents.push({ listingKey: key, observedAt: now, priceCents: n.priceCents });
    return { created: false, updated: true, listing };
  }

  get(sourceCode: string, externalId: string): Listing | undefined {
    return this.#byKey.get(ListingStore.key(sourceCode, externalId));
  }

  all(): Listing[] {
    return [...this.#byKey.values()];
  }

  get size(): number {
    return this.#byKey.size;
  }

  priceEvents(sourceCode: string, externalId: string): PriceEvent[] {
    const key = ListingStore.key(sourceCode, externalId);
    return this.#priceEvents.filter((e) => e.listingKey === key);
  }
}
