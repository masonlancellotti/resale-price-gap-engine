#!/usr/bin/env tsx
/**
 * FLIP DESK throughput bench (V2 WS4).
 *
 *   npm run bench            # 10,000 listings, default
 *   npm run bench -- 20000   # custom count
 *
 * Measures the REAL ingest → identify → appraise → underwrite → rank pipeline over a stream of
 * synthetic listings, and the write throughput of each Store implementation. Numbers are wall-clock on
 * this machine — the README "Performance" section quotes them with the hardware.
 */
import { cpus, totalmem } from "node:os";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ebayNormalizer } from "@flip-desk/adapter-ebay";
import type { Comp, Product, RawListing } from "@flip-desk/core";
import { CollectingNotifier, Engine, type OpportunityResult } from "@flip-desk/engine";
import { HashingEmbedder, Identifier } from "@flip-desk/identify";
import { FakeLlm, type LlmRequest } from "@flip-desk/llm";
import { IngestPipeline, ListingStore } from "@flip-desk/pipeline";
import { CompRouter, TerapeakCache, TerapeakCacheProvider } from "@flip-desk/providers";
import { InMemoryStore, type OpportunityRecord, type Store } from "@flip-desk/store";
import { SqliteStore } from "@flip-desk/store/sqlite";

const CATALOG = 500; // distinct products the listings resolve against
const AS_OF = "2026-01-05T12:00:00.000Z";
const DAY = 86_400_000;

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
  return { brand: "Retro", model: m ? m[0].toUpperCase() : null, mpn: m ? m[0].toUpperCase() : null, upc: null, variant: {}, conditionClaim: "good", defects: [], bundleItems: [], redFlags: [], confidence: 0.8 };
}

function buildEngine(count: number): { engine: Engine; raws: RawListing[] } {
  const rng = mulberry32(42);
  const products: Array<{ product: Product; text: string }> = [];
  const cache = new TerapeakCache();
  for (let i = 1; i <= CATALOG; i++) {
    const trueValue = 5_000 + Math.round(rng() * 35_000);
    products.push({ product: { id: i, canonicalKey: `mpn:M${i}`, categoryId: 1, brand: "Retro", model: `M${i}`, variant: {}, identifiers: { mpn: `M${i}` }, title: `Item M${i}` }, text: `Item M${i}` });
    const comps: Comp[] = Array.from({ length: 13 }, (_, j) => ({
      productId: i,
      provider: "terapeak",
      conditionBand: "good" as const,
      priceCents: BigInt(Math.round(trueValue * (0.9 + 0.2 * rng()))),
      soldAt: new Date(Date.parse(AS_OF) - (1 + Math.floor(rng() * 25)) * DAY).toISOString().slice(0, 10),
      sellerKey: `s${i}-${j}`,
    }));
    cache.put(i, comps);
  }

  const raws: RawListing[] = [];
  for (let n = 1; n <= count; n++) {
    const p = 1 + Math.floor(rng() * CATALOG);
    const trueValue = 5_000 + Math.round(rng() * 35_000);
    const ratio = rng() < 0.4 ? 0.4 + rng() * 0.35 : 0.9 + rng() * 0.2;
    const ask = Math.max(100, Math.round(trueValue * ratio));
    raws.push({ sourceCode: "ebay", externalId: `e${n}`, channel: "api", fetchedAt: AS_OF, url: `https://ebay.example/itm/${n}`, payload: { itemId: `e${n}`, title: `Item M${p} good condition`, price: { value: (ask / 100).toFixed(2), currency: "USD" }, condition: "Used" } });
  }

  const store = new ListingStore();
  const pipeline = new IngestPipeline(store).register(ebayNormalizer);
  const identifier = new Identifier({ llm: new FakeLlm(fakeLlm), embedder: new HashingEmbedder(64), products }, { filter: { minPriceCents: 100n, maxPriceCents: 5_000_00n } });
  const engine = new Engine({ pipeline, identifier, compRouter: new CompRouter([new TerapeakCacheProvider(cache)]), notifier: new CollectingNotifier(), now: () => new Date(AS_OF) }, { activeCount: 8 });
  return { engine, raws };
}

function toRecord(o: OpportunityResult, i: number): OpportunityRecord {
  return {
    id: `opp-${i}`,
    createdAt: AS_OF,
    listingExternalId: o.listingExternalId,
    source: "ebay",
    title: o.listingExternalId,
    taken: o.taken,
    identified: o.identified,
    riskFlags: o.riskFlags,
    status: "new",
    ...(o.productId !== undefined ? { productId: o.productId } : {}),
    ...(o.valuationP50Cents !== undefined ? { valuationP50Cents: o.valuationP50Cents } : {}),
    ...(o.netP50Cents !== undefined ? { netP50Cents: o.netP50Cents } : {}),
    ...(o.band !== undefined ? { band: o.band } : {}),
    ...(o.score !== undefined ? { score: o.score } : {}),
  };
}

async function timeRun(label: string, count: number, run: () => Promise<void>): Promise<{ label: string; count: number; ms: number; perSec: number }> {
  const t0 = performance.now();
  await run();
  const ms = performance.now() - t0;
  return { label, count, ms, perSec: (count / ms) * 1000 };
}

async function main(): Promise<void> {
  const count = Number.parseInt(process.argv[2] ?? "10000", 10);
  process.stdout.write(`\nFLIP DESK throughput bench — ${count.toLocaleString()} listings\n`);
  process.stdout.write(`Hardware: ${cpus()[0]?.model?.trim()} · ${(totalmem() / 1e9).toFixed(0)} GB · Node ${process.version}\n\n`);

  const dir = mkdtempSync(join(tmpdir(), "flip-bench-"));
  const results: Array<{ label: string; count: number; ms: number; perSec: number }> = [];

  // 1) Engine only (ingest → rank), no persistence.
  {
    const { engine, raws } = buildEngine(count);
    // warm up JIT
    for (let i = 0; i < 200; i++) await engine.underwriteRaw(raws[i]!);
    results.push(
      await timeRun("engine: ingest→rank (no store)", count, async () => {
        for (const raw of raws) await engine.underwriteRaw(raw);
      }),
    );
  }

  // 2) Engine + persist to each store.
  for (const [label, make] of [
    ["+ InMemoryStore persist", () => new InMemoryStore()],
    ["+ SqliteStore persist (WAL file)", () => new SqliteStore(join(dir, `bench-${Math.random().toString(36).slice(2)}.db`))],
  ] as const) {
    const { engine, raws } = buildEngine(count);
    const store: Store = make();
    results.push(
      await timeRun(label, count, async () => {
        let i = 0;
        for (const raw of raws) {
          const o = await engine.underwriteRaw(raw);
          await store.putOpportunity(toRecord(o, ++i));
        }
      }),
    );
    if (store instanceof SqliteStore) store.close();
  }

  rmSync(dir, { recursive: true, force: true });

  const w = Math.max(...results.map((r) => r.label.length));
  process.stdout.write(`${"pipeline".padEnd(w)}   listings/sec     µs/listing     total ms\n`);
  process.stdout.write(`${"-".repeat(w)}   ------------     ----------     --------\n`);
  for (const r of results) {
    process.stdout.write(
      `${r.label.padEnd(w)}   ${Math.round(r.perSec).toLocaleString().padStart(12)}   ${((r.ms / r.count) * 1000).toFixed(1).padStart(10)}   ${r.ms.toFixed(0).padStart(8)}\n`,
    );
  }
  process.stdout.write("\n");
}

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.stack : String(err)}\n`);
  process.exit(1);
});
