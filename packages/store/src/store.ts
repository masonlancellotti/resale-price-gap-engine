import type {
  AlertRecord,
  HealthRecord,
  InventoryRecord,
  OpportunityRecord,
  OpportunityStatus,
  PnlSnapshot,
} from "./records.js";

/**
 * The persistence seam (plan §5.3 conventions). Async so a Postgres/pgvector implementation
 * (plan §5.2, docker-compose) drops in behind the same interface; the {@link InMemoryStore} is the
 * default and makes the whole desk runnable — and testable — with no database.
 */
export interface OpportunityFilter {
  readonly status?: OpportunityStatus;
  readonly band?: string;
  readonly takenOnly?: boolean;
}

export interface Store {
  putOpportunity(o: OpportunityRecord): Promise<void>;
  listOpportunities(filter?: OpportunityFilter): Promise<OpportunityRecord[]>;
  getOpportunity(id: string): Promise<OpportunityRecord | undefined>;
  setOpportunityStatus(id: string, status: OpportunityStatus): Promise<OpportunityRecord | undefined>;

  putInventory(i: InventoryRecord): Promise<void>;
  listInventory(): Promise<InventoryRecord[]>;
  getInventory(sku: string): Promise<InventoryRecord | undefined>;
  patchInventory(sku: string, patch: Partial<InventoryRecord>): Promise<InventoryRecord | undefined>;

  putAlert(a: AlertRecord): Promise<void>;
  listAlerts(): Promise<AlertRecord[]>;

  setPnl(p: PnlSnapshot): Promise<void>;
  getPnl(): Promise<PnlSnapshot>;

  putHealth(h: HealthRecord): Promise<void>;
  listHealth(): Promise<HealthRecord[]>;
}

const EMPTY_PNL: PnlSnapshot = {
  revenueCents: 0n,
  cogsCents: 0n,
  feesCents: 0n,
  netProfitCents: 0n,
  inventoryValueCents: 0n,
  flips: 0,
};

/** BAND ordering for the triage feed (push first). */
const BAND_RANK: Record<string, number> = { push: 0, feed: 1, digest: 2, archive: 3 };

export class InMemoryStore implements Store {
  readonly #opps = new Map<string, OpportunityRecord>();
  readonly #inv = new Map<string, InventoryRecord>();
  readonly #alerts: AlertRecord[] = [];
  readonly #health = new Map<string, HealthRecord>();
  #pnl: PnlSnapshot = EMPTY_PNL;

  async putOpportunity(o: OpportunityRecord): Promise<void> {
    this.#opps.set(o.id, o);
  }

  async listOpportunities(filter: OpportunityFilter = {}): Promise<OpportunityRecord[]> {
    let rows = [...this.#opps.values()];
    if (filter.status) rows = rows.filter((r) => r.status === filter.status);
    if (filter.band) rows = rows.filter((r) => r.band === filter.band);
    if (filter.takenOnly) rows = rows.filter((r) => r.taken);
    return rows.sort((a, b) => {
      const bandDiff = (BAND_RANK[a.band ?? "archive"] ?? 9) - (BAND_RANK[b.band ?? "archive"] ?? 9);
      if (bandDiff !== 0) return bandDiff;
      return (b.score ?? 0) - (a.score ?? 0);
    });
  }

  async getOpportunity(id: string): Promise<OpportunityRecord | undefined> {
    return this.#opps.get(id);
  }

  async setOpportunityStatus(id: string, status: OpportunityStatus): Promise<OpportunityRecord | undefined> {
    const o = this.#opps.get(id);
    if (!o) return undefined;
    o.status = status;
    return o;
  }

  async putInventory(i: InventoryRecord): Promise<void> {
    this.#inv.set(i.sku, i);
  }

  async listInventory(): Promise<InventoryRecord[]> {
    return [...this.#inv.values()].sort((a, b) => a.receivedAt.localeCompare(b.receivedAt));
  }

  async getInventory(sku: string): Promise<InventoryRecord | undefined> {
    return this.#inv.get(sku);
  }

  async patchInventory(sku: string, patch: Partial<InventoryRecord>): Promise<InventoryRecord | undefined> {
    const cur = this.#inv.get(sku);
    if (!cur) return undefined;
    const next = { ...cur, ...patch };
    this.#inv.set(sku, next);
    return next;
  }

  async putAlert(a: AlertRecord): Promise<void> {
    this.#alerts.push(a);
  }

  async listAlerts(): Promise<AlertRecord[]> {
    return [...this.#alerts].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async setPnl(p: PnlSnapshot): Promise<void> {
    this.#pnl = p;
  }

  async getPnl(): Promise<PnlSnapshot> {
    return this.#pnl;
  }

  async putHealth(h: HealthRecord): Promise<void> {
    this.#health.set(h.source, h);
  }

  async listHealth(): Promise<HealthRecord[]> {
    return [...this.#health.values()].sort((a, b) => a.source.localeCompare(b.source));
  }
}
