import { describe, expect, test } from "vitest";
import type { AdapterContext, RawListing } from "@flip-desk/core";
import { NOOP_FIXTURES, NoopAdapter, noopNormalizer } from "@flip-desk/adapter-noop";
import { InMemoryQueue, IngestPipeline, ListingStore } from "../src/index.js";

const quietCtx: AdapterContext = { log: () => {} };

function freshPipe(): { store: ListingStore; pipe: IngestPipeline } {
  const store = new ListingStore();
  const pipe = new IngestPipeline(store).register(noopNormalizer);
  return { store, pipe };
}

describe("raw → listing (Phase 0 gate #2)", () => {
  test("a no-op adapter flows raw payloads into canonical listings", async () => {
    const { store, pipe } = freshPipe();
    const stats = await pipe.runAdapter(new NoopAdapter(), quietCtx);

    expect(stats.seen).toBe(NOOP_FIXTURES.length);
    expect(stats.created).toBe(NOOP_FIXTURES.length);
    expect(stats.failed).toBe(0);
    expect(store.size).toBe(NOOP_FIXTURES.length);

    const drill = store.get("noop", "noop-1");
    expect(drill).toBeDefined();
    expect(drill!.title).toContain("DeWalt");
    expect(drill!.priceCents).toBe(6000n); // "$60.00" parsed exactly to cents — no float
    expect(drill!.status).toBe("active");
    expect(drill!.attrs).toMatchObject({ brand: "DeWalt", model: "DCD996" });
  });

  test("re-ingesting identical payloads dedupes (created=0)", async () => {
    const { store, pipe } = freshPipe();
    await pipe.runAdapter(new NoopAdapter(), quietCtx);
    const second = await pipe.runAdapter(new NoopAdapter(), quietCtx);

    expect(second.created).toBe(0);
    expect(second.deduped).toBe(NOOP_FIXTURES.length);
    expect(store.size).toBe(NOOP_FIXTURES.length);
  });

  test("a changed price updates the listing and records a price event", () => {
    const { store, pipe } = freshPipe();
    const original = NOOP_FIXTURES[0]!;
    pipe.ingest(original);

    const dropped: RawListing = {
      ...original,
      payload: { ...(original.payload as Record<string, unknown>), priceUsd: "50.00" },
    };
    const result = pipe.ingest(dropped);

    expect(result.created).toBe(false);
    expect(result.updated).toBe(true);
    expect(result.listing.priceCents).toBe(5000n);

    const events = store.priceEvents("noop", "noop-1").map((e) => e.priceCents);
    expect(events).toEqual([6000n, 5000n]);
  });

  test("an aborted context stops the adapter immediately (P7 cooperative stop)", async () => {
    const { store, pipe } = freshPipe();
    const controller = new AbortController();
    controller.abort();
    const stats = await pipe.runAdapter(new NoopAdapter(), { signal: controller.signal, log: () => {} });

    expect(stats.seen).toBe(0);
    expect(store.size).toBe(0);
  });

  test("an untrusted payload that fails its schema is quarantined, not fatal", async () => {
    const { store, pipe } = freshPipe();
    const poisoned: RawListing = {
      sourceCode: "noop",
      externalId: "noop-bad",
      channel: "api",
      fetchedAt: "2026-07-04T12:00:00.000Z",
      payload: { title: "", priceUsd: "totally not a price" }, // fails NoopPayload schema
    };
    const adapter = new NoopAdapter([...NOOP_FIXTURES, poisoned]);
    const stats = await pipe.runAdapter(adapter, quietCtx);

    expect(stats.failed).toBe(1);
    expect(stats.created).toBe(NOOP_FIXTURES.length);
    expect(store.get("noop", "noop-bad")).toBeUndefined(); // never entered the store
  });
});

describe("in-memory ingest bus", () => {
  test("drains FIFO and reports count", async () => {
    const q = new InMemoryQueue<number>();
    [1, 2, 3].forEach((n) => q.add(n));
    const out: number[] = [];
    const handled = await q.drain((x) => {
      out.push(x);
    });
    expect(handled).toBe(3);
    expect(out).toEqual([1, 2, 3]);
    expect(q.size).toBe(0);
  });
});
