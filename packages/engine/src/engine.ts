import type { AdapterContext, Listing, RiskFlag, SourceAdapter } from "@flip-desk/core";
import { appraise } from "@flip-desk/appraise";
import { type Identifier, type IdentifyListing } from "@flip-desk/identify";
import type { Cents } from "@flip-desk/money";
import type { IngestPipeline } from "@flip-desk/pipeline";
import type { CompRouter } from "@flip-desk/providers";
import { type Band, score } from "@flip-desk/rank";
import { feeFor, underwrite, type UnderwriteFloors, type WaterfallLine } from "@flip-desk/underwrite";
import { Alerter, type Alert, type Notifier } from "./alert.js";
import { defaultProfileFor, type ProfileResolver } from "./profile.js";

export interface EngineConfig {
  readonly profileFor?: ProfileResolver;
  readonly floors?: UnderwriteFloors;
  readonly activeCount?: number;
  /** Paper-trading (plan §15): compute would-be P&L; move no money, publish nothing. Default true in P1. */
  readonly paper?: boolean;
}

export interface EngineDeps {
  readonly pipeline: IngestPipeline;
  readonly identifier: Identifier;
  readonly compRouter: CompRouter;
  readonly notifier: Notifier;
  readonly now?: () => Date;
}

export interface OpportunityResult {
  readonly listingExternalId: string;
  readonly identified: boolean;
  readonly reason?: string;
  readonly productId?: number;
  readonly matchMethod?: string;
  readonly valuationP50Cents?: Cents;
  readonly valuationConfidence?: number;
  readonly netP50Cents?: Cents;
  readonly cashAtRiskCents?: Cents;
  readonly roi?: number;
  readonly score?: number;
  readonly band?: Band;
  readonly hardBlock?: boolean;
  readonly floorsPass?: boolean;
  readonly taken: boolean;
  readonly riskFlags: readonly RiskFlag[];
  readonly waterfall?: readonly WaterfallLine[];
}

export interface EngineRunResult {
  readonly seen: number;
  readonly ingested: number;
  readonly ingestFailed: number;
  readonly identified: number;
  readonly opportunities: OpportunityResult[];
  readonly alerts: Alert[];
  readonly paper: { taken: number; expectedNetCents: Cents };
}

/**
 * The Phase 1 pipeline (plan §5.2): ingest → identify → appraise → underwrite → rank → alert. Pure
 * orchestration over the tested units; in paper mode it computes would-be P&L and moves no money.
 */
export class Engine {
  private readonly profileFor: ProfileResolver;
  private readonly alerter: Alerter;
  private readonly now: () => Date;

  constructor(
    private readonly deps: EngineDeps,
    private readonly cfg: EngineConfig = {},
  ) {
    this.profileFor = cfg.profileFor ?? defaultProfileFor;
    this.now = deps.now ?? (() => new Date());
    this.alerter = new Alerter(deps.notifier, this.now);
  }

  async run(adapter: SourceAdapter, ctx: AdapterContext): Promise<EngineRunResult> {
    let seen = 0;
    let ingested = 0;
    let ingestFailed = 0;
    let identified = 0;
    const opportunities: OpportunityResult[] = [];
    const alerts: Alert[] = [];
    let takenCount = 0;
    let expectedNet = 0n;

    for await (const raw of adapter.poll(ctx)) {
      if (ctx.signal?.aborted) break;
      seen++;
      let created: boolean;
      let listing: Listing;
      try {
        const up = this.deps.pipeline.ingest(raw);
        created = up.created;
        listing = up.listing;
      } catch {
        ingestFailed++;
        continue;
      }
      ingested++;
      if (!created) continue; // dedupe: only process fresh listings

      const opp = await this.process(listing);
      opportunities.push(opp);
      if (opp.identified) identified++;
      if (opp.band) {
        const alert = await this.alerter.maybeAlert(opp.listingExternalId, opp.band, opp.score ?? 0);
        if (alert) alerts.push(alert);
      }
      if (opp.taken && opp.netP50Cents !== undefined) {
        takenCount++;
        expectedNet += opp.netP50Cents;
      }
    }

    return {
      seen,
      ingested,
      ingestFailed,
      identified,
      opportunities,
      alerts,
      paper: { taken: takenCount, expectedNetCents: expectedNet },
    };
  }

