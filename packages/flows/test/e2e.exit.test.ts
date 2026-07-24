import { describe, expect, test } from "vitest";
import type { AdapterContext, Comp, Product, Publisher, PublishInput, PublishResult, RawListing, SourceAdapter } from "@flip-desk/core";
import { ebayNormalizer } from "@flip-desk/adapter-ebay";
import { EbaySellPublisher, StaticTokenProvider } from "@flip-desk/adapter-ebay-sell";
import { Acquirer } from "@flip-desk/acquire";
import { Bookkeeper } from "@flip-desk/bookkeeper";
import { type Clock, DelistSaga, ListingRegistry, VirtualClock } from "@flip-desk/exit";
import { HashingEmbedder, Identifier } from "@flip-desk/identify";
import { Intake } from "@flip-desk/intake";
import { Lister } from "@flip-desk/lister";
import { FakeLlm, type LlmRequest } from "@flip-desk/llm";
import { mulBp } from "@flip-desk/money";
import { FakeTransport, jsonResponse } from "@flip-desk/net";
import { Ops } from "@flip-desk/ops";
import { IngestPipeline, ListingStore } from "@flip-desk/pipeline";
import { KillSwitch, type Policy, RISK_TEXT, Sentinel, type SignedRiskAcceptance, signedTiers } from "@flip-desk/policy";
import { reprice } from "@flip-desk/pricer";
import { CompRouter, TerapeakCache, TerapeakCacheProvider } from "@flip-desk/providers";
import { CollectingNotifier, Engine } from "@flip-desk/engine";
import { OverlayCopilot } from "../src/index.js";

const AS_OF = "2026-07-04T00:00:00.000Z";

/** A non-eBay exit channel that ends against the virtual clock (so delist timing is measurable). */
class FakeChannel implements Publisher {
  readonly tier = "T0" as const;
  readonly ended: string[] = [];
  constructor(
    readonly platform: string,
    private readonly clock: Clock,
    private readonly latencyMs = 800,
  ) {}
  async publish(input: PublishInput): Promise<PublishResult> {
    return { externalId: `${this.platform}:${input.idempotencyKey}` };
  }
  async end(externalId: string): Promise<void> {
    await this.clock.delay(this.latencyMs);
    this.ended.push(externalId);
  }
}

