import { ebayNormalizer } from "@flip-desk/adapter-ebay";
import type { Comp, Product, RawListing } from "@flip-desk/core";
import { CollectingNotifier, Engine, type OpportunityResult } from "@flip-desk/engine";
import { HashingEmbedder, Identifier } from "@flip-desk/identify";
import { FakeLlm, type LlmRequest } from "@flip-desk/llm";
import { IngestPipeline, ListingStore } from "@flip-desk/pipeline";
import { CompRouter, TerapeakCache, TerapeakCacheProvider } from "@flip-desk/providers";
import type { InventoryRecord, OpportunityRecord, Store } from "@flip-desk/store";

/**
 * Demo seeding (plan §16 "paper-trading mode"). Runs the real pipeline over a deterministic corpus so
 * the desk has believable data with no live sources, no DB, and no keys — the same engine the live
 * system uses, just fed a fixture. This is what makes the UI explorable out of the box.
 */
const AS_OF = "2026-07-04T12:00:00.000Z";
const DAY = 86_400_000;
const TITLES = [
  "Chrono Trigger",
  "EarthBound (SNES)",
  "Panzer Dragoon Saga",
  "Metal Gear Solid PS1",
  "Pokémon Emerald",
  "Xenoblade Chronicles Wii",
  "Fire Emblem Path of Radiance",
  "Suikoden II PS1",
  "Conker's Bad Fur Day N64",
  "Radiant Silvergun Saturn",
  "Mega Man X3 SNES",
  "Skies of Arcadia DC",
];

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

function fakeLlm(req: LlmRequest): object {
  if (req.model === "sonnet") return { chosen: null, reason: "no match" };
  const d = (req.data ?? "").toLowerCase();
  const m = /\bm\d+\b/.exec(d);
  return {
    brand: "Retro",
    model: m ? m[0].toUpperCase() : null,
    mpn: m ? m[0].toUpperCase() : null,
    upc: null,
    variant: {},
    conditionClaim: d.includes("good") ? "good" : "unknown",
    defects: [],
    bundleItems: [],
    redFlags: [],
    confidence: 0.8,
  };
}

function buildDemo() {
  const rng = mulberry32(99);
  const products: Array<{ product: Product; text: string }> = [];
  const cache = new TerapeakCache();
  const raws: RawListing[] = [];

  TITLES.forEach((title, idx) => {
    const i = idx + 1;
    const trueValue = 8_000 + Math.round(rng() * 28_000); // $80–$360
    products.push({
      product: { id: i, canonicalKey: `mpn:M${i}`, categoryId: 1, brand: "Retro", model: `M${i}`, variant: {}, identifiers: { mpn: `M${i}` }, title },
      text: `${title} M${i}`,
    });
    const comps: Comp[] = Array.from({ length: 13 }, (_, j) => ({
      productId: i,
      provider: "terapeak",
      conditionBand: "good" as const,
      priceCents: BigInt(Math.round(trueValue * (0.9 + 0.2 * rng()))),
      soldAt: new Date(Date.parse(AS_OF) - (1 + Math.floor(rng() * 25)) * DAY).toISOString().slice(0, 10),
      sellerKey: `s${i}-${j}`,
    }));
    cache.put(i, comps);

    const ratio = i <= 3 ? 0.28 + rng() * 0.07 : i <= 7 ? 0.42 + rng() * 0.13 : 0.85 + rng() * 0.1; // steals, deals, fair
    const ask = Math.round(trueValue * ratio);
    raws.push({
      sourceCode: "ebay",
      externalId: `e${i}`,
      channel: "api",
      fetchedAt: AS_OF,
      url: `https://ebay.example/itm/${i}`,
      payload: { itemId: `e${i}`, title: `${title} M${i} good condition`, price: { value: (ask / 100).toFixed(2), currency: "USD" }, condition: "Used" },
    });
  });

  const store = new ListingStore();
  const pipeline = new IngestPipeline(store).register(ebayNormalizer);
  const identifier = new Identifier(
    { llm: new FakeLlm(fakeLlm), embedder: new HashingEmbedder(64), products },
    { filter: { minPriceCents: 100n, maxPriceCents: 5_000_00n } },
  );
  const engine = new Engine(
    { pipeline, identifier, compRouter: new CompRouter([new TerapeakCacheProvider(cache)]), notifier: new CollectingNotifier(), now: () => new Date(AS_OF) },
    { activeCount: 6 },
  );
  return { engine, raws };
}

