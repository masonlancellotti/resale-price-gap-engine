import { describe, expect, test } from "vitest";
import type { AdapterContext, Comp, Product, RawListing, SourceAdapter } from "@flip-desk/core";
import { ebayNormalizer } from "@flip-desk/adapter-ebay";
import { FakeLlm, type LlmRequest } from "@flip-desk/llm";
import { HashingEmbedder, Identifier } from "@flip-desk/identify";
import { IngestPipeline, ListingStore } from "@flip-desk/pipeline";
import { CompRouter, TerapeakCache, TerapeakCacheProvider } from "@flip-desk/providers";
import { median } from "@flip-desk/stats";
import { CollectingNotifier, Engine } from "../src/index.js";

// deterministic PRNG so the corpus (and thus the gate) is reproducible
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

const AS_OF = "2026-07-04T00:00:00.000Z";
const DAY = 86_400_000;
const N = 24;

interface CorpusListing {
  raw: RawListing;
  trueValueCents: number;
  underpriced: boolean;
}

function buildCorpus() {
  const rng = mulberry32(42);
  const products: Array<{ product: Product; text: string }> = [];
  const cache = new TerapeakCache();
  const listings: CorpusListing[] = [];
  const labels = new Map<string, number>();

  for (let i = 1; i <= N; i++) {
    const trueValue = 3_000 + Math.round(rng() * 27_000); // $30..$300
    const product: Product = {
      id: i,
      canonicalKey: `mpn:M${i}`,
      categoryId: 1,
      brand: "BrandX",
      model: `M${i}`,
      variant: {},
      identifiers: { mpn: `M${i}` },
      title: `RetroGame ${i}`,
    };
    products.push({ product, text: `RetroGame ${i} M${i}` });

    // ~14 good-condition comps clustered around trueValue + one fat outlier the MAD filter rejects.
    const comps: Comp[] = [];
    for (let j = 0; j < 14; j++) {
      const price = Math.round(trueValue * (0.88 + 0.24 * rng()));
      const daysAgo = 1 + Math.floor(rng() * 29);
      comps.push({
        productId: i,
        provider: "terapeak",
        conditionBand: "good",
        priceCents: BigInt(price),
        soldAt: new Date(Date.parse(AS_OF) - daysAgo * DAY).toISOString().slice(0, 10),
        sellerKey: `p${i}-s${j}`,
      });
    }
    comps.push({ productId: i, provider: "terapeak", conditionBand: "good", priceCents: BigInt(trueValue * 2), soldAt: "2026-06-20", sellerKey: `p${i}-outlier` });
    cache.put(i, comps);

    const underpriced = i % 2 === 0;
    const ratio = underpriced ? 0.4 : 0.92;
    const ask = Math.round(trueValue * ratio);
    const extId = `e${i}`;
    labels.set(extId, trueValue);
    listings.push({
      underpriced,
      trueValueCents: trueValue,
      raw: {
        sourceCode: "ebay",
        externalId: extId,
        channel: "api",
        fetchedAt: AS_OF,
        url: `https://ebay.test/itm/${i}`,
        payload: {
          itemId: extId,
          title: `RetroGame ${i} M${i} good condition, moving sale`,
          price: { value: (ask / 100).toFixed(2), currency: "USD" },
          itemWebUrl: `https://ebay.test/itm/${i}`,
          condition: "Used",
        },
      },
    });
  }

  // one malformed payload → exercises ingest coverage < 100% but ≥ 95%
  const malformed: RawListing = {
    sourceCode: "ebay",
    externalId: "e-bad",
    channel: "api",
    fetchedAt: AS_OF,
    payload: { itemId: "e-bad", title: "" }, // fails the eBay schema
  };

  return { products, cache, listings, labels, malformed };
}

/** Keyword-driven fake extractor: pull the MPN token, grade from the "good condition" text. */
function fakeHandler(req: LlmRequest): object {
  const d = (req.data ?? "").toLowerCase();
  const m = /\bm\d+\b/.exec(d);
  return {
    brand: "BrandX",
    model: m ? m[0].toUpperCase() : null,
    mpn: m ? m[0].toUpperCase() : null,
    upc: null,
    variant: {},
    conditionClaim: d.includes("good condition") ? "good" : "unknown",
    defects: [],
    bundleItems: [],
    redFlags: [],
    confidence: 0.8,
  };
}

function corpusAdapter(raws: RawListing[]): SourceAdapter {
  return {
    code: "ebay",
    tier: "T0",
    channel: "api",
    async *poll(ctx: AdapterContext) {
      for (const r of raws) {
        if (ctx.signal?.aborted) return;
        yield r;
      }
    },
    async selfTest() {
      return true;
    },
  };
}

describe("Phase 1 gate — paper-trading over a labeled games/consoles corpus", () => {
  const { products, cache, listings, labels, malformed } = buildCorpus();

  const store = new ListingStore();
  const pipeline = new IngestPipeline(store).register(ebayNormalizer);
  const identifier = new Identifier(
    { llm: new FakeLlm(fakeHandler), embedder: new HashingEmbedder(64), products },
    { filter: { minPriceCents: 100n, maxPriceCents: 5_000_00n } },
  );
  const compRouter = new CompRouter([new TerapeakCacheProvider(cache)]);
  const notifier = new CollectingNotifier();
  const engine = new Engine(
    { pipeline, identifier, compRouter, notifier, now: () => new Date(AS_OF) },
    { activeCount: 6, paper: true },
  );

  const raws = [...listings.map((l) => l.raw), malformed];

  test("runs the full ingest→identify→appraise→underwrite→rank→alert pipeline in paper mode", async () => {
    const result = await engine.run(corpusAdapter(raws), { log: () => {} });

    // --- gate 1: ingest coverage ≥ 95% ---
    const coverage = result.ingested / result.seen;
    expect(coverage).toBeGreaterThanOrEqual(0.95);
    expect(result.ingestFailed).toBe(1); // the malformed one

    // --- identification: every valid listing resolved to its product ---
    expect(result.identified).toBe(N);

    // --- gate 2: valuation MAPE ≤ 15% on the labeled set ---
    const apes: number[] = [];
    for (const opp of result.opportunities) {
      const label = labels.get(opp.listingExternalId);
      if (label && opp.valuationP50Cents !== undefined) {
        apes.push(Math.abs(Number(opp.valuationP50Cents) - label) / label);
      }
    }
    expect(apes.length).toBe(N);
    const mape = median(apes);
    expect(mape).toBeLessThanOrEqual(0.15);

    // --- gate 3: alerts land ---
    expect(result.alerts.length).toBeGreaterThan(0);
    expect(notifier.sent.length).toBe(result.alerts.length);

    // --- gate 4: you'd have made money on paper ---
    expect(result.paper.taken).toBeGreaterThan(0);
    expect(result.paper.expectedNetCents).toBeGreaterThan(0n);

    // sanity: underpriced deals are taken far more than fair-priced ones
    const takenExtIds = new Set(result.opportunities.filter((o) => o.taken).map((o) => o.listingExternalId));
    const takenUnderpriced = listings.filter((l) => l.underpriced && takenExtIds.has(l.raw.externalId)).length;
    const takenFair = listings.filter((l) => !l.underpriced && takenExtIds.has(l.raw.externalId)).length;
    expect(takenUnderpriced).toBeGreaterThan(takenFair);
  });
});
