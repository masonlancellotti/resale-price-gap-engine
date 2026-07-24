import { describe, expect, test } from "vitest";
import type { AdapterContext, Comp, Product, RawListing, SourceAdapter } from "@flip-desk/core";
import { ebayNormalizer } from "@flip-desk/adapter-ebay";
import { Acquirer } from "@flip-desk/acquire";
import { Bookkeeper } from "@flip-desk/bookkeeper";
import { HashingEmbedder, Identifier } from "@flip-desk/identify";
import { Intake } from "@flip-desk/intake";
import { FakeLlm, type LlmRequest } from "@flip-desk/llm";
import { mulBp } from "@flip-desk/money";
import { IngestPipeline, ListingStore } from "@flip-desk/pipeline";
import { KillSwitch, type Policy, Sentinel } from "@flip-desk/policy";
import { CompRouter, TerapeakCache, TerapeakCacheProvider } from "@flip-desk/providers";
import { RegretWatcher } from "@flip-desk/regret";
import { CollectingNotifier, Engine } from "@flip-desk/engine";
import { ShareSheetService } from "../src/index.js";

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
const CATALOG = 20;

function buildCorpus() {
  const rng = mulberry32(7);
  const products: Array<{ product: Product; text: string }> = [];
  const cache = new TerapeakCache();
  const raws: RawListing[] = [];

  for (let i = 1; i <= CATALOG; i++) {
    // $120..$320 — above the ~$106 break-even where fixed ship/fees stop eating the whole spread.
    const trueValue = 12_000 + Math.round(rng() * 20_000);
    products.push({
      product: { id: i, canonicalKey: `mpn:M${i}`, categoryId: 1, brand: "BrandX", model: `M${i}`, variant: {}, identifiers: { mpn: `M${i}` }, title: `RetroGame ${i}` },
      text: `RetroGame ${i} M${i}`,
    });

    const comps: Comp[] = [];
    for (let j = 0; j < 14; j++) {
      comps.push({
        productId: i,
        provider: "terapeak",
        conditionBand: "good",
        priceCents: BigInt(Math.round(trueValue * (0.9 + 0.2 * rng()))),
        soldAt: new Date(Date.parse(AS_OF) - (1 + Math.floor(rng() * 25)) * DAY).toISOString().slice(0, 10),
        sellerKey: `p${i}-s${j}`,
      });
    }
    cache.put(i, comps);

    const underpriced = i <= 14;
    const ask = Math.round(trueValue * (underpriced ? 0.4 : 0.92));
    raws.push({
      sourceCode: "ebay",
      externalId: `e${i}`,
      channel: "api",
      fetchedAt: AS_OF,
      url: `https://ebay.test/itm/${i}`,
      payload: {
        itemId: `e${i}`,
        title: `RetroGame ${i} M${i} good condition`,
        price: { value: (ask / 100).toFixed(2), currency: "USD" },
        itemWebUrl: `https://ebay.test/itm/${i}`,
        condition: "Used",
      },
    });
  }

  // two unidentifiable junk listings → identification rate < 100% but ≥ 90%
  for (const z of ["z1", "z2"]) {
    raws.push({
      sourceCode: "ebay",
      externalId: z,
      channel: "api",
      fetchedAt: AS_OF,
      payload: { itemId: z, title: "Mystery bin lot assorted ZZZ", price: { value: "15.00", currency: "USD" }, condition: "Used" },
    });
  }

  return { products, cache, raws };
}

