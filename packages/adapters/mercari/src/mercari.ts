import type { Publisher, PublishInput, PublishResult } from "@flip-desk/core";
import type { Cents } from "@flip-desk/money";
import { type HttpMethod, HttpError, parseJson, type Transport } from "@flip-desk/net";

const API_BASE = "https://api.mercari.com";

export interface MercariConfig {
  readonly baseUrl?: string;
  readonly shippingPayerId?: string;
}

export interface MercariTokenProvider {
  getToken(): Promise<string>;
}

export class StaticMercariToken implements MercariTokenProvider {
  constructor(private readonly token: string) {}
  async getToken(): Promise<string> {
    return this.token;
  }
}

/** Integer cents → whole-dollar amount (Mercari lists in USD, no float). */
function centsToWholeDollars(cents: Cents): number {
  return Number(cents / 100n);
}

function mercariCondition(specifics: Record<string, unknown>): string {
  const phrase = String(specifics["Condition"] ?? "").toLowerCase();
  if (phrase.includes("new (sealed)") || phrase === "new") return "new";
  if (phrase.includes("like new")) return "like_new";
  if (phrase.includes("fair") || phrase.includes("parts")) return "poor";
  return "good";
}

/**
 * Mercari exit publisher (plan §4.3, §16 Phase 4). Second automation-anchor exit channel next to
 * eBay; `end` delists on a sale elsewhere (delist saga §10.4). Brand-first casual copy is produced by
 * the Lister; this just transmits it. Honest condition mapping — returns cost more than clicks.
 */
export class MercariPublisher implements Publisher {
  readonly platform = "mercari";
  readonly tier = "T0" as const;

  constructor(
    private readonly transport: Transport,
    private readonly tokens: MercariTokenProvider,
    private readonly cfg: MercariConfig = {},
  ) {}

  private get base(): string {
    return this.cfg.baseUrl ?? API_BASE;
  }

  private async call<T>(method: HttpMethod, path: string, body?: unknown): Promise<T> {
    const url = `${this.base}${path}`;
    const token = await this.tokens.getToken();
    const res = await this.transport.request({
      method,
      url,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json" },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    if (res.status >= 400) throw new HttpError(res.status, url, res.body);
    return res.body ? parseJson<T>(res, url) : ({} as T);
  }

  async publish(input: PublishInput): Promise<PublishResult> {
    const created = await this.call<{ id: string }>("POST", `/v1/listings`, {
      name: input.title.slice(0, 80),
      description: input.description,
      price: centsToWholeDollars(input.priceCents),
      condition: mercariCondition(input.specifics),
      photos: input.photoKeys,
      itemAttributes: input.specifics,
      referenceKey: input.idempotencyKey, // dedup on retries
      ...(this.cfg.shippingPayerId ? { shippingPayerId: this.cfg.shippingPayerId } : {}),
    });
    return { externalId: created.id, url: `https://www.mercari.com/us/item/${created.id}/` };
  }

  async end(listingId: string): Promise<void> {
    await this.call("DELETE", `/v1/listings/${encodeURIComponent(listingId)}`);
  }
}
