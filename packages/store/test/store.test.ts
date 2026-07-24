import { describe, expect, test } from "vitest";
import { InMemoryStore, type InventoryRecord, type OpportunityRecord } from "../src/index.js";

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

describe("InMemoryStore — opportunities", () => {
  test("feed is ordered push → feed → digest, then by score", async () => {
    const s = new InMemoryStore();
    await s.putOpportunity(opp({ id: "a", band: "feed", score: 72 }));
    await s.putOpportunity(opp({ id: "b", band: "push", score: 90 }));
    await s.putOpportunity(opp({ id: "c", band: "feed", score: 80 }));
    const feed = await s.listOpportunities();
    expect(feed.map((o) => o.id)).toEqual(["b", "c", "a"]);
  });

  test("filters by status and taken", async () => {
    const s = new InMemoryStore();
    await s.putOpportunity(opp({ id: "a", taken: true, status: "new" }));
    await s.putOpportunity(opp({ id: "b", taken: false, status: "rejected" }));
    expect((await s.listOpportunities({ takenOnly: true })).map((o) => o.id)).toEqual(["a"]);
    expect((await s.listOpportunities({ status: "rejected" })).map((o) => o.id)).toEqual(["b"]);
  });

  test("status transitions persist", async () => {
    const s = new InMemoryStore();
    await s.putOpportunity(opp({ id: "a" }));
    await s.setOpportunityStatus("a", "approved");
    expect((await s.getOpportunity("a"))?.status).toBe("approved");
    expect(await s.setOpportunityStatus("missing", "approved")).toBeUndefined();
  });
});

describe("InMemoryStore — inventory / pnl / health", () => {
  test("inventory patch merges fields", async () => {
    const s = new InMemoryStore();
    await s.putInventory(inv());
    await s.patchInventory("FD-2026-00001", { status: "listed", listedPriceCents: 13_000n });
    const rec = await s.getInventory("FD-2026-00001");
    expect(rec?.status).toBe("listed");
    expect(rec?.listedPriceCents).toBe(13_000n);
    expect(rec?.costBasisCents).toBe(6_000n); // preserved
  });

  test("pnl defaults to zero and round-trips", async () => {
    const s = new InMemoryStore();
    expect((await s.getPnl()).netProfitCents).toBe(0n);
    await s.setPnl({ revenueCents: 13_800n, cogsCents: 6_000n, feesCents: 1_900n, netProfitCents: 4_900n, inventoryValueCents: 0n, flips: 1 });
    expect((await s.getPnl()).netProfitCents).toBe(4_900n);
  });

  test("health is keyed by source, newest write wins", async () => {
    const s = new InMemoryStore();
    await s.putHealth({ source: "ebay", tier: "T0", state: "ok" });
    await s.putHealth({ source: "ebay", tier: "T0", state: "halted", note: "429" });
    const health = await s.listHealth();
    expect(health).toHaveLength(1);
    expect(health[0]?.state).toBe("halted");
  });
});
