import type { Publisher, PublishInput, PublishResult } from "@flip-desk/core";
import { type Cents, dollarsToCents } from "@flip-desk/money";
import { type HttpMethod, HttpError, parseJson, type Transport } from "@flip-desk/net";
import type { AccessTokenProvider } from "./token.js";

const API_BASE = "https://api.ebay.com";

export interface EbaySellConfig {
  readonly baseUrl?: string;
  readonly marketplaceId?: string; // EBAY_US
  readonly currency?: string; // USD
  readonly categoryId?: string;
  readonly merchantLocationKey?: string;
  readonly fulfillmentPolicyId?: string;
  readonly paymentPolicyId?: string;
  readonly returnPolicyId?: string;
}

export interface FinanceTransaction {
  readonly type: string;
  readonly amountCents: Cents;
  readonly feeType?: string;
}

/** eBay item-condition enum keyed off the honest condition phrase our Lister writes (plan §8.7). */
function conditionEnum(specifics: Record<string, unknown>): string {
  const phrase = String(specifics["Condition"] ?? "").toLowerCase();
  if (phrase.includes("new (sealed)") || phrase === "new") return "NEW";
  if (phrase.includes("like new")) return "LIKE_NEW";
  if (phrase.includes("parts")) return "FOR_PARTS_OR_NOT_WORKING";
  if (phrase.includes("fair")) return "USED_ACCEPTABLE";
  return "USED_GOOD";
}

function toAspects(specifics: Record<string, unknown>): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(specifics)) {
    if (k === "Condition") continue;
    out[k] = [String(v)];
  }
  return out;
}

/** Integer-cents → eBay "12.34" amount string, sign-aware, no float. */
export function centsToAmount(cents: Cents): string {
  const neg = cents < 0n;
  const abs = neg ? -cents : cents;
  return `${neg ? "-" : ""}${abs / 100n}.${(abs % 100n).toString().padStart(2, "0")}`;
}

/** eBay amount string → cents (fees come back negative). */
export function amountToCents(value: string): Cents {
  const neg = value.trim().startsWith("-");
  const cents = dollarsToCents(value.replace(/^-/, "").trim());
  return neg ? -cents : cents;
}

/**
 * eBay Sell publisher (plan §4.3, §8.7): the automation anchor exit channel. `publish` runs the
 * Inventory→Offer→Publish sequence (inventory PUT is idempotent on SKU); `end` withdraws the offer —
 * that's what the delist saga (§10.4) calls on a sale elsewhere. Also exposes Finances (fee/payout
 * reconciliation → Bookkeeper §8.9) and Fulfillment (tracking upload).
 */
export class EbaySellPublisher implements Publisher {
  readonly platform = "ebay";
  readonly tier = "T0" as const;

  constructor(
    private readonly transport: Transport,
    private readonly tokens: AccessTokenProvider,
    private readonly cfg: EbaySellConfig = {},
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
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "content-language": "en-US",
        accept: "application/json",
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    if (res.status >= 400) throw new HttpError(res.status, url, res.body);
    return res.body ? parseJson<T>(res, url) : ({} as T);
  }

  async publish(input: PublishInput): Promise<PublishResult> {
    const sku = input.idempotencyKey; // stable, unique → idempotent inventory upsert

    await this.call("PUT", `/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}`, {
      product: {
        title: input.title,
        description: input.description,
        aspects: toAspects(input.specifics),
        imageUrls: input.photoKeys,
      },
      condition: conditionEnum(input.specifics),
      availability: { shipToLocationAvailability: { quantity: 1 } },
    });

    const offer = await this.call<{ offerId: string }>("POST", `/sell/inventory/v1/offer`, {
      sku,
      marketplaceId: this.cfg.marketplaceId ?? "EBAY_US",
      format: "FIXED_PRICE",
      availableQuantity: 1,
      listingDescription: input.description,
      pricingSummary: { price: { value: centsToAmount(input.priceCents), currency: this.cfg.currency ?? "USD" } },
      ...(this.cfg.categoryId ? { categoryId: this.cfg.categoryId } : {}),
      ...(this.cfg.merchantLocationKey ? { merchantLocationKey: this.cfg.merchantLocationKey } : {}),
      listingPolicies: {
        ...(this.cfg.fulfillmentPolicyId ? { fulfillmentPolicyId: this.cfg.fulfillmentPolicyId } : {}),
        ...(this.cfg.paymentPolicyId ? { paymentPolicyId: this.cfg.paymentPolicyId } : {}),
        ...(this.cfg.returnPolicyId ? { returnPolicyId: this.cfg.returnPolicyId } : {}),
      },
    });

    const published = await this.call<{ listingId: string }>(
      "POST",
      `/sell/inventory/v1/offer/${encodeURIComponent(offer.offerId)}/publish`,
    );
    return { externalId: offer.offerId, url: `https://www.ebay.com/itm/${published.listingId}` };
  }

  /** Delist: withdraw the published offer (called by the delist saga on a sale elsewhere). */
  async end(offerId: string): Promise<void> {
    await this.call("POST", `/sell/inventory/v1/offer/${encodeURIComponent(offerId)}/withdraw`);
  }

  /** Finances (fees & payouts) for ledger reconciliation. */
  async finances(filter?: string): Promise<FinanceTransaction[]> {
    const q = filter ? `?filter=${encodeURIComponent(filter)}` : "";
    const json = await this.call<{
      transactions?: Array<{ transactionType: string; amount: { value: string }; feeType?: string }>;
    }>("GET", `/sell/finances/v1/transaction${q}`);
    return (json.transactions ?? []).map((t) => ({
      type: t.transactionType,
      amountCents: amountToCents(t.amount.value),
      ...(t.feeType ? { feeType: t.feeType } : {}),
    }));
  }

  /** Upload tracking so eBay marks the order shipped (plan §8.8 Ops). */
  async createShippingFulfillment(
    orderId: string,
    f: { trackingNumber: string; carrier: string; lineItemIds: readonly string[] },
  ): Promise<string> {
    const json = await this.call<{ fulfillmentId?: string }>(
      "POST",
      `/sell/fulfillment/v1/order/${encodeURIComponent(orderId)}/shipping_fulfillment`,
      {
        lineItems: f.lineItemIds.map((id) => ({ lineItemId: id, quantity: 1 })),
        trackingNumber: f.trackingNumber,
        shippingCarrierCode: f.carrier,
      },
    );
    return json.fulfillmentId ?? "fulfilled";
  }
}