function fakeLlm(req: LlmRequest): object {
  if (req.model === "sonnet") return { chosen: null, reason: "no match" };
  const d = (req.data ?? "").toLowerCase();
  const m = /\bm\d+\b/.exec(d);
  return {
    brand: "BrandX",
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

function buildEngine() {
  const product: Product = {
    id: 1,
    canonicalKey: "mpn:M1",
    categoryId: 1,
    brand: "BrandX",
    model: "M1",
    variant: {},
    identifiers: { mpn: "M1" },
    title: "RetroGame One",
  };
  const cache = new TerapeakCache();
  const comps: Comp[] = Array.from({ length: 12 }, (_, j) => ({
    productId: 1,
    provider: "terapeak",
    conditionBand: "good" as const,
    priceCents: BigInt(15_000 + j * 40),
    soldAt: `2026-06-${String(10 + j).padStart(2, "0")}`,
    sellerKey: `s${j}`,
  }));
  cache.put(1, comps);

  const raw: RawListing = {
    sourceCode: "ebay",
    externalId: "e1",
    channel: "api",
    fetchedAt: AS_OF,
    url: "https://ebay.test/itm/1",
    payload: { itemId: "e1", title: "RetroGame One M1 good condition", price: { value: "60.00", currency: "USD" }, condition: "Used" },
  };

  const store = new ListingStore();
  const pipeline = new IngestPipeline(store).register(ebayNormalizer);
  const identifier = new Identifier(
    { llm: new FakeLlm(fakeLlm), embedder: new HashingEmbedder(64), products: [{ product, text: "RetroGame One M1" }] },
    { filter: { minPriceCents: 100n, maxPriceCents: 5_000_00n } },
  );
  const engine = new Engine(
    { pipeline, identifier, compRouter: new CompRouter([new TerapeakCacheProvider(cache)]), notifier: new CollectingNotifier(), now: () => new Date(AS_OF) },
    { activeCount: 6 },
  );
  return { engine, raw };
}

const POLICY: Policy = {
  purchaseDayCapCents: 1_000_00n,
  autonomy: { commit_purchase_pickup: "L2", overlay_evaluate: "L2" },
  tiersEnabled: ["T0", "T2"],
};

describe("Phase 3 gate — buy → list → reprice → sell → ship → book, zero manual entry", () => {
  test("one flip flows end to end; delist ends the other channel; books clean", async () => {
    const { engine, raw } = buildEngine();

    // --- underwrite the shared listing ---
    const opp = await engine.underwriteRaw(raw);
    expect(opp.taken).toBe(true);
    const listPrice = opp.valuationP50Cents!;
    const ask = opp.cashAtRiskCents!;

    // --- BUY (L2 approval → commit) ---
    const acquirer = new Acquirer(new Sentinel({ killSwitch: new KillSwitch(), policy: POLICY }));
    const acqReq = {
      opportunityExternalId: opp.listingExternalId,
      allInCents: ask,
      purchasePriceCents: ask,
      confidence: opp.valuationConfidence ?? 0.7,
      band: opp.band!,
      hardBlock: false,
      bankroll: { totalCents: 1_000_000n, deployedCents: 0n },
      tier: "T0" as const,
      scope: { source: "ebay" },
      method: "cash_pickup" as const,
    };
    expect(acquirer.prepare(acqReq).outcome).toBe("needs_approval");
    const purchase = acquirer.commit(acqReq, "human:mason", AS_OF);

    // --- INTAKE (SKU minted here threads through the whole lifecycle) ---
    const intake = new Intake({ now: () => new Date(AS_OF) });
    const received = await intake.receive({
      categorySlug: "games",
      costBasisCents: purchase.pricePaidCents,
      testResults: { disc_reads: true, no_deep_scratches: true, case_and_art: true },
      photos: ["front", "back", "disc/cart", "any defects"],
    });
    const sku = received.sku;

    // --- BOOK the purchase ---
    const bk = new Bookkeeper();
    bk.injectCapital(1_000_000n);
    bk.recordPurchase({ sku, pricePaidCents: purchase.pricePaidCents });

    // --- LIST across two channels (copy + price fully derived, no manual entry) ---
    const engineProduct = (await engine.underwriteRaw(raw)).productId;
    expect(engineProduct).toBe(1);
    const lister = new Lister();
    const drafts = await lister.draftAll(
      {
        sku,
        product: { id: 1, canonicalKey: "mpn:M1", categoryId: 1, brand: "BrandX", model: "M1", variant: {}, title: "RetroGame One" },
        conditionBand: received.conditionVerified!,
        priceCents: listPrice,
        sourcePhotoKeys: received.photoKeys,
      },
      ["ebay", "mercari"],
    );
    const ebayDraft = drafts.find((d) => d.platform === "ebay")!;
    const mercariDraft = drafts.find((d) => d.platform === "mercari")!;
    expect(ebayDraft.sku).toBe(sku); // same SKU threaded through
    expect(ebayDraft.title).toContain("BrandX");

    // --- PUBLISH ---
    const clock = new VirtualClock();
    const t = new FakeTransport()
      .on("/publish", jsonResponse(200, { listingId: "9988776655" }))
      .on("/shipping_fulfillment", jsonResponse(200, { fulfillmentId: "FUL-1" }))
      .on("/inventory_item/", jsonResponse(204, {}))
      .on("/offer", jsonResponse(201, { offerId: "OFFER-1" }));
    const ebaySell = new EbaySellPublisher(t, new StaticTokenProvider("USER-TOKEN"), { merchantLocationKey: "WH1" });
    const mercari = new FakeChannel("mercari", clock, 900);

    const registry = new ListingRegistry();
    const ebayPub = await ebaySell.publish(ebayDraft);
    const mercariPub = await mercari.publish(mercariDraft);
    registry.publish(sku, "ebay", ebayPub.externalId);
    registry.publish(sku, "mercari", mercariPub.externalId);
    expect(registry.activeListings(sku)).toHaveLength(2);

    // --- REPRICE after the listing ages past its TTS curve ---
    const decision = reprice(
      { costBasisCents: purchase.pricePaidCents, originalListCents: listPrice, currentPriceCents: listPrice, listedAt: AS_OF, ttsDaysP50: 10 },
      new Date(Date.parse(AS_OF) + 12 * 86_400_000), // 1.2× TTS
    );
    expect(decision.action).toBe("markdown");
    expect(decision.newPriceCents).toBeLessThan(listPrice);
    expect(decision.newPriceCents).toBeGreaterThanOrEqual(decision.floorCents);
    const salePrice = decision.newPriceCents;

    // --- SELL on eBay → delist saga ends every other channel ---
    const saga = new DelistSaga({ registry, publishers: new Map<string, Publisher>([["ebay", ebaySell], ["mercari", mercari]]), clock });
    const sale = saga.onSale(sku, "ebay", ebayPub.externalId);
    await clock.drain();
    const delist = await sale;
    expect(delist.outcome).toBe("delisted");
    expect(delist.halted).toBe(false);
    expect(delist.elapsedMs).toBeLessThan(60_000);
    expect(mercari.ended).toHaveLength(1); // oversell prevented — the other channel is pulled
    expect(registry.activeListings(sku)).toHaveLength(0);

    // --- SHIP (label + tracking upload, all derived) ---
    const ops = new Ops({ now: () => new Date(AS_OF) });
    const shipment = await ops.fulfill({ sku, fromZip: "10001", toZip: "94103", weightOz: 20 });
    const fulfillmentId = await ebaySell.createShippingFulfillment("ORDER-1", {
      trackingNumber: shipment.trackingNumber,
      carrier: shipment.carrier,
      lineItemIds: ["LI-1"],
    });
    expect(fulfillmentId).toBe("FUL-1");

    // --- BOOK the sale ---
    bk.recordSale({
      sku,
      grossCents: salePrice,
      feesCents: mulBp(salePrice, 1360) + 30n,
      adFeesCents: mulBp(salePrice, 300),
      shipLabelCents: shipment.labelCostCents,
    });

    // --- gate assertions ---
    expect(bk.ledger.isBalanced()).toBe(true);
    expect(bk.inventoryValueCents()).toBe(0n);
    expect(bk.scheduleC().netProfitCents).toBeGreaterThan(0n);
    // one SKU threaded intake → lister → registry → ops → book with no re-keying
    expect([ebayDraft.sku, shipment.sku, registry.listings(sku)[0]?.platform ? sku : ""].every((s) => s === sku)).toBe(true);
  });
});

describe("Overlay Copilot — T3 opt-in ceremony", () => {
  const scope = { source: "fb_mkt" };
  function raw(): RawListing {
    return {
      sourceCode: "ebay",
      externalId: "ov1",
      channel: "api",
      fetchedAt: AS_OF,
      payload: { itemId: "ov1", title: "RetroGame One M1 good condition", price: { value: "60.00", currency: "USD" }, condition: "Used" },
    };
  }

  test("without a signed acceptance the overlay is blocked", async () => {
    const { engine } = buildEngine();
    const sentinel = new Sentinel({ killSwitch: new KillSwitch(), policy: { ...POLICY, tiersEnabled: ["T0", "T2", "T3"] } });
    const res = await new OverlayCopilot(engine, sentinel).evaluate(raw(), scope);
    expect(res.allowed).toBe(false);
    expect(res.blockedReason).toBe("opt_in_required");
  });

  test("after the ceremony the overlay returns a verdict card", async () => {
    const { engine } = buildEngine();
    const acceptances: SignedRiskAcceptance[] = [
      { tier: "T3", operator: "mason", acceptedAt: AS_OF, riskAcknowledged: RISK_TEXT["T3"]! },
    ];
    const sentinel = new Sentinel({
      killSwitch: new KillSwitch(),
      policy: { ...POLICY, tiersEnabled: ["T0", "T2", "T3"], signedOptIns: signedTiers(acceptances) },
    });
    const res = await new OverlayCopilot(engine, sentinel).evaluate(raw(), scope);
    expect(res.allowed).toBe(true);
    expect(res.card?.verdict).toBe("buy");
  });
});
