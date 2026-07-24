import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  InMemoryStore,
  type InventoryRecord,
  type OpportunityRecord,
  type Store,
} from "../src/index.js";
import { SqliteStore } from "../src/sqlite.js";

function opp(over: Partial<OpportunityRecord> = {}): OpportunityRecord {
  return {
    id: "opp-1",
    createdAt: "2026-07-04T00:00:00Z",
    listingExternalId: "e1",
    source: "ebay",
    title: "RetroGame One",
    taken: true,
    identified: true,
    riskFlags: [],
    status: "new",
    band: "feed",
    score: 72,
    ...over,
  };
}

function inv(over: Partial<InventoryRecord> = {}): InventoryRecord {
  return {
    sku: "FD-2026-00001",
    title: "RetroGame One",
    costBasisCents: 6_000n,
    bin: "A-01",
    status: "received",
    channels: [],
    receivedAt: "2026-07-04T00:00:00Z",
    ...over,
  };
}

/**
 * ONE contract suite, run against BOTH store implementations (WS1). Anything that passes here is
 * guaranteed identical behaviour across the in-memory map and the SQLite-backed store — the whole
 * point of the async {@link Store} seam.
 */
const factories: Array<{ name: string; make: () => Store; dispose?: (s: Store) => void }> = [
  { name: "InMemoryStore", make: () => new InMemoryStore() },
  {
    name: "SqliteStore(:memory:)",
    make: () => new SqliteStore(":memory:"),
    dispose: (s) => (s as SqliteStore).close(),
  },
];

for (const { name, make, dispose } of factories) {
  describe(`${name} — opportunities`, () => {
    let s: Store;
    beforeEach(() => {
      s = make();
    });
    afterEach(() => dispose?.(s));

    test("feed is ordered push → feed → digest, then by score", async () => {
      await s.putOpportunity(opp({ id: "a", band: "feed", score: 72 }));
      await s.putOpportunity(opp({ id: "b", band: "push", score: 90 }));
      await s.putOpportunity(opp({ id: "c", band: "feed", score: 80 }));
      const feed = await s.listOpportunities();
      expect(feed.map((o) => o.id)).toEqual(["b", "c", "a"]);
    });

    test("filters by status and taken", async () => {
      await s.putOpportunity(opp({ id: "a", taken: true, status: "new" }));
      await s.putOpportunity(opp({ id: "b", taken: false, status: "rejected" }));
      expect((await s.listOpportunities({ takenOnly: true })).map((o) => o.id)).toEqual(["a"]);
      expect((await s.listOpportunities({ status: "rejected" })).map((o) => o.id)).toEqual(["b"]);
    });

    test("status transitions persist", async () => {
      await s.putOpportunity(opp({ id: "a" }));
      await s.setOpportunityStatus("a", "approved");
      expect((await s.getOpportunity("a"))?.status).toBe("approved");
      expect(await s.setOpportunityStatus("missing", "approved")).toBeUndefined();
    });

    test("re-putting an opportunity keeps its feed position (stable tiebreak)", async () => {
      await s.putOpportunity(opp({ id: "a", band: "feed", score: 80 }));
      await s.putOpportunity(opp({ id: "b", band: "feed", score: 80 }));
      await s.putOpportunity(opp({ id: "a", band: "feed", score: 80, title: "updated" }));
      const feed = await s.listOpportunities();
      expect(feed.map((o) => o.id)).toEqual(["a", "b"]);
      expect(feed[0]?.title).toBe("updated");
    });

    test("bigint money + risk flags + waterfall round-trip exactly", async () => {
      await s.putOpportunity(
        opp({
          id: "m",
          valuationP50Cents: 123_456_789n,
          valuationP10Cents: 90_000_000n,
          valuationP90Cents: 150_000_000n,
          netP50Cents: -4_900n,
          cashAtRiskCents: 6_000n,
          roi: 0.42,
          riskFlags: ["thin_comps", "single_provider_comps"],
          waterfall: [
            { label: "Resale P50", amountCents: 123_456_789n },
            { label: "Labor", amountCents: -2_500n },
          ],
        }),
      );
      const r = await s.getOpportunity("m");
      expect(r?.valuationP50Cents).toBe(123_456_789n);
      expect(r?.valuationP10Cents).toBe(90_000_000n);
      expect(r?.netP50Cents).toBe(-4_900n);
      expect(r?.riskFlags).toEqual(["thin_comps", "single_provider_comps"]);
      expect(r?.waterfall).toEqual([
        { label: "Resale P50", amountCents: 123_456_789n },
        { label: "Labor", amountCents: -2_500n },
      ]);
    });
  });

  describe(`${name} — inventory / pnl / health`, () => {
    let s: Store;
    beforeEach(() => {
      s = make();
    });
    afterEach(() => dispose?.(s));

    test("inventory patch merges fields", async () => {
      await s.putInventory(inv());
      await s.patchInventory("FD-2026-00001", { status: "listed", listedPriceCents: 13_000n });
      const rec = await s.getInventory("FD-2026-00001");
      expect(rec?.status).toBe("listed");
      expect(rec?.listedPriceCents).toBe(13_000n);
      expect(rec?.costBasisCents).toBe(6_000n); // preserved
    });

    test("inventory is ordered by receivedAt and channels round-trip", async () => {
      await s.putInventory(inv({ sku: "B", receivedAt: "2026-07-05T00:00:00Z" }));
      await s.putInventory(
        inv({ sku: "A", receivedAt: "2026-07-04T00:00:00Z", channels: [{ platform: "ebay", externalId: "x", state: "active" }] }),
      );
      const list = await s.listInventory();
      expect(list.map((i) => i.sku)).toEqual(["A", "B"]);
      expect(list[0]?.channels).toEqual([{ platform: "ebay", externalId: "x", state: "active" }]);
    });

    test("pnl defaults to zero and round-trips", async () => {
      expect((await s.getPnl()).netProfitCents).toBe(0n);
      await s.setPnl({ revenueCents: 13_800n, cogsCents: 6_000n, feesCents: 1_900n, netProfitCents: 4_900n, inventoryValueCents: 0n, flips: 1 });
      expect((await s.getPnl()).netProfitCents).toBe(4_900n);
    });

    test("alerts are newest-first", async () => {
      await s.putAlert({ id: "1", createdAt: "2026-07-04T00:00:00Z", band: "feed", channel: "feed", title: "A", opportunityId: "o1" });
      await s.putAlert({ id: "2", createdAt: "2026-07-05T00:00:00Z", band: "push", channel: "push", title: "B", opportunityId: "o2" });
      expect((await s.listAlerts()).map((a) => a.id)).toEqual(["2", "1"]);
    });

    test("health is keyed by source, newest write wins", async () => {
      await s.putHealth({ source: "ebay", tier: "T0", state: "ok" });
      await s.putHealth({ source: "ebay", tier: "T0", state: "halted", note: "429" });
      const health = await s.listHealth();
      expect(health).toHaveLength(1);
      expect(health[0]?.state).toBe("halted");
      expect(health[0]?.note).toBe("429");
    });
  });
}

