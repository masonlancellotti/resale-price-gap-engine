import { describe, expect, test } from "vitest";
import type { Publisher, PublishInput, PublishResult } from "@flip-desk/core";
import { type Clock, DelistSaga, type HaltEvent, ListingRegistry, Outbox, VirtualClock } from "../src/index.js";

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class FakePublisher implements Publisher {
  readonly tier = "T0" as const;
  readonly ended: string[] = [];
  #fails = 0;
  constructor(
    readonly platform: string,
    private readonly clock: Clock,
    private readonly opts: { latencyMs?: number; failTimes?: number; fatal?: boolean } = {},
  ) {}
  async publish(input: PublishInput): Promise<PublishResult> {
    return { externalId: `${this.platform}:${input.idempotencyKey}` };
  }
  async end(externalId: string): Promise<void> {
    await this.clock.delay(this.opts.latencyMs ?? 500);
    if (this.#fails < (this.opts.failTimes ?? 0)) {
      this.#fails++;
      const e = new Error("transient carrier error") as Error & { fatal?: boolean };
      if (this.opts.fatal) e.fatal = true;
      throw e;
    }
    this.ended.push(externalId);
  }
}

function setup(channels: Array<{ platform: string; pub: FakePublisher }>, extra?: Partial<ConstructorParameters<typeof DelistSaga>[0]>) {
  const registry = new ListingRegistry();
  const publishers = new Map(channels.map((c) => [c.platform, c.pub]));
  for (const c of channels) registry.publish("SKU1", c.platform, `${c.platform}-ext`);
  const halts: HaltEvent[] = [];
  const saga = new DelistSaga({ registry, publishers, onHalt: (e) => halts.push(e), ...extra });
  return { registry, saga, halts };
}

describe("Delist saga — happy path", () => {
  test("selling on one channel ends all the others within the elapsed critical path", async () => {
    const clock = new VirtualClock();
    const ebay = new FakePublisher("ebay", clock, { latencyMs: 500 });
    const mercari = new FakePublisher("mercari", clock, { latencyMs: 1200 });
    const posh = new FakePublisher("poshmark", clock, { latencyMs: 800 });
    const { saga, registry } = setup(
      [{ platform: "ebay", pub: ebay }, { platform: "mercari", pub: mercari }, { platform: "poshmark", pub: posh }],
      { clock },
    );

    const p = saga.onSale("SKU1", "ebay", "ebay-ext");
    await clock.drain();
    const res = await p;

    expect(res.outcome).toBe("delisted");
    expect(res.ended.map((o) => o.platform).sort()).toEqual(["mercari", "poshmark"]);
    expect(res.failed).toHaveLength(0);
    expect(res.halted).toBe(false);
    expect(res.elapsedMs).toBe(1200); // concurrent → slowest channel, not the sum
    expect(mercari.ended).toHaveLength(1);
    expect(ebay.ended).toHaveLength(0); // sold, not ended via API
    expect(registry.activeListings("SKU1")).toHaveLength(0);
  });
});

describe("Delist saga — oversell guard", () => {
  test("two simultaneous sales: exactly one wins, the other refunds, item ships once", async () => {
    const clock = new VirtualClock();
    const ebay = new FakePublisher("ebay", clock, { latencyMs: 400 });
    const mercari = new FakePublisher("mercari", clock, { latencyMs: 400 });
    const { saga } = setup([{ platform: "ebay", pub: ebay }, { platform: "mercari", pub: mercari }], { clock });

    const pA = saga.onSale("SKU1", "ebay", "ebay-ext");
    const pB = saga.onSale("SKU1", "mercari", "mercari-ext");
    await clock.drain();
    const [a, b] = await Promise.all([pA, pB]);

    const outcomes = [a.outcome, b.outcome].sort();
    expect(outcomes).toEqual(["already_sold", "delisted"]);
    const loser = a.outcome === "already_sold" ? a : b;
    expect(loser.requiresRefund).toBe(true);
    // winner was ebay (claimed first); it delists mercari exactly once, nothing double-sells
    expect(a.outcome).toBe("delisted");
    expect(mercari.ended).toHaveLength(1);
    expect(ebay.ended).toHaveLength(0);
  });
});

