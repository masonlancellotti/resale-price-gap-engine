import type { Cents } from "@flip-desk/money";
import {
  FakeShippingProvider,
  type LabelRequest,
  type ShippingLabel,
  type ShippingProvider,
  type TrackingProvider,
  type TrackingState,
} from "./shipping.js";

export interface ShipmentRecord {
  readonly sku: string;
  readonly trackingNumber: string;
  readonly carrier: string;
  readonly service: string;
  readonly labelCostCents: Cents;
  readonly shippedAt: string;
  state: TrackingState;
}

export interface ReturnRequest {
  readonly sku: string;
  readonly saleGrossCents: Cents;
  readonly reason: string;
  readonly restockable: boolean;
}

export interface ReturnRecord {
  readonly sku: string;
  readonly reason: string;
  readonly refundCents: Cents;
  readonly restockable: boolean;
  readonly receivedAt: string;
}

export interface OpsOptions {
  readonly shipping?: ShippingProvider;
  readonly tracking?: TrackingProvider;
  readonly now?: () => Date;
}

/**
 * Ops (plan §5.3, §8.8): buys shipping labels, tracks packages, and processes returns. Label buys are
 * real money, so `fulfill` is idempotent per SKU — calling it twice reuses the first label rather
 * than double-paying (the outbox discipline of plan §5.4 applied to the physical side).
 */
export class Ops {
  readonly #shipments = new Map<string, ShipmentRecord>();
  private readonly shipping: ShippingProvider;
  private readonly tracking: TrackingProvider | undefined;
  private readonly now: () => Date;

  constructor(opts: OpsOptions = {}) {
    this.shipping = opts.shipping ?? new FakeShippingProvider();
    this.tracking = opts.tracking;
    this.now = opts.now ?? (() => new Date());
  }

  async fulfill(req: LabelRequest): Promise<ShipmentRecord> {
    const existing = this.#shipments.get(req.sku);
    if (existing) return existing; // idempotent: never buy a second label for the same SKU

    const label: ShippingLabel = await this.shipping.buyLabel(req);
    const record: ShipmentRecord = {
      sku: req.sku,
      trackingNumber: label.trackingNumber,
      carrier: label.carrier,
      service: label.service,
      labelCostCents: label.costCents,
      shippedAt: this.now().toISOString(),
      state: "label_created",
    };
    this.#shipments.set(req.sku, record);
    return record;
  }

  async refreshTracking(sku: string): Promise<TrackingState | undefined> {
    const rec = this.#shipments.get(sku);
    if (!rec || !this.tracking) return rec?.state;
    rec.state = await this.tracking.track(rec.trackingNumber);
    return rec.state;
  }

  handleReturn(req: ReturnRequest): ReturnRecord {
    return {
      sku: req.sku,
      reason: req.reason,
      refundCents: req.saleGrossCents,
      restockable: req.restockable,
      receivedAt: this.now().toISOString(),
    };
  }

  shipment(sku: string): ShipmentRecord | undefined {
    return this.#shipments.get(sku);
  }
}
