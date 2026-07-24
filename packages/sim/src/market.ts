import type { Comp, Product, RawListing } from "@flip-desk/core";
import type { SimConfig } from "./config.js";
import { Rng } from "./rng.js";
import type { SimListing } from "./types.js";

const DAY_MS = 86_400_000;

export interface GeneratedMarket {
  /** Product catalog for the identifier (one product per listing, uniquely tagged). */
  readonly products: ReadonlyArray<{ product: Product; text: string }>;
  /** Comps per productId, dated relative to each listing's day. */
  readonly compsByProduct: ReadonlyMap<number, Comp[]>;
  /** Raw listings the ingest pipeline consumes, per simulated day. */
  readonly rawsByDay: ReadonlyArray<readonly RawListing[]>;
  /** The listings with their hidden ground truth, per day (aligned with rawsByDay). */
  readonly listingsByDay: ReadonlyArray<readonly SimListing[]>;
}

function isoAt(startMs: number, day: number): string {
  return new Date(startMs + day * DAY_MS).toISOString();
}

/**
 * Pre-generate the entire deterministic market up front: every product, its recent comps, and the
 * per-day listing stream with hidden ground truth. Pre-generating (rather than sampling inside the
 * day loop) means the engine — which is itself deterministic — sees identical inputs on every run of
 * a given seed, so the whole simulation is reproducible bit-for-bit.
 */
export function generateMarket(config: SimConfig, seed: number, days: number): GeneratedMarket {
  const rng = new Rng(seed);
  const startMs = Date.parse(config.startDateIso);
  const catWeights = config.categories.map((c) => c.weight);

  const products: Array<{ product: Product; text: string }> = [];
  const compsByProduct = new Map<number, Comp[]>();
  const rawsByDay: RawListing[][] = [];
  const listingsByDay: SimListing[][] = [];

  let g = 0;
  for (let day = 0; day < days; day++) {
    const raws: RawListing[] = [];
    const listings: SimListing[] = [];
    // Small deterministic jitter around the mean arrival count.
    const count = Math.max(1, config.listingsPerDay + rng.int(-2, 2));

    for (let k = 0; k < count; k++) {
      g += 1;
      const cat = config.categories[rng.weightedIndex(catWeights)]!;
      const trueValue = Math.round(rng.lognormal(cat.medianValueCents, cat.sigmaValue));

      // Ask ratio: deals (steal / modest) vs fair-or-high. Discounts are deliberately moderate —
      // real resale margins are 30–50%, not 65% — so the measured return isn't fantastical.
      let ratio: number;
      if (rng.chance(cat.dealRate)) {
        ratio = rng.chance(cat.stealRate) ? rng.uniform(0.42, 0.62) : rng.uniform(0.62, 0.82);
      } else {
        ratio = rng.uniform(0.9, 1.15);
      }
      const ask = Math.max(100, Math.round(trueValue * ratio));

      // Hidden truth: clearing price and time to sale, drawn from the category's own distributions.
      // Base clearing price mirrors the comp dispersion (so the appraisal band is honestly tested);
      // a bad-outcome tail (return / DOA / misgrade) applies a real haircut, producing genuine losses.
      const bad = rng.chance(cat.badOutcomeRate);
      const haircut = bad ? rng.uniform(0.35, 0.68) : 1;
      const realized = Math.max(1, Math.round(trueValue * haircut * Math.exp(cat.sigmaComp * rng.normal())));
      const holdDays = rng.geometric(cat.dailySaleHazard, 120);

      const modelTag = `M${g}`;
      const title = `${cat.label} ${modelTag}`;
      products.push({
        product: {
          id: g,
          canonicalKey: `mpn:${modelTag}`,
          categoryId: 1,
          brand: cat.label,
          model: modelTag,
          variant: {},
          identifiers: { mpn: modelTag },
          title,
        },
        text: `${title}`,
      });

      // 13 recent comps around true value, sold in the 30 days before this listing appears.
      const comps: Comp[] = Array.from({ length: 13 }, (_, j) => {
        const soldDay = day - rng.int(1, 30);
        return {
          productId: g,
          provider: "terapeak",
          conditionBand: "good" as const,
          priceCents: BigInt(Math.max(1, Math.round(trueValue * Math.exp(cat.sigmaComp * rng.normal())))),
          soldAt: isoAt(startMs, soldDay).slice(0, 10),
          sellerKey: `s${g}-${j}`,
        };
      });
      compsByProduct.set(g, comps);

      raws.push({
        sourceCode: "ebay",
        externalId: `e${g}`,
        channel: "api",
        fetchedAt: isoAt(startMs, day),
        url: `https://ebay.example/itm/${g}`,
        payload: {
          itemId: `e${g}`,
          title: `${title} good condition`,
          price: { value: (ask / 100).toFixed(2), currency: "USD" },
          condition: "Used",
        },
      });
      listings.push({ g, day, category: cat.slug, title, trueValueCents: trueValue, askCents: ask, realizedSaleCents: realized, holdDays });
    }

    rawsByDay.push(raws);
    listingsByDay.push(listings);
  }

  return { products, compsByProduct, rawsByDay, listingsByDay };
}
