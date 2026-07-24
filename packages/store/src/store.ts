import type {
  AlertRecord,
  HealthRecord,
  InventoryRecord,
  OpportunityRecord,
  OpportunityStatus,
  PnlSnapshot,
} from "./records.js";
import {
  applyOpportunityFilter,
  EMPTY_PNL,
  sortAlerts,
  sortHealth,
  sortInventory,
} from "./query.js";

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
    return applyOpportunityFilter([...this.#opps.values()], filter);
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
    return sortInventory([...this.#inv.values()]);
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
    return sortAlerts([...this.#alerts]);
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
    return sortHealth([...this.#health.values()]);
  }
}