  /** Underwrite a single shared listing (plan §4.2 share-sheet flow): ingest one raw, then process. */
  async underwriteRaw(raw: import("@flip-desk/core").RawListing): Promise<OpportunityResult> {
    const up = this.deps.pipeline.ingest(raw);
    return this.process(up.listing);
  }

  async process(listing: Listing): Promise<OpportunityResult> {
    const il: IdentifyListing = {
      externalId: listing.externalId,
      title: listing.title,
      priceCents: listing.priceCents,
      ...(listing.description !== undefined ? { description: listing.description } : {}),
      ...(listing.conditionClaimed !== undefined ? { conditionClaimed: listing.conditionClaimed } : {}),
      ...(listing.attrs ? { attrs: listing.attrs } : {}),
    };

    const id = await this.deps.identifier.identify(il);
    if (!id.passed || !id.product) {
      return {
        listingExternalId: listing.externalId,
        identified: false,
        reason: id.reason ?? "unidentified",
        taken: false,
        riskFlags: id.riskFlags,
      };
    }

    const product = id.product;
    const profile = this.profileFor(product.categoryId);
    const band = id.conditionBand ?? "good";

    const route = await this.deps.compRouter.fetch({ product, conditionBand: band });
    if (route.comps.length === 0) {
      return { listingExternalId: listing.externalId, identified: true, productId: product.id, reason: "no_comps", taken: false, riskFlags: id.riskFlags };
    }

    const valuation = appraise({
      productId: product.id,
      targetBand: band,
      comps: route.comps,
      asOf: this.now().toISOString(),
      activeCount: this.cfg.activeCount ?? 15,
      matchConfidence: id.matchConfidence,
      conditionCertainty: id.conditionCertainty,
    });
    if (valuation.p50Cents <= 0n) {
      return { listingExternalId: listing.externalId, identified: true, productId: product.id, reason: "no_valuation", taken: false, riskFlags: id.riskFlags };
    }

    const risk = new Set<RiskFlag>(id.riskFlags);
    if (route.providers.length < 2) risk.add("single_provider_comps");

    const fee = feeFor(profile.channel) ?? { pctBp: 1360, fixedCents: 30n };
    const uw = underwrite({
      channel: profile.channel,
      resaleP50Cents: valuation.p50Cents,
      resaleP10Cents: valuation.p10Cents,
      resaleP90Cents: valuation.p90Cents,
      fee,
      ...(profile.promotedRateBp !== undefined ? { promotedRateBp: profile.promotedRateBp } : {}),
      outboundShipCents: profile.outboundShipCents,
      ...(profile.packagingCents !== undefined ? { packagingCents: profile.packagingCents } : {}),
      ...(profile.returns ? { returns: profile.returns } : {}),
      purchaseCents: listing.priceCents,
      expTtsDays: valuation.ttsDaysP50 ?? profile.defaultTtsDays,
      laborMinutes: profile.laborMinutes,
      ...(profile.aprBp !== undefined ? { aprBp: profile.aprBp } : {}),
      ...(this.cfg.floors ? { floors: this.cfg.floors } : {}),
    });

    const sc = score({
      roi: uw.roi,
      pProfit: uw.pProfit ?? 0.5,
      confidence: valuation.confidence,
      laborMinutes: profile.laborMinutes,
      ...(valuation.sellThrough90d !== undefined ? { sellThrough90d: valuation.sellThrough90d } : {}),
      ...(valuation.ttsDaysP50 !== undefined ? { ttsDaysP50: valuation.ttsDaysP50 } : {}),
      riskFlags: [...risk],
    });

    // Paper-trade take rule: any floors-passing, non-hard-blocked deal we'd act on (push/feed/digest).
    const taken = !sc.hardBlock && uw.floors.pass && sc.band !== "archive";

    return {
      listingExternalId: listing.externalId,
      identified: true,
      productId: product.id,
      matchMethod: id.matchMethod,
      valuationP50Cents: valuation.p50Cents,
      valuationConfidence: valuation.confidence,
      netP50Cents: uw.netP50Cents,
      cashAtRiskCents: uw.cashAtRiskCents,
      roi: uw.roi,
      score: sc.score,
      band: sc.band,
      hardBlock: sc.hardBlock,
      floorsPass: uw.floors.pass,
      taken,
      riskFlags: [...risk],
      waterfall: uw.waterfall,
    };
  }
}
