import type { Comp, CompProvider, CompQuery, ConditionBand, Product } from "@flip-desk/core";
import { parseJson, type Transport } from "@flip-desk/net";
import type { ProviderOptions } from "./providers.js";

/**
 * Category-specialist comp providers (plan §4.1): Discogs for vinyl, BrickLink for LEGO, Reverb for
 * music gear, plus a generic T1 "scraper-API vendor" gap-filler. All over the Transport seam.
 */

function isoDate(now?: () => Date): string {
  return (now ? now() : new Date()).toISOString().slice(0, 10);
}
function supportsCategory(categories: readonly number[] | undefined, categoryId: number): boolean {
  return !categories || categories.length === 0 || categories.includes(categoryId);
}
function idFrom(p: Product, key: string, prefix: string): string | undefined {
  const v = p.identifiers?.[key];
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  const m = new RegExp(`^${prefix}:(.+)$`).exec(p.canonicalKey);
  return m ? m[1] : undefined;
}

/** Map a free-text condition string to a band (used by the T1 vendor). */
export function conditionToBand(s: string): ConditionBand {
  const t = s.toLowerCase();
  // Order matters: "like new" contains "new", so check like_new/parts BEFORE the plain-new pattern.
  if (/\b(like new|mint|open box|excellent)\b/.test(t)) return "like_new";
  if (/\b(parts|broken|not working|salvage)\b/.test(t)) return "parts";
  if (/\b(new|sealed)\b/.test(t)) return "new";
  if (/\b(fair|acceptable|worn)\b/.test(t)) return "fair";
  return "good";
}

// ---- Discogs price suggestions (vinyl) ---------------------------------------------------------

const DISCOGS_GRADE_TO_BAND: Readonly<Record<string, ConditionBand>> = {
  "Mint (M)": "new",
  "Near Mint (NM or M-)": "like_new",
  "Very Good Plus (VG+)": "good",
  "Very Good (VG)": "good",
  "Good Plus (G+)": "fair",
  "Good (G)": "fair",
  "Fair (F)": "parts",
  "Poor (P)": "parts",
};

export class DiscogsProvider implements CompProvider {
  readonly name = "discogs";
  readonly tier = "T0" as const;
  constructor(private readonly transport: Transport, private readonly opts: ProviderOptions = {}) {}
  supports(categoryId: number): boolean {
    return supportsCategory(this.opts.categories, categoryId);
  }
  async fetchComps(query: CompQuery): Promise<Comp[]> {
    const id = idFrom(query.product, "discogs", "discogs");
    if (!id) return [];
    const base = this.opts.baseUrl ?? "https://api.discogs.com";
    const url = `${base}/marketplace/price_suggestions/${encodeURIComponent(id)}`;
    const res = await this.transport.request({ method: "GET", url });
    const data = parseJson<Record<string, { value: number; currency: string }>>(res, url);
    const soldAt = isoDate(this.opts.now);
    const comps: Comp[] = [];
    for (const [grade, band] of Object.entries(DISCOGS_GRADE_TO_BAND)) {
      const entry = data[grade];
      if (entry && typeof entry.value === "number" && entry.value > 0) {
        comps.push({ productId: query.product.id, provider: this.name, conditionBand: band, priceCents: BigInt(Math.round(entry.value * 100)), soldAt, sellerKey: `discogs:${grade}` });
      }
    }
    return comps;
  }
}

// ---- BrickLink price guide (LEGO) --------------------------------------------------------------

export class BrickLinkProvider implements CompProvider {
  readonly name = "bricklink";
  readonly tier = "T0" as const;
  constructor(private readonly transport: Transport, private readonly opts: ProviderOptions = {}) {}
  supports(categoryId: number): boolean {
    return supportsCategory(this.opts.categories, categoryId);
  }
  async fetchComps(query: CompQuery): Promise<Comp[]> {
    const no = idFrom(query.product, "bl", "bl");
    if (!no) return [];
    const base = this.opts.baseUrl ?? "https://api.bricklink.com/api/store/v1";
    const url = `${base}/items/SET/${encodeURIComponent(no)}/price?guide_type=sold`;
    const res = await this.transport.request({ method: "GET", url });
    // Normalized shape (a real BrickLink client maps the API's price_detail into this).
    const data = parseJson<{ usedAvgCents?: number; newAvgCents?: number }>(res, url);
    const soldAt = isoDate(this.opts.now);
    const comps: Comp[] = [];
    if (typeof data.usedAvgCents === "number" && data.usedAvgCents > 0) {
      comps.push({ productId: query.product.id, provider: this.name, conditionBand: "good", priceCents: BigInt(Math.round(data.usedAvgCents)), soldAt, sellerKey: "bricklink:used", completeness: "complete" });
    }
    if (typeof data.newAvgCents === "number" && data.newAvgCents > 0) {
      comps.push({ productId: query.product.id, provider: this.name, conditionBand: "new", priceCents: BigInt(Math.round(data.newAvgCents)), soldAt, sellerKey: "bricklink:new", completeness: "sealed" });
    }
    return comps;
  }
}

