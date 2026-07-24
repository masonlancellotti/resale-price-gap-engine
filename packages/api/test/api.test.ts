import { describe, expect, test } from "vitest";
import { InMemoryStore } from "@flip-desk/store";
import { Desk, seedDemo } from "../src/index.js";

async function seeded(): Promise<Desk> {
  const store = new InMemoryStore();
  await seedDemo(store);
  return new Desk(store);
}

describe("Desk API over the demo seed", () => {
  test("feed is populated, triage-ordered, and identified", async () => {
    const desk = await seeded();
    const feed = await desk.feed();
    expect(feed.length).toBeGreaterThan(8);
    expect(feed.every((o) => o.identified)).toBe(true);
    // push/feed sort ahead of digest/archive
    const bands = feed.map((o) => o.band);
    const firstArchive = bands.indexOf("archive");
    const lastFeed = bands.lastIndexOf("feed");
    if (firstArchive !== -1 && lastFeed !== -1) expect(lastFeed).toBeLessThan(firstArchive);
  });

  test("money crosses the edge as exact cents + display string", async () => {
    const desk = await seeded();
    const taken = (await desk.feed({ takenOnly: true }))[0]!;
    expect(taken.netP50?.cents).toMatch(/^\d+$/);
    expect(taken.netP50?.display).toMatch(/^\$/);
    expect(taken.waterfall?.length ?? 0).toBeGreaterThan(0);
  });

  test("approve / reject move an opportunity through its lifecycle", async () => {
    const desk = await seeded();
    const first = (await desk.feed({ takenOnly: true }))[0]!;
    const approved = await desk.approve(first.id);
    expect(approved?.status).toBe("approved");
    expect((await desk.opportunity(first.id))?.status).toBe("approved");
    expect(await desk.reject("nope")).toBeUndefined();
  });

  test("inventory, P&L, alerts, health are all seeded for the UI", async () => {
    const desk = await seeded();
    expect((await desk.inventory()).length).toBeGreaterThan(0);
    expect((await desk.pnl()).netProfit.display).toMatch(/^-?\$/);
    expect((await desk.alerts()).length).toBeGreaterThan(0);
    const health = await desk.health();
    expect(health.find((h) => h.source === "fb_mkt")?.state).toBe("halted"); // T4 default-off
    expect(health.find((h) => h.source === "ebay")?.state).toBe("ok");
  });

  test("summary aggregates counts", async () => {
    const desk = await seeded();
    const s = await desk.summary({ llm: "fake", http: "fake" });
    expect(s.newCount).toBeGreaterThan(0);
    expect(s.inventoryCount).toBeGreaterThan(0);
    expect(s.llmMode).toBe("fake");
  });
});
