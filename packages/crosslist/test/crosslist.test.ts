import { describe, expect, test } from "vitest";
import type { Publisher, PublishInput, PublishResult } from "@flip-desk/core";
import { type Clock, ListingRegistry, VirtualClock } from "@flip-desk/exit";
import { CrosslistSaga, type CrosslistDraft } from "../src/index.js";

class FakePublisher implements Publisher {
  readonly tier = "T0" as const;
  readonly ended: string[] = [];
  published = 0;
  #fails = 0;
  constructor(
    readonly platform: string,
    private readonly clock: Clock,
    private readonly opts: { latencyMs?: number; failTimes?: number; fatal?: boolean } = {},
  ) {}
  async publish(input: PublishInput): Promise<PublishResult> {
    await this.clock.delay(this.opts.latencyMs ?? 300);
    if (this.#fails < (this.opts.failTimes ?? 0)) {
      this.#fails++;
      const e = new Error("publish rejected") as Error & { fatal?: boolean };
      if (this.opts.fatal) e.fatal = true;
      throw e;
    }
    this.published++;
    return { externalId: `${this.platform}:${input.idempotencyKey}` };
  }
  async end(externalId: string): Promise<void> {
    await this.clock.delay(100);
    this.ended.push(externalId);
  }
}

function drafts(): CrosslistDraft[] {
  const base = (platform: string): CrosslistDraft => ({
    platform,
    input: {
      platform,
      title: "Item",
      description: "d",
      priceCents: 10_000n,
      specifics: {},
      photoKeys: [],
      idempotencyKey: `list:SKU1:${platform}`,
    },
  });
  return [base("ebay"), base("mercari"), base("poshmark")];
}

describe("Cross-listing saga", () => {
  test("publishes to all channels and registers each listing", async () => {
    const clock = new VirtualClock();
    const pubs = new Map<string, Publisher>([
      ["ebay", new FakePublisher("ebay", clock, { latencyMs: 400 })],
      ["mercari", new FakePublisher("mercari", clock, { latencyMs: 900 })],
      ["poshmark", new FakePublisher("poshmark", clock, { latencyMs: 600 })],
    ]);
    const registry = new ListingRegistry();
    const saga = new CrosslistSaga({ registry, publishers: pubs, clock });

    const p = saga.publish("SKU1", drafts());
    await clock.drain();
    const res = await p;

    expect(res.published).toHaveLength(3);
    expect(res.failed).toHaveLength(0);
    expect(res.consistent).toBe(true);
    expect(registry.activeListings("SKU1")).toHaveLength(3);
  });

  test("converge mode keeps successes and flags the failed channel", async () => {
    const clock = new VirtualClock();
    const halts: string[] = [];
    const pubs = new Map<string, Publisher>([
      ["ebay", new FakePublisher("ebay", clock)],
      ["mercari", new FakePublisher("mercari", clock, { failTimes: 99 })], // always fails
      ["poshmark", new FakePublisher("poshmark", clock)],
    ]);
    const registry = new ListingRegistry();
    const saga = new CrosslistSaga({ registry, publishers: pubs, clock, retry: { maxAttempts: 3, backoffMs: 2_000 }, onHalt: (e) => halts.push(e.platform) });

    const p = saga.publish("SKU1", drafts());
    await clock.drain();
    const res = await p;

    expect(res.published.map((x) => x.platform).sort()).toEqual(["ebay", "poshmark"]);
    expect(res.failed.map((x) => x.platform)).toEqual(["mercari"]);
    expect(res.consistent).toBe(true);
    expect(res.rolledBack).toBe(false);
    expect(halts).toEqual(["mercari"]);
    expect(registry.activeListings("SKU1")).toHaveLength(2);
  });

  test("all_or_nothing rolls back successes to a consistent unlisted state", async () => {
    const clock = new VirtualClock();
    const ebay = new FakePublisher("ebay", clock);
    const posh = new FakePublisher("poshmark", clock);
    const pubs = new Map<string, Publisher>([
      ["ebay", ebay],
      ["mercari", new FakePublisher("mercari", clock, { failTimes: 99, fatal: true })],
      ["poshmark", posh],
    ]);
    const registry = new ListingRegistry();
    const saga = new CrosslistSaga({ registry, publishers: pubs, clock, mode: "all_or_nothing" });

    const p = saga.publish("SKU1", drafts());
    await clock.drain();
    const res = await p;

    expect(res.rolledBack).toBe(true);
    expect(res.published).toHaveLength(0);
    expect(res.consistent).toBe(true);
    expect(ebay.ended).toHaveLength(1); // the successful publishes were ended
    expect(posh.ended).toHaveLength(1);
    expect(registry.activeListings("SKU1")).toHaveLength(0);
  });

  test("a retry does not double-publish (outbox idempotency)", async () => {
    const clock = new VirtualClock();
    const ebay = new FakePublisher("ebay", clock);
    const registry = new ListingRegistry();
    const saga = new CrosslistSaga({ registry, publishers: new Map<string, Publisher>([["ebay", ebay]]), clock });
    const one = [drafts()[0]!];

    const p1 = saga.publish("SKU1", one);
    await clock.drain();
    await p1;
    const p2 = saga.publish("SKU1", one); // same idempotency key
    await clock.drain();
    await p2;

    expect(ebay.published).toBe(1);
  });
});
