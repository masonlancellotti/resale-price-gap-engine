import type { Comp, CompProvider, CompQuery, ConditionBand, Product } from "@flip-desk/core";
import { parseJson, type Transport } from "@flip-desk/net";

/**
 * Comp providers (plan §4.1). Each turns a canonical {@link Product} into normalized sold {@link Comp}
 * rows tagged with provenance, over the {@link Transport} seam so they're testable offline. The
 * {@link CompRouter} does per-category routing (games→PriceCharting, Amazon→Keepa, general→Terapeak).
 */
export interface ProviderOptions {
  readonly baseUrl?: string;
  readonly apiKey?: string;
  readonly now?: () => Date;
  readonly categories?: readonly number[];
}

function isoDate(now?: () => Date): string {
  return (now ? now() : new Date()).toISOString().slice(0, 10);
}

function supportsCategory(categories: readonly number[] | undefined, categoryId: number): boolean {
  return !categories || categories.length === 0 || categories.includes(categoryId);
}

// ---- PriceCharting: games/consoles/cards price guide (plan §4.1 core) ---------------------------

function priceChartingId(p: Product): string | undefined {
  const pcid = p.identifiers?.["pcid"];
  if (typeof pcid === "string") return pcid;
  if (typeof pcid === "number") return String(pcid);
  const m = /^pcid:(.+)$/.exec(p.canonicalKey);
  return m ? m[1] : undefined;
}

export class PriceChartingProvider implements CompProvider {
  readonly name = "pricecharting";
  readonly tier = "T0" as const;

  constructor(
    private readonly transport: Transport,
    private readonly opts: ProviderOptions = {},
  ) {}

  supports(categoryId: number): boolean {
    return supportsCategory(this.opts.categories, categoryId);
  }

  async fetchComps(query: CompQuery): Promise<Comp[]> {
    const id = priceChartingId(query.product);
    if (!id) return [];
    const base = this.opts.baseUrl ?? "https://www.pricecharting.com";
    const url = `${base}/api/product?t=${this.opts.apiKey ?? ""}&id=${encodeURIComponent(id)}`;
    const res = await this.transport.request({ method: "GET", url });
    const data = parseJson<Record<string, unknown>>(res, url);
    const soldAt = isoDate(this.opts.now);

    const comps: Comp[] = [];
    const add = (band: ConditionBand, key: string, completeness: Comp["completeness"]): void => {
      const v = data[key];
      if (typeof v === "number" && v > 0) {
        comps.push({
          productId: query.product.id,
          provider: this.name,
          conditionBand: band,
          priceCents: BigInt(Math.round(v)),
          soldAt,
          sellerKey: `pricecharting:${key}`,
          ...(completeness ? { completeness } : {}),
        });
      }
    };
    add("good", "loose-price", "item_only");
    add("like_new", "cib-price", "complete");
    add("new", "new-price", "sealed");
    return comps;
  }
}

// ---- Keepa: Amazon price history as proxy comps (plan §4.1) -------------------------------------

export class KeepaProvider implements CompProvider {
  readonly name = "keepa";
  readonly tier = "T0" as const;

  constructor(
    private readonly transport: Transport,
    private readonly opts: ProviderOptions = {},
  ) {}

  supports(categoryId: number): boolean {
    return supportsCategory(this.opts.categories, categoryId);
  }

  async fetchComps(query: CompQuery): Promise<Comp[]> {
    const asin = query.product.identifiers?.["asin"];
    if (typeof asin !== "string") return [];
    const base = this.opts.baseUrl ?? "https://api.keepa.com";
    const url = `${base}/product?key=${this.opts.apiKey ?? ""}&asin=${encodeURIComponent(asin)}`;
    const res = await this.transport.request({ method: "GET", url });
    const data = parseJson<{ avg30Cents?: number; newCents?: number }>(res, url);
    const soldAt = isoDate(this.opts.now);
    const comps: Comp[] = [];
    if (typeof data.avg30Cents === "number" && data.avg30Cents > 0) {
      comps.push({ productId: query.product.id, provider: this.name, conditionBand: "new", priceCents: BigInt(Math.round(data.avg30Cents)), soldAt, sellerKey: "keepa:avg30", completeness: "sealed" });
    }
    return comps;
  }
}

// ---- Terapeak: eBay sold data via export cache, no API (plan §4.1 core, T2) ---------------------

/** In-memory cache filled by the weekly guided Terapeak export sessions (plan §4.1). */
export class TerapeakCache {
  #byProduct = new Map<number, Comp[]>();

  put(productId: number, comps: readonly Comp[]): void {
    this.#byProduct.set(productId, [...comps]);
  }
  get(productId: number): Comp[] {
    return this.#byProduct.get(productId) ?? [];
  }
  get size(): number {
    return this.#byProduct.size;
  }
}

export class TerapeakCacheProvider implements CompProvider {
  readonly name = "terapeak";
  readonly tier = "T2" as const;

  constructor(
    private readonly cache: TerapeakCache,
    private readonly opts: Pick<ProviderOptions, "categories"> = {},
  ) {}

  supports(categoryId: number): boolean {
    return supportsCategory(this.opts.categories, categoryId);
  }

  async fetchComps(query: CompQuery): Promise<Comp[]> {
    return this.cache.get(query.product.id);
  }
}