// ---- Reverb price guide (music gear) -----------------------------------------------------------

export class ReverbProvider implements CompProvider {
  readonly name = "reverb";
  readonly tier = "T0" as const;
  constructor(private readonly transport: Transport, private readonly opts: ProviderOptions = {}) {}
  supports(categoryId: number): boolean {
    return supportsCategory(this.opts.categories, categoryId);
  }
  async fetchComps(query: CompQuery): Promise<Comp[]> {
    const id = idFrom(query.product, "reverb", "reverb");
    if (!id) return [];
    const base = this.opts.baseUrl ?? "https://api.reverb.com/api";
    const url = `${base}/priceguide/${encodeURIComponent(id)}`;
    const res = await this.transport.request({ method: "GET", url });
    const data = parseJson<{ medianCents?: number; lowCents?: number; highCents?: number }>(res, url);
    const soldAt = isoDate(this.opts.now);
    const comps: Comp[] = [];
    if (typeof data.lowCents === "number" && data.lowCents > 0) comps.push({ productId: query.product.id, provider: this.name, conditionBand: "fair", priceCents: BigInt(Math.round(data.lowCents)), soldAt, sellerKey: "reverb:low" });
    if (typeof data.medianCents === "number" && data.medianCents > 0) comps.push({ productId: query.product.id, provider: this.name, conditionBand: "good", priceCents: BigInt(Math.round(data.medianCents)), soldAt, sellerKey: "reverb:median" });
    if (typeof data.highCents === "number" && data.highCents > 0) comps.push({ productId: query.product.id, provider: this.name, conditionBand: "like_new", priceCents: BigInt(Math.round(data.highCents)), soldAt, sellerKey: "reverb:high" });
    return comps;
  }
}

// ---- Generic T1 scraper-API vendor (gap-filler) ------------------------------------------------

/**
 * A generic licensed "scraper-API" vendor (Apify/SearchAPI/RapidAPI-style, plan §4.1 T1). Unlike the
 * guide providers, this returns *individual* sold transactions, so it carries real seller diversity.
 * Vendor churn is real — configure two behind this same interface (plan §4.1).
 */
export class VendorCompProvider implements CompProvider {
  readonly tier = "T1" as const;
  constructor(
    readonly name: string,
    private readonly transport: Transport,
    private readonly opts: ProviderOptions & { searchPath?: (product: Product) => string } = {},
  ) {}
  supports(categoryId: number): boolean {
    return supportsCategory(this.opts.categories, categoryId);
  }
  async fetchComps(query: CompQuery): Promise<Comp[]> {
    const base = this.opts.baseUrl ?? "https://vendor.example";
    const q = encodeURIComponent(`${query.product.brand ?? ""} ${query.product.model ?? query.product.title}`.trim());
    const path = this.opts.searchPath ? this.opts.searchPath(query.product) : `/sold?q=${q}`;
    const url = `${base}${path}`;
    const res = await this.transport.request({ method: "GET", url, ...(this.opts.apiKey ? { headers: { "x-api-key": this.opts.apiKey } } : {}) });
    const data = parseJson<{ items?: Array<{ priceCents: number; condition?: string; soldDate?: string; seller?: string }> }>(res, url);
    return (data.items ?? [])
      .filter((it) => typeof it.priceCents === "number" && it.priceCents > 0)
      .map((it) => ({
        productId: query.product.id,
        provider: this.name,
        conditionBand: conditionToBand(it.condition ?? "good"),
        priceCents: BigInt(Math.round(it.priceCents)),
        soldAt: it.soldDate ?? isoDate(this.opts.now),
        ...(it.seller ? { sellerKey: it.seller } : {}),
      }));
  }
}
