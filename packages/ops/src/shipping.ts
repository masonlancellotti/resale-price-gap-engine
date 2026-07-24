import type { Cents } from "@flip-desk/money";

/** Carrier/label seam (plan §8.8 Ops). Real impl = EasyPost/Shippo/eBay labels; here a deterministic Fake. */
export interface LabelRequest {
  readonly sku: string;
  readonly fromZip: string;
  readonly toZip: string;
  readonly weightOz: number;
  readonly service?: string;
}

export interface ShippingLabel {
  readonly trackingNumber: string;
  readonly carrier: string;
  readonly service: string;
  readonly costCents: Cents;
  readonly labelUrl?: string;
}

export interface ShippingProvider {
  buyLabel(req: LabelRequest): Promise<ShippingLabel>;
}

export type TrackingState = "label_created" | "in_transit" | "delivered" | "returned" | "exception";

export interface TrackingProvider {
  track(trackingNumber: string): Promise<TrackingState>;
}

/** Deterministic label pricing: $4.00 base + $0.08/oz. Tracking numbers are stable per SKU. */
export class FakeShippingProvider implements ShippingProvider {
  #seq = 0;
  async buyLabel(req: LabelRequest): Promise<ShippingLabel> {
    this.#seq += 1;
    const costCents = 400n + BigInt(Math.round(req.weightOz)) * 8n;
    return {
      trackingNumber: `TRK${req.sku}-${String(this.#seq).padStart(3, "0")}`,
      carrier: "USPS",
      service: req.service ?? "Ground Advantage",
      costCents,
      labelUrl: `label://${req.sku}`,
    };
  }
}

export class FakeTrackingProvider implements TrackingProvider {
  constructor(private readonly states: Readonly<Record<string, TrackingState>> = {}) {}
  async track(trackingNumber: string): Promise<TrackingState> {
    return this.states[trackingNumber] ?? "in_transit";
  }
}
