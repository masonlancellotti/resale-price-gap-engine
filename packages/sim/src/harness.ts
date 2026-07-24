import { ebayNormalizer } from "@flip-desk/adapter-ebay";
import { CollectingNotifier, Engine } from "@flip-desk/engine";
import { HashingEmbedder, Identifier } from "@flip-desk/identify";
import { FakeLlm, type LlmRequest } from "@flip-desk/llm";
import { IngestPipeline, ListingStore } from "@flip-desk/pipeline";
import { CompRouter, TerapeakCache, TerapeakCacheProvider } from "@flip-desk/providers";
import type { GeneratedMarket } from "./market.js";

const DAY_MS = 86_400_000;

/** Same deterministic extractor the demo uses: pull the `M<n>` model tag so the identifier resolves
 *  by exact MPN — no LLM ambiguity, fully reproducible. */
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

/**
 * Builds the REAL engine over a generated market and exposes a movable clock. `setDay(d)` advances
 * the appraisal "as of" one virtual day at a time, so the engine values each listing against comps
 * that are recent relative to the day it appears — exactly as it would in production.
 */
export class EngineHarness {
  readonly engine: Engine;
  #dayMs: number;

  constructor(market: GeneratedMarket, startMs: number, activeCount = 8) {
    this.#dayMs = startMs;
    const cache = new TerapeakCache();
    for (const [productId, comps] of market.compsByProduct) cache.put(productId, comps);

    const store = new ListingStore();
    const pipeline = new IngestPipeline(store).register(ebayNormalizer);
    const identifier = new Identifier(
      { llm: new FakeLlm(fakeLlm), embedder: new HashingEmbedder(64), products: market.products },
      { filter: { minPriceCents: 100n, maxPriceCents: 5_000_00n } },
    );
    this.engine = new Engine(
      {
        pipeline,
        identifier,
        compRouter: new CompRouter([new TerapeakCacheProvider(cache)]),
        notifier: new CollectingNotifier(),
        now: () => new Date(this.#dayMs),
      },
      { activeCount },
    );
  }

  setDay(startMs: number, day: number): void {
    this.#dayMs = startMs + day * DAY_MS;
  }
}