describe("SqliteStore — persistence", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "flip-store-"));
  });
  afterAll(() => {
    // best-effort cleanup of any leftover temp dirs is handled per-test below
  });

  function cleanup(d: string) {
    rmSync(d, { recursive: true, force: true });
  }

  test("survives a restart: a fresh store on the same file reads prior writes", async () => {
    const path = join(dir, "flip.db");
    const s1 = new SqliteStore(path);
    await s1.putOpportunity(opp({ id: "persist-1", valuationP50Cents: 42_000n, band: "push", score: 88 }));
    await s1.putInventory(inv({ sku: "FD-PERSIST", costBasisCents: 7_000n, status: "listed", listedPriceCents: 15_000n }));
    await s1.setPnl({ revenueCents: 15_000n, cogsCents: 7_000n, feesCents: 2_000n, netProfitCents: 6_000n, inventoryValueCents: 0n, flips: 1 });
    s1.close();

    const s2 = new SqliteStore(path);
    const o = await s2.getOpportunity("persist-1");
    expect(o?.valuationP50Cents).toBe(42_000n);
    expect(o?.band).toBe("push");
    expect((await s2.getInventory("FD-PERSIST"))?.listedPriceCents).toBe(15_000n);
    expect((await s2.getPnl()).netProfitCents).toBe(6_000n);
    s2.close();
    cleanup(dir);
  });

  test("migrations are recorded once and re-running is a no-op", async () => {
    const path = join(dir, "flip.db");
    const s1 = new SqliteStore(path);
    const applied = (s1.db.prepare("select name from _migrations").all() as { name: string }[]).map((r) => r.name);
    expect(applied).toContain("0001_init.sql");
    s1.close();

    // Re-opening applies nothing new (the migration is already recorded).
    const s2 = new SqliteStore(path);
    const count = (s2.db.prepare("select count(*) c from _migrations").get() as { c: number }).c;
    expect(count).toBe(applied.length);
    s2.close();
    cleanup(dir);
  });
});