describe("Delist saga — compensation & P7 halt", () => {
  test("a channel that won't end is flagged end_failed and halts, others still delist", async () => {
    const clock = new VirtualClock();
    const ebay = new FakePublisher("ebay", clock, { latencyMs: 300 });
    const mercari = new FakePublisher("mercari", clock, { latencyMs: 300, failTimes: 99 }); // never succeeds
    const posh = new FakePublisher("poshmark", clock, { latencyMs: 300 });
    const { saga, registry, halts } = setup(
      [{ platform: "ebay", pub: ebay }, { platform: "mercari", pub: mercari }, { platform: "poshmark", pub: posh }],
      { clock, retry: { maxAttempts: 3, backoffMs: 3_000 } },
    );

    const p = saga.onSale("SKU1", "ebay", "ebay-ext");
    await clock.drain();
    const res = await p;

    expect(res.halted).toBe(true);
    expect(res.failed.map((o) => o.platform)).toEqual(["mercari"]);
    expect(res.failed[0]?.attempts).toBe(3);
    expect(res.ended.map((o) => o.platform)).toEqual(["poshmark"]);
    expect(halts).toHaveLength(1);
    expect(halts[0]?.platform).toBe("mercari");
    expect(registry.listings("SKU1").find((l) => l.platform === "mercari")?.state).toBe("end_failed");
  });

  test("fatal errors are not retried", async () => {
    const clock = new VirtualClock();
    const ebay = new FakePublisher("ebay", clock, { latencyMs: 100 });
    const mercari = new FakePublisher("mercari", clock, { latencyMs: 100, failTimes: 99, fatal: true });
    const { saga } = setup([{ platform: "ebay", pub: ebay }, { platform: "mercari", pub: mercari }], { clock });

    const p = saga.onSale("SKU1", "ebay", "ebay-ext");
    await clock.drain();
    const res = await p;
    expect(res.failed[0]?.attempts).toBe(1); // one shot, no retries
  });
});

describe("Delist saga — exactly-once", () => {
  test("a duplicate sale event does not re-end a channel", async () => {
    const clock = new VirtualClock();
    const ebay = new FakePublisher("ebay", clock, { latencyMs: 200 });
    const mercari = new FakePublisher("mercari", clock, { latencyMs: 200 });
    const outbox = new Outbox();
    const { saga } = setup([{ platform: "ebay", pub: ebay }, { platform: "mercari", pub: mercari }], { clock, outbox });

    const p1 = saga.onSale("SKU1", "ebay", "ebay-ext");
    await clock.drain();
    await p1;
    const p2 = saga.onSale("SKU1", "ebay", "ebay-ext"); // duplicate event
    await clock.drain();
    const res2 = await p2;

    expect(res2.outcome).toBe("delisted");
    expect(mercari.ended).toHaveLength(1); // NOT ended twice
  });
});

describe("Delist saga — timing under faults (gate: p99 < 60s)", () => {
  test("p99 delist completion stays well under 60s across 200 faulty trials", async () => {
    const rng = mulberry32(42);
    const platforms = ["ebay", "mercari", "poshmark", "reverb"];
    const elapsed: number[] = [];

    for (let trial = 0; trial < 200; trial++) {
      const clock = new VirtualClock();
      const faultyIdx = 1 + Math.floor(rng() * 3); // one of the delisted channels fails once
      const channels = platforms.map((platform, idx) => ({
        platform,
        pub: new FakePublisher(platform, clock, {
          latencyMs: 200 + Math.floor(rng() * 5_800), // 0.2s–6s
          failTimes: idx === faultyIdx ? 1 : 0,
        }),
      }));
      const { saga } = setup(channels, { clock, retry: { maxAttempts: 3, backoffMs: 3_000 } });

      const p = saga.onSale("SKU1", "ebay", "ebay-ext");
      await clock.drain();
      const res = await p;
      expect(res.halted).toBe(false); // one transient failure recovers on retry
      elapsed.push(res.elapsedMs);
    }

    elapsed.sort((a, b) => a - b);
    const p99 = elapsed[Math.floor(0.99 * elapsed.length)]!;
    const max = elapsed[elapsed.length - 1]!;
    expect(p99).toBeLessThan(60_000);
    expect(max).toBeLessThan(60_000);
  }, 30_000);
});
