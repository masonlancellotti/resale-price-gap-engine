import { type Cents, formatCents } from "@flip-desk/money";
import type {
  AlertRecord,
  HealthRecord,
  InventoryRecord,
  OpportunityRecord,
  PnlSnapshot,
} from "@flip-desk/store";

/**
 * JSON-safe DTOs for the UI (plan §14). The store keeps money as `Cents` (bigint); the wire can't
 * carry bigint, so every amount crosses the edge as {@link Money} — the raw cents string for exactness
 * plus a pre-formatted display string so the UI never does currency math (P4 stays server-side).
 */
export interface Money {
  readonly cents: string;
  readonly display: string;
}

export function money(c: Cents): Money {
  return { cents: c.toString(), display: formatCents(c) };
}

function maybeMoney(c: Cents | undefined): Money | undefined {
  return c === undefined ? undefined : money(c);
}

export interface OpportunityDTO {
  readonly id: string;
  readonly createdAt: string;
  readonly source: string;
  readonly title: string;
  readonly productId?: number;
  readonly band?: string;
  readonly score?: number;
  readonly status: string;
  readonly taken: boolean;
  readonly identified: boolean;
  readonly roi?: number;
  readonly valuationP50?: Money;
  readonly netP50?: Money;
  readonly cashAtRisk?: Money;
  readonly riskFlags: readonly string[];
  readonly waterfall?: ReadonlyArray<{ label: string; amount: Money }>;
}

export function toOpportunityDTO(r: OpportunityRecord): OpportunityDTO {
  return {
    id: r.id,
    createdAt: r.createdAt,
    source: r.source,
    title: r.title,
    ...(r.productId !== undefined ? { productId: r.productId } : {}),
    ...(r.band !== undefined ? { band: r.band } : {}),
    ...(r.score !== undefined ? { score: Math.round(r.score) } : {}),
    status: r.status,
    taken: r.taken,
    identified: r.identified,
    ...(r.roi !== undefined ? { roi: r.roi } : {}),
    ...(maybeMoney(r.valuationP50Cents) ? { valuationP50: money(r.valuationP50Cents!) } : {}),
    ...(maybeMoney(r.netP50Cents) ? { netP50: money(r.netP50Cents!) } : {}),
    ...(maybeMoney(r.cashAtRiskCents) ? { cashAtRisk: money(r.cashAtRiskCents!) } : {}),
    riskFlags: r.riskFlags,
    ...(r.waterfall ? { waterfall: r.waterfall.map((w) => ({ label: w.label, amount: money(w.amountCents) })) } : {}),
  };
}

export interface InventoryDTO {
  readonly sku: string;
  readonly title: string;
  readonly conditionBand?: string;
  readonly bin: string;
  readonly status: string;
  readonly costBasis: Money;
  readonly listedPrice?: Money;
  readonly soldPrice?: Money;
  readonly channels: ReadonlyArray<{ platform: string; state: string }>;
}

export function toInventoryDTO(r: InventoryRecord): InventoryDTO {
  return {
    sku: r.sku,
    title: r.title,
    ...(r.conditionBand !== undefined ? { conditionBand: r.conditionBand } : {}),
    bin: r.bin,
    status: r.status,
    costBasis: money(r.costBasisCents),
    ...(maybeMoney(r.listedPriceCents) ? { listedPrice: money(r.listedPriceCents!) } : {}),
    ...(maybeMoney(r.soldPriceCents) ? { soldPrice: money(r.soldPriceCents!) } : {}),
    channels: r.channels.map((c) => ({ platform: c.platform, state: c.state })),
  };
}

export interface PnlDTO {
  readonly revenue: Money;
  readonly cogs: Money;
  readonly fees: Money;
  readonly netProfit: Money;
  readonly inventoryValue: Money;
  readonly flips: number;
}

export function toPnlDTO(p: PnlSnapshot): PnlDTO {
  return {
    revenue: money(p.revenueCents),
    cogs: money(p.cogsCents),
    fees: money(p.feesCents),
    netProfit: money(p.netProfitCents),
    inventoryValue: money(p.inventoryValueCents),
    flips: p.flips,
  };
}

export interface AlertDTO {
  readonly id: string;
  readonly createdAt: string;
  readonly band: string;
  readonly channel: string;
  readonly title: string;
  readonly opportunityId: string;
}

export function toAlertDTO(a: AlertRecord): AlertDTO {
  return { id: a.id, createdAt: a.createdAt, band: a.band, channel: a.channel, title: a.title, opportunityId: a.opportunityId };
}

export interface HealthDTO {
  readonly source: string;
  readonly tier: string;
  readonly state: string;
  readonly lastPollAt?: string;
  readonly note?: string;
}

export function toHealthDTO(h: HealthRecord): HealthDTO {
  return {
    source: h.source,
    tier: h.tier,
    state: h.state,
    ...(h.lastPollAt !== undefined ? { lastPollAt: h.lastPollAt } : {}),
    ...(h.note !== undefined ? { note: h.note } : {}),
  };
}
