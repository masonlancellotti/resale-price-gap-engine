import type { Publisher, PublishInput } from "@flip-desk/core";
import { type Clock, DEFAULT_RETRY, type HaltEvent, ListingRegistry, Outbox, type RetryPolicy, SystemClock } from "@flip-desk/exit";

/**
 * Cross-listing engine (plan §8.7). Publishes one inventory item to N exit channels at once — every
 * `listing_out` row that later feeds the delist saga. Two compensation modes for partial failure
 * (plan §10.4 sagas): `converge` keeps what published and flags the rest (a partial cross-list still
 * sells), `all_or_nothing` rolls back the successes so the item lands in a consistent unlisted state.
 * Publishes go through the outbox so a retry never double-lists. Buy-vs-build note: for API-less
 * platforms, buy a cross-lister SaaS first (plan recommends Vendoo) — this engine owns the API ones.
 */
export interface CrosslistDraft {
  readonly platform: string;
  readonly input: PublishInput;
}

export type CompensationMode = "converge" | "all_or_nothing";

export interface CrosslistDeps {
  readonly registry: ListingRegistry;
  readonly publishers: ReadonlyMap<string, Publisher>;
  readonly outbox?: Outbox;
  readonly clock?: Clock;
  readonly retry?: RetryPolicy;
  readonly mode?: CompensationMode;
  readonly onHalt?: (e: HaltEvent) => void;
}

export interface PublishedChannel {
  readonly platform: string;
  readonly externalId: string;
}
export interface FailedChannel {
  readonly platform: string;
  readonly reason: string;
}

export interface CrosslistResult {
  readonly sku: string;
  readonly published: readonly PublishedChannel[];
  readonly failed: readonly FailedChannel[];
  readonly rolledBack: boolean;
  /** True when the item is in a consistent state (either a coherent partial, or fully rolled back). */
  readonly consistent: boolean;
  readonly halted: boolean;
}

interface Attempt {
  ok: boolean;
  platform: string;
  externalId?: string;
  reason?: string;
}

export class CrosslistSaga {
  private readonly registry: ListingRegistry;
  private readonly publishers: ReadonlyMap<string, Publisher>;
  private readonly outbox: Outbox;
  private readonly clock: Clock;
  private readonly retry: RetryPolicy;
  private readonly mode: CompensationMode;
  private readonly onHalt: ((e: HaltEvent) => void) | undefined;

  constructor(deps: CrosslistDeps) {
    this.registry = deps.registry;
    this.publishers = deps.publishers;
    this.outbox = deps.outbox ?? new Outbox();
    this.clock = deps.clock ?? new SystemClock();
    this.retry = deps.retry ?? DEFAULT_RETRY;
    this.mode = deps.mode ?? "converge";
    this.onHalt = deps.onHalt;
  }

  async publish(sku: string, drafts: readonly CrosslistDraft[]): Promise<CrosslistResult> {
    const attempts = await Promise.all(drafts.map((d) => this.#publishOne(sku, d)));
    const published = attempts.filter((a): a is Attempt & { externalId: string } => a.ok);
    const failed = attempts.filter((a) => !a.ok);

    let rolledBack = false;
    let halted = failed.length > 0;

    if (this.mode === "all_or_nothing" && failed.length > 0 && published.length > 0) {
      // Roll back to a consistent unlisted state.
      for (const p of published) await this.#rollback(sku, p.platform, p.externalId);
      rolledBack = true;
      for (const f of failed) this.onHalt?.({ sku, platform: f.platform, externalId: "", reason: f.reason ?? "publish_failed" });
      return {
        sku,
        published: [],
        failed: failed.map((f) => ({ platform: f.platform, reason: f.reason ?? "publish_failed" })),
        rolledBack: true,
        consistent: true, // nothing is listed anywhere
        halted: true,
      };
    }

    // Converge: keep what published, flag the rest for a human.
    for (const f of failed) this.onHalt?.({ sku, platform: f.platform, externalId: "", reason: f.reason ?? "publish_failed" });

    return {
      sku,
      published: published.map((p) => ({ platform: p.platform, externalId: p.externalId })),
      failed: failed.map((f) => ({ platform: f.platform, reason: f.reason ?? "publish_failed" })),
      rolledBack,
      consistent: true, // a coherent partial cross-list
      halted,
    };
  }

  #publishOne(sku: string, draft: CrosslistDraft): Promise<Attempt> {
    const key = `publish:${sku}:${draft.platform}:${draft.input.idempotencyKey}`;
    return this.outbox.once(key, async () => {
      const publisher = this.publishers.get(draft.platform);
      if (!publisher) return { ok: false, platform: draft.platform, reason: "no_publisher" };
      let attempts = 0;
      let reason = "unknown";
      while (attempts < this.retry.maxAttempts) {
        attempts++;
        try {
          const res = await publisher.publish(draft.input);
          this.registry.publish(sku, draft.platform, res.externalId);
          return { ok: true, platform: draft.platform, externalId: res.externalId };
        } catch (err) {
          const e = err as Error & { fatal?: boolean };
          reason = e.message || "error";
          if (e.fatal || attempts >= this.retry.maxAttempts) break;
          await this.clock.delay(this.retry.backoffMs * attempts);
        }
      }
      return { ok: false, platform: draft.platform, reason };
    });
  }

  async #rollback(sku: string, platform: string, externalId: string): Promise<void> {
    const publisher = this.publishers.get(platform);
    if (!publisher) return;
    try {
      await this.outbox.once(`end:${sku}:${platform}:${externalId}`, async () => {
        await publisher.end(externalId);
        return true;
      });
      const row = this.registry.listings(sku).find((l) => l.platform === platform);
      if (row) row.state = "ended";
    } catch (err) {
      // Rollback itself failed → genuine inconsistency: halt for a human (P7).
      this.onHalt?.({ sku, platform, externalId, reason: `rollback_failed:${(err as Error).message}` });
    }
  }
}
