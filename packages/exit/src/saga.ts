import type { Publisher } from "@flip-desk/core";
import { type Clock, SystemClock } from "./clock.js";
import { Outbox } from "./outbox.js";
import { type ChannelListing, ListingRegistry } from "./registry.js";

/** A delist attempt whose error may declare itself non-retryable (fatal errors are never retried, P7). */
export interface DelistError extends Error {
  readonly fatal?: boolean;
}

export interface HaltEvent {
  readonly sku: string;
  readonly platform: string;
  readonly externalId: string;
  readonly reason: string;
}

export interface RetryPolicy {
  readonly maxAttempts: number;
  readonly backoffMs: number;
}

export const DEFAULT_RETRY: RetryPolicy = { maxAttempts: 3, backoffMs: 3_000 };

export interface ChannelDelistOutcome {
  readonly platform: string;
  readonly externalId: string;
  readonly status: "ended" | "failed";
  readonly attempts: number;
}

export type SaleOutcome = "delisted" | "already_sold" | "no_listings";

export interface DelistResult {
  readonly sku: string;
  readonly outcome: SaleOutcome;
  readonly soldChannel?: string;
  /** Loser path: a competing sale already won this item — the caller must refund/cancel this order. */
  readonly requiresRefund: boolean;
  readonly ended: readonly ChannelDelistOutcome[];
  readonly failed: readonly ChannelDelistOutcome[];
  readonly elapsedMs: number;
  /** True if any channel could not be ended → P7 halt fired, listing flagged for a human. */
  readonly halted: boolean;
}

export interface DelistSagaDeps {
  readonly registry: ListingRegistry;
  readonly publishers: ReadonlyMap<string, Publisher>;
  readonly outbox?: Outbox;
  readonly clock?: Clock;
  readonly retry?: RetryPolicy;
  readonly onHalt?: (e: HaltEvent) => void;
}

/**
 * The delist saga (plan §8.7, §10.4): when an item sells on any channel, end every OTHER channel's
 * listing within 60s so nothing oversells. Oversell is prevented up front by the registry's sale
 * claim (single winner); this saga then converges the survivors — retrying transient end() failures
 * with backoff, and on terminal failure marking the listing end_failed + halting (never sneaking, P7).
 * Every end() goes through the outbox so replays/duplicate events are exactly-once-effective.
 */
export class DelistSaga {
  private readonly registry: ListingRegistry;
  private readonly publishers: ReadonlyMap<string, Publisher>;
  private readonly outbox: Outbox;
  private readonly clock: Clock;
  private readonly retry: RetryPolicy;
  private readonly onHalt: ((e: HaltEvent) => void) | undefined;

  constructor(deps: DelistSagaDeps) {
    this.registry = deps.registry;
    this.publishers = deps.publishers;
    this.outbox = deps.outbox ?? new Outbox();
    this.clock = deps.clock ?? new SystemClock();
    this.retry = deps.retry ?? DEFAULT_RETRY;
    this.onHalt = deps.onHalt;
  }

  async onSale(sku: string, soldChannel: string, soldExternalId: string): Promise<DelistResult> {
    // Synchronous oversell guard — runs before the first await so concurrent sales serialize here.
    const claim = this.registry.claimSale(sku, soldChannel, soldExternalId);
    if (claim === "lost") {
      const winner = this.registry.soldOn(sku);
      return {
        sku,
        outcome: "already_sold",
        ...(winner ? { soldChannel: winner.platform } : {}),
        requiresRefund: true,
        ended: [],
        failed: [],
        elapsedMs: 0,
        halted: false,
      };
    }

    const active = this.registry.activeListings(sku);
    const others = active.filter((l) => !(l.platform === soldChannel && l.externalId === soldExternalId));
    // The channel it sold on is no longer active inventory.
    for (const l of active) if (l.platform === soldChannel && l.externalId === soldExternalId) l.state = "ended";

    if (others.length === 0) {
      return { sku, outcome: "delisted", soldChannel, requiresRefund: false, ended: [], failed: [], elapsedMs: 0, halted: false };
    }

    const start = this.clock.now();
    const outcomes = await Promise.all(others.map((l) => this.#endOne(sku, l)));
    const elapsedMs = this.clock.now() - start;

    const ended = outcomes.filter((o) => o.status === "ended");
    const failed = outcomes.filter((o) => o.status === "failed");
    return { sku, outcome: "delisted", soldChannel, requiresRefund: false, ended, failed, elapsedMs, halted: failed.length > 0 };
  }

  #endOne(sku: string, listing: ChannelListing): Promise<ChannelDelistOutcome> {
    const key = `end:${sku}:${listing.platform}:${listing.externalId}`;
    return this.outbox.once(key, async () => {
      const publisher = this.publishers.get(listing.platform);
      if (!publisher) {
        listing.state = "end_failed";
        this.onHalt?.({ sku, platform: listing.platform, externalId: listing.externalId, reason: "no_publisher" });
        return { platform: listing.platform, externalId: listing.externalId, status: "failed", attempts: 0 } as const;
      }
      let attempts = 0;
      let lastReason = "unknown";
      while (attempts < this.retry.maxAttempts) {
        attempts++;
        try {
          await publisher.end(listing.externalId);
          listing.state = "ended";
          return { platform: listing.platform, externalId: listing.externalId, status: "ended", attempts } as const;
        } catch (err) {
          const e = err as DelistError;
          lastReason = e.message || "error";
          if (e.fatal || attempts >= this.retry.maxAttempts) break; // fatal errors are never retried
          await this.clock.delay(this.retry.backoffMs * attempts);
        }
      }
      listing.state = "end_failed";
      this.onHalt?.({ sku, platform: listing.platform, externalId: listing.externalId, reason: lastReason });
      return { platform: listing.platform, externalId: listing.externalId, status: "failed", attempts } as const;
    });
  }
}
