import { describe, expect, test } from "vitest";
import { BoundedChannel, hashKey, ShardRouter } from "../src/index.js";

const tick = () => new Promise<void>((r) => setImmediate(r));

describe("BoundedChannel — backpressure", () => {
  test("a full buffer blocks the producer until a consumer pulls", async () => {
    const ch = new BoundedChannel<number>(2);
    await ch.push(1);
    await ch.push(2);
    expect(ch.size).toBe(2);

    let thirdResolved = false;
    const third = ch.push(3).then(() => {
      thirdResolved = true;
    });
    await tick();
    expect(thirdResolved).toBe(false); // blocked — backpressure engaged
    expect(ch.waitingProducers).toBe(1);

    expect(await ch.pull()).toBe(1); // frees a slot
    await third;
    expect(thirdResolved).toBe(true);
    expect(ch.size).toBe(2); // [2, 3]
  });

  test("tryPush rejects instead of blocking when full", async () => {
    const ch = new BoundedChannel<string>(1);
    expect(ch.tryPush("a")).toBe(true);
    expect(ch.tryPush("b")).toBe(false);
  });

  test("a waiting consumer receives a pushed item directly", async () => {
    const ch = new BoundedChannel<number>(1);
    const pending = ch.pull();
    await ch.push(42);
    expect(await pending).toBe(42);
    expect(ch.size).toBe(0);
  });
});

describe("ShardRouter — blast-radius isolation", () => {
  test("routing is deterministic and one saturated shard doesn't block another", async () => {
    const router = new ShardRouter<string>(4, 2);
    expect(router.shardFor("craigslist")).toBe(router.shardFor("craigslist")); // stable

    // Saturate shard 0 directly.
    await router.shard(0).push("x");
    await router.shard(0).push("y");
    expect(router.shard(0).tryPush("z")).toBe(false); // full

    // A different shard is unaffected.
    expect(router.shard(1).tryPush("ok")).toBe(true);
    expect(router.depths()[0]).toBe(2);
    expect(router.depths()[1]).toBe(1);
  });

  test("hashKey is stable", () => {
    expect(hashKey("ebay")).toBe(hashKey("ebay"));
    expect(hashKey("ebay")).not.toBe(hashKey("mercari"));
  });
});
