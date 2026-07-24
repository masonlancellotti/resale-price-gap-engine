import { describe, expect, test } from "vitest";
import { KillSwitch, Worker } from "../src/index.js";

async function* range(n: number): AsyncIterable<number> {
  for (let i = 0; i < n; i++) yield i;
}

describe("kill switch halts a worker (Phase 0 gate #3)", () => {
  test("tripping the global switch mid-run stops the worker promptly", async () => {
    const ks = new KillSwitch();
    const worker = new Worker<number>("ingest-noop", ks);
    let count = 0;

    const result = await worker.run(range(1000), () => {
      count++;
      if (count === 3) ks.trip({ kind: "global" }); // an operator hits the big red switch
    });

    expect(result.halted).toBe(true);
    expect(result.processed).toBe(3);
    expect(count).toBe(3); // items 4..999 were never touched
  });

  test("a switch tripped before the run halts immediately (0 processed)", async () => {
    const ks = new KillSwitch();
    ks.trip({ kind: "global" });
    const worker = new Worker<number>("w", ks);
    const result = await worker.run(range(5), () => {});
    expect(result).toEqual({ processed: 0, halted: true });
  });

  test("scope isolation: an unrelated source does not halt; the worker's own source does", async () => {
    const ks = new KillSwitch();
    const worker = new Worker<number>("ebay-ingest", ks, { source: "ebay" });

    ks.trip({ kind: "source", code: "craigslist" });
    const r1 = await worker.run(range(5), () => {});
    expect(r1).toEqual({ processed: 5, halted: false });

    ks.trip({ kind: "source", code: "ebay" });
    const r2 = await worker.run(range(5), () => {});
    expect(r2.halted).toBe(true);
    expect(r2.processed).toBe(0);
  });

  test("reset re-enables a previously halted scope", async () => {
    const ks = new KillSwitch();
    ks.trip({ kind: "source", code: "ebay" });
    ks.reset({ kind: "source", code: "ebay" });
    const worker = new Worker<number>("ebay-ingest", ks, { source: "ebay" });
    const result = await worker.run(range(4), () => {});
    expect(result).toEqual({ processed: 4, halted: false });
  });

  test("global switch halts every scope at once", () => {
    const ks = new KillSwitch();
    expect(ks.isHalted({ source: "ebay" })).toBe(false);
    ks.trip({ kind: "global" });
    expect(ks.isHalted({ source: "ebay" })).toBe(true);
    expect(ks.isHalted({ platform: "poshmark" })).toBe(true);
    expect(ks.isHalted({ agent: "negotiator" })).toBe(true);
    expect(ks.isHalted()).toBe(true);
  });
});
