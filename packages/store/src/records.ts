import type { Cents } from "@flip-desk/money";

/**
 * Persistence read/write records (plan §6). These are the durable projections the UI reads and the
 * pipeline writes — a thin, serialization-friendly shape over the domain objects. Money stays `Cents`
 * (bigint) in the store; the API layer stringifies it at the edge (JSON can't carry bigint).
 */
export type OpportunityStatus = "new" | "approved" | "rejected" | "purchased" | "expired";

export interface OpportunityRecord {
  readonly id: string;
  readonly createdAt: string;
  readonly listingExternalId: string;
  readonly source: string;
  readonly title: string;
  readonly productId?: number;
  readonly valuationP50Cents?: Cents;
  readonly netP50Cents?: Cents;
  readonly cashAtRiskCents?: Cents;
  readonly roi?: number;
  readonly score?: number;
  readonly band?: string;
  readonly taken: boolean;
  readonly identified: boolean;
  readonly riskFlags: readonly string[];
  readonly waterfall?: ReadonlyArray<{ label: string; amountCents: Cents }>;
  status: OpportunityStatus;
}

export type InventoryStatus = "received" | "listed" | "sold" | "returned" | "blocked";

export interface InventoryChannel {
  readonly platform: string;
  readonly externalId: string;
  state: string;
}

export interface InventoryRecord {
  readonly sku: string;
  readonly title: string;
  readonly conditionBand?: string;
  readonly costBasisCents: Cents;
  readonly bin: string;
  status: InventoryStatus;
  listedPriceCents?: Cents;
  soldPriceCents?: Cents;
  readonly channels: InventoryChannel[];
  readonly receivedAt: string;
}

export interface AlertRecord {
  readonly id: string;
  readonly createdAt: string;
  readonly band: string;
  readonly channel: string;
  readonly title: string;
  readonly opportunityId: string;
}

export interface PnlSnapshot {
  readonly revenueCents: Cents;
  readonly cogsCents: Cents;
  readonly feesCents: Cents;
  readonly netProfitCents: Cents;
  readonly inventoryValueCents: Cents;
  readonly flips: number;
}

export type HealthState = "ok" | "degraded" | "halted";

export interface HealthRecord {
  readonly source: string;
  readonly tier: string;
  state: HealthState;
  lastPollAt?: string;
  note?: string;
}
