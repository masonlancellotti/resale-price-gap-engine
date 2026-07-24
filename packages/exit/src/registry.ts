/**
 * Multichannel listing registry (plan §8.7): one inventory item → N `listing_out` rows, one per exit
 * channel (eBay always one of them). The sale claim is a synchronous compare-and-set — the single
 * oversell guard: the first sale event to arrive wins the item; any later event loses and must refund.
 */
export type ListingState = "active" | "ended" | "end_failed";

export interface ChannelListing {
  readonly platform: string;
  readonly externalId: string;
  state: ListingState;
}

export type ClaimOutcome = "won" | "won_replay" | "lost";

export class ListingRegistry {
  readonly #items = new Map<string, ChannelListing[]>();
  readonly #sold = new Map<string, { platform: string; externalId: string }>();

  publish(sku: string, platform: string, externalId: string): void {
    const rows = this.#items.get(sku) ?? [];
    const existing = rows.find((r) => r.platform === platform);
    if (existing) {
      (existing as { externalId: string }).externalId = externalId;
      existing.state = "active";
    } else {
      rows.push({ platform, externalId, state: "active" });
    }
    this.#items.set(sku, rows);
  }

  listings(sku: string): readonly ChannelListing[] {
    return this.#items.get(sku) ?? [];
  }

  activeListings(sku: string): ChannelListing[] {
    return (this.#items.get(sku) ?? []).filter((r) => r.state === "active");
  }

  soldOn(sku: string): { platform: string; externalId: string } | undefined {
    return this.#sold.get(sku);
  }

  /**
   * Atomically claim the sale. MUST be called synchronously (no await) before any delist work so
   * concurrent sale events serialize here. Returns 'won' for the first claimant, 'won_replay' for an
   * idempotent duplicate of the winner, and 'lost' for a competing sale on a different channel.
   */
  claimSale(sku: string, platform: string, externalId: string): ClaimOutcome {
    const prior = this.#sold.get(sku);
    if (!prior) {
      this.#sold.set(sku, { platform, externalId });
      return "won";
    }
    return prior.platform === platform && prior.externalId === externalId ? "won_replay" : "lost";
  }
}