function toRecord(opp: OpportunityResult, raw: RawListing, i: number): OpportunityRecord {
  const title = (raw.payload as { title?: string }).title ?? opp.listingExternalId;
  return {
    id: `opp-${i}`,
    createdAt: AS_OF,
    listingExternalId: opp.listingExternalId,
    source: raw.sourceCode,
    title: title.replace(/ M\d+ good condition$/, ""),
    ...(opp.productId !== undefined ? { productId: opp.productId } : {}),
    ...(opp.valuationP50Cents !== undefined ? { valuationP50Cents: opp.valuationP50Cents } : {}),
    ...(opp.valuationP10Cents !== undefined ? { valuationP10Cents: opp.valuationP10Cents } : {}),
    ...(opp.valuationP90Cents !== undefined ? { valuationP90Cents: opp.valuationP90Cents } : {}),
    ...(opp.netP50Cents !== undefined ? { netP50Cents: opp.netP50Cents } : {}),
    ...(opp.cashAtRiskCents !== undefined ? { cashAtRiskCents: opp.cashAtRiskCents } : {}),
    ...(opp.roi !== undefined ? { roi: opp.roi } : {}),
    ...(opp.score !== undefined ? { score: opp.score } : {}),
    ...(opp.band !== undefined ? { band: opp.band } : {}),
    taken: opp.taken,
    identified: opp.identified,
    riskFlags: opp.riskFlags,
    ...(opp.waterfall ? { waterfall: opp.waterfall.map((w) => ({ label: w.label, amountCents: w.amountCents })) } : {}),
    status: "new",
  };
}

export async function seedDemo(target: Store): Promise<void> {
  const { engine, raws } = buildDemo();
  let i = 0;
  const records: OpportunityRecord[] = [];
  for (const raw of raws) {
    const opp = await engine.underwriteRaw(raw);
    const rec = toRecord(opp, raw, ++i);
    records.push(rec);
    await target.putOpportunity(rec);
    // Every non-archive band raises an alert on its channel (push → push, feed → feed, digest → daily digest).
    if (rec.band && rec.band !== "archive") {
      await target.putAlert({
        id: `al-${i}`,
        createdAt: AS_OF,
        band: rec.band,
        channel: rec.band,
        title: rec.title,
        opportunityId: rec.id,
      });
    }
  }

  // A few inventory items at different lifecycle stages, plus a booked P&L snapshot.
  const taken = records.filter((r) => r.taken).slice(0, 4);
  const stages: InventoryRecord["status"][] = ["sold", "listed", "received", "listed"];
  for (let idx = 0; idx < taken.length; idx++) {
    const r = taken[idx]!;
    const stage = stages[idx] ?? "received";
    const cost = r.cashAtRiskCents ?? 4_000n;
    const list = r.valuationP50Cents ?? cost * 2n;
    const inv: InventoryRecord = {
      sku: `FD-2026-${String(idx + 1).padStart(5, "0")}`,
      title: r.title,
      conditionBand: "good",
      costBasisCents: cost,
      bin: `A-${String(idx + 1).padStart(2, "0")}`,
      status: stage,
      ...(stage !== "received" ? { listedPriceCents: list } : {}),
      ...(stage === "sold" ? { soldPriceCents: (list * 95n) / 100n } : {}),
      channels: stage === "received" ? [] : [{ platform: "ebay", externalId: `off-${idx}`, state: stage === "sold" ? "ended" : "active" }],
      receivedAt: AS_OF,
    };
    await target.putInventory(inv);
  }

  const soldInv = taken[0];
  const revenue = soldInv?.valuationP50Cents ? (soldInv.valuationP50Cents * 95n) / 100n : 0n;
  const cogs = soldInv?.cashAtRiskCents ?? 0n;
  const fees = (revenue * 1660n) / 10_000n;
  await target.setPnl({
    revenueCents: revenue,
    cogsCents: cogs,
    feesCents: fees,
    netProfitCents: revenue - cogs - fees,
    inventoryValueCents: taken.slice(1).reduce((s, r) => s + (r.cashAtRiskCents ?? 0n), 0n),
    flips: 1,
  });

  for (const [source, tier] of [["ebay", "T0"], ["terapeak", "T1"], ["email", "T2"], ["shopgoodwill", "T2"]] as const) {
    await target.putHealth({ source, tier, state: "ok", lastPollAt: AS_OF });
  }
  await target.putHealth({ source: "fb_mkt", tier: "T4", state: "halted", note: "default-off (opt-in ceremony not signed)" });
}