function fakeHandler(req: LlmRequest): object {
  // Adjudication (Sonnet): our catalog items resolve by exact MPN, so any escalation here is a weak/
  // spurious embedding match (e.g. the junk lots) — the adjudicator declines.
  if (req.model === "sonnet") return { chosen: null, reason: "no clear match" };
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

const POLICY: Policy = {
  purchaseDayCapCents: 1_000_00n,
  autonomy: { commit_purchase_pickup: "L2", commit_purchase_checkout: "L2" },
  tiersEnabled: ["T0", "T2"],
};

describe("Phase 2 gate — 10 flips booked clean end-to-end", () => {
  test("scan → approve → intake → book purchase → sell → book sale, ×10+", async () => {
    const { products, cache, raws } = buildCorpus();

    const store = new ListingStore();
    const pipeline = new IngestPipeline(store).register(ebayNormalizer);
    const identifier = new Identifier(
      { llm: new FakeLlm(fakeHandler), embedder: new HashingEmbedder(64), products },
      { filter: { minPriceCents: 100n, maxPriceCents: 5_000_00n } },
    );
    const engine = new Engine(
      { pipeline, identifier, compRouter: new CompRouter([new TerapeakCacheProvider(cache)]), notifier: new CollectingNotifier(), now: () => new Date(AS_OF) },
      { activeCount: 6 },
    );

    const scan = await engine.run(corpusAdapter(raws), { log: () => {} });

    // --- identification ≥ 90% across the valid slice ---
    const identificationRate = scan.identified / scan.seen;
    expect(identificationRate).toBeGreaterThanOrEqual(0.9);
    expect(scan.identified).toBe(CATALOG); // all catalog items resolved

    // --- book each taken opportunity as a full flip ---
    const acquirer = new Acquirer(new Sentinel({ killSwitch: new KillSwitch(), policy: POLICY }));
    const intake = new Intake({ now: () => new Date(AS_OF) });
    const bk = new Bookkeeper();
    bk.injectCapital(1_000_000n); // $10k working bankroll

    let deployed = 0n;
    let flipsBooked = 0;

    for (const opp of scan.opportunities.filter((o) => o.taken)) {
      const ask = opp.cashAtRiskCents!;
      const acqReq = {
        opportunityExternalId: opp.listingExternalId,
        allInCents: ask,
        purchasePriceCents: ask,
        confidence: opp.valuationConfidence ?? 0.7,
        band: opp.band!,
        hardBlock: opp.hardBlock ?? false,
        bankroll: { totalCents: 1_000_000n, deployedCents: deployed, categoryDeployedCents: deployed },
        tier: "T0" as const,
        scope: { source: "ebay" },
        method: "cash_pickup" as const,
        ...(opp.netP50Cents !== undefined ? { netP50Cents: opp.netP50Cents } : {}),
      };
      const decision = acquirer.prepare(acqReq);
      expect(decision.outcome).toBe("needs_approval"); // L2 one-tap

      const purchase = acquirer.commit(acqReq, "human:mason", AS_OF);
      const received = await intake.receive({
        categorySlug: "games",
        costBasisCents: purchase.pricePaidCents,
        testResults: { disc_reads: true, no_deep_scratches: true, case_and_art: true },
        photos: ["front", "back", "disc/cart", "any defects"],
      });
      expect(received.blocked).toBe(false);

      bk.recordPurchase({ sku: received.sku, pricePaidCents: purchase.pricePaidCents });

      // sell at the appraised P50
      const gross = opp.valuationP50Cents!;
      bk.recordSale({
        sku: received.sku,
        grossCents: gross,
        feesCents: mulBp(gross, 1360) + 30n,
        adFeesCents: mulBp(gross, 300),
        shipLabelCents: 900n,
      });

      deployed += ask;
      flipsBooked += 1;
    }

    // --- gate: ≥ 10 flips, ledger balanced, inventory cleared, real profit ---
    expect(flipsBooked).toBeGreaterThanOrEqual(10);
    expect(bk.ledger.isBalanced()).toBe(true);
    expect(bk.inventoryValueCents()).toBe(0n);
    expect(bk.scheduleC().netProfitCents).toBeGreaterThan(0n);
    expect(bk.reconcile1099k(bk.scheduleC().revenueCents).matched).toBe(true);

    // --- regret: watch the passed-but-identified deals to terminal state, measure the rate ---
    const regret = new RegretWatcher();
    for (const opp of scan.opportunities.filter((o) => o.identified && !o.taken)) {
      regret.watch({
        listingId: opp.listingExternalId,
        skippedAt: AS_OF,
        skipReason: "below_floor",
        askCents: opp.cashAtRiskCents ?? 0n,
        ...(opp.valuationP50Cents !== undefined ? { predictedResaleP50Cents: opp.valuationP50Cents } : {}),
        ...(opp.netP50Cents !== undefined ? { predictedNetCents: opp.netP50Cents } : {}),
      });
      regret.resolve(opp.listingExternalId, { finalStatus: "sold" });
    }
    const rr = regret.regretRate();
    expect(rr).toBeGreaterThanOrEqual(0);
    expect(rr).toBeLessThanOrEqual(1);

    // --- share-sheet verdict cards ---
    const sheet = new ShareSheetService(engine);
    const buyCard = await sheet.underwrite(raws[0]!); // an underpriced item
    expect(buyCard.verdict).toBe("buy");
    expect(buyCard.headline).toContain("BUY");
    const passCard = await sheet.underwrite(raws[raws.length - 1]!); // junk
    expect(passCard.verdict).toBe("pass");
  });
});
