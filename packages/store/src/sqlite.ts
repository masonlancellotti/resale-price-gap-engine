import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import type { Cents } from "@flip-desk/money";
import {
  applyOpportunityFilter,
  EMPTY_PNL,
  sortAlerts,
  sortHealth,
  sortInventory,
} from "./query.js";
import type {
  AlertRecord,
  HealthRecord,
  InventoryChannel,
  InventoryRecord,
  OpportunityRecord,
  OpportunityStatus,
  PnlSnapshot,
} from "./records.js";
import type { OpportunityFilter, Store } from "./store.js";

/**
 * SQLite persistence behind the async {@link Store} seam (V2 WS1). `better-sqlite3` is a *synchronous*
 * driver — every call returns immediately — which we wrap in the async interface so the rest of the
 * desk is agnostic to whether it is talking to the in-memory map, SQLite, or (in production) Postgres.
 * Money stays exact: cents are `bigint`, persisted as decimal TEXT and parsed back with `BigInt()`, so
 * no currency value ever passes through a float.
 */

/**
 * Repo-root db/sqlite directory, resolved from this module (works from src and from dist). Built with
 * path ops rather than `new URL('../…', import.meta.url)` so bundlers don't treat it as an asset ref.
 */
const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "db", "sqlite");

export interface AppliedMigration {
  readonly name: string;
  readonly sha256: string;
}

/**
 * Apply every `db/sqlite/*.sql` file (lexicographic order) that has not run yet, recording each in a
 * `_migrations` table with its content hash. Idempotent: re-running is a no-op. Returns the files
 * applied on this call.
 */
export function runMigrations(db: Database.Database, dir: string = MIGRATIONS_DIR): AppliedMigration[] {
  db.exec(
    `create table if not exists _migrations (
       name       text primary key,
       applied_at text not null,
       sha256     text not null
     )`,
  );
  const done = new Set(
    (db.prepare("select name from _migrations").all() as { name: string }[]).map((r) => r.name),
  );
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  const insert = db.prepare("insert into _migrations (name, applied_at, sha256) values (?, ?, ?)");
  const applied: AppliedMigration[] = [];
  for (const name of files) {
    if (done.has(name)) continue;
    const sql = readFileSync(join(dir, name), "utf8");
    const sha256 = createHash("sha256").update(sql).digest("hex");
    db.transaction(() => {
      db.exec(sql);
      insert.run(name, new Date().toISOString(), sha256);
    })();
    applied.push({ name, sha256 });
  }
  return applied;
}

/** cents (bigint) <-> decimal TEXT, exactly. */
const centsToText = (c: Cents): string => c.toString();
const textToCents = (t: string): Cents => BigInt(t);
const maybeText = (c: Cents | undefined): string | null => (c === undefined ? null : centsToText(c));

function rowToOpportunity(r: Record<string, unknown>): OpportunityRecord {
  return {
    id: r.id as string,
    createdAt: r.created_at as string,
    listingExternalId: r.listing_external_id as string,
    source: r.source as string,
    title: r.title as string,
    ...(r.product_id != null ? { productId: Number(r.product_id) } : {}),
    ...(r.valuation_p50_cents != null ? { valuationP50Cents: textToCents(r.valuation_p50_cents as string) } : {}),
    ...(r.valuation_p10_cents != null ? { valuationP10Cents: textToCents(r.valuation_p10_cents as string) } : {}),
    ...(r.valuation_p90_cents != null ? { valuationP90Cents: textToCents(r.valuation_p90_cents as string) } : {}),
    ...(r.net_p50_cents != null ? { netP50Cents: textToCents(r.net_p50_cents as string) } : {}),
    ...(r.cash_at_risk_cents != null ? { cashAtRiskCents: textToCents(r.cash_at_risk_cents as string) } : {}),
    ...(r.roi != null ? { roi: Number(r.roi) } : {}),
    ...(r.score != null ? { score: Number(r.score) } : {}),
    ...(r.band != null ? { band: r.band as string } : {}),
    taken: r.taken === 1,
    identified: r.identified === 1,
    riskFlags: JSON.parse(r.risk_flags as string) as string[],
    ...(r.waterfall != null
      ? {
          waterfall: (JSON.parse(r.waterfall as string) as { label: string; amountCents: string }[]).map((w) => ({
            label: w.label,
            amountCents: textToCents(w.amountCents),
          })),
        }
      : {}),
    status: r.status as OpportunityStatus,
  };
}

function rowToInventory(r: Record<string, unknown>): InventoryRecord {
  return {
    sku: r.sku as string,
    title: r.title as string,
    ...(r.condition_band != null ? { conditionBand: r.condition_band as string } : {}),
    costBasisCents: textToCents(r.cost_basis_cents as string),
    bin: r.bin as string,
    status: r.status as InventoryRecord["status"],
    ...(r.listed_price_cents != null ? { listedPriceCents: textToCents(r.listed_price_cents as string) } : {}),
    ...(r.sold_price_cents != null ? { soldPriceCents: textToCents(r.sold_price_cents as string) } : {}),
    channels: JSON.parse(r.channels as string) as InventoryChannel[],
    receivedAt: r.received_at as string,
  };
}

export interface SqliteStoreOptions {
  readonly migrationsDir?: string;
}

export class SqliteStore implements Store {
  readonly #db: Database.Database;

  constructor(pathOrDb: string | Database.Database, opts: SqliteStoreOptions = {}) {
    this.#db = typeof pathOrDb === "string" ? new Database(pathOrDb) : pathOrDb;
    this.#db.pragma("journal_mode = WAL");
    runMigrations(this.#db, opts.migrationsDir ?? MIGRATIONS_DIR);
  }

  /** Underlying handle — closing releases the file (WAL checkpoints on close). */
  get db(): Database.Database {
    return this.#db;
  }

  close(): void {
    this.#db.close();
  }

  async putOpportunity(o: OpportunityRecord): Promise<void> {
    // ON CONFLICT ... DO UPDATE (not INSERT OR REPLACE) preserves rowid, so an update keeps the
    // record's original feed position — matching Map.set() semantics on an existing key.
    this.#db
      .prepare(
        `insert into opportunity
           (id, created_at, listing_external_id, source, title, product_id,
            valuation_p50_cents, valuation_p10_cents, valuation_p90_cents,
            net_p50_cents, cash_at_risk_cents, roi, score, band,
            taken, identified, risk_flags, waterfall, status)
         values
           (@id, @created_at, @listing_external_id, @source, @title, @product_id,
            @valuation_p50_cents, @valuation_p10_cents, @valuation_p90_cents,
            @net_p50_cents, @cash_at_risk_cents, @roi, @score, @band,
            @taken, @identified, @risk_flags, @waterfall, @status)
         on conflict(id) do update set
            created_at = excluded.created_at,
            listing_external_id = excluded.listing_external_id,
            source = excluded.source,
            title = excluded.title,
            product_id = excluded.product_id,
            valuation_p50_cents = excluded.valuation_p50_cents,
            valuation_p10_cents = excluded.valuation_p10_cents,
            valuation_p90_cents = excluded.valuation_p90_cents,
            net_p50_cents = excluded.net_p50_cents,
            cash_at_risk_cents = excluded.cash_at_risk_cents,
            roi = excluded.roi,
            score = excluded.score,
            band = excluded.band,
            taken = excluded.taken,
            identified = excluded.identified,
            risk_flags = excluded.risk_flags,
            waterfall = excluded.waterfall,
            status = excluded.status`,
      )
      .run({
        id: o.id,
        created_at: o.createdAt,
        listing_external_id: o.listingExternalId,
        source: o.source,
        title: o.title,
        product_id: o.productId ?? null,
        valuation_p50_cents: maybeText(o.valuationP50Cents),
        valuation_p10_cents: maybeText(o.valuationP10Cents),
        valuation_p90_cents: maybeText(o.valuationP90Cents),
        net_p50_cents: maybeText(o.netP50Cents),
        cash_at_risk_cents: maybeText(o.cashAtRiskCents),
        roi: o.roi ?? null,
        score: o.score ?? null,
        band: o.band ?? null,
        taken: o.taken ? 1 : 0,
        identified: o.identified ? 1 : 0,
        risk_flags: JSON.stringify(o.riskFlags),
        waterfall: o.waterfall
          ? JSON.stringify(o.waterfall.map((w) => ({ label: w.label, amountCents: centsToText(w.amountCents) })))
          : null,
        status: o.status,
      });
  }

  async listOpportunities(filter: OpportunityFilter = {}): Promise<OpportunityRecord[]> {
    const rows = this.#db.prepare("select * from opportunity order by rowid").all() as Record<string, unknown>[];
    return applyOpportunityFilter(rows.map(rowToOpportunity), filter);
  }

  async getOpportunity(id: string): Promise<OpportunityRecord | undefined> {
    const r = this.#db.prepare("select * from opportunity where id = ?").get(id) as Record<string, unknown> | undefined;
    return r ? rowToOpportunity(r) : undefined;
  }

  async setOpportunityStatus(id: string, status: OpportunityStatus): Promise<OpportunityRecord | undefined> {
    const info = this.#db.prepare("update opportunity set status = ? where id = ?").run(status, id);
    if (info.changes === 0) return undefined;
    return this.getOpportunity(id);
  }

  async putInventory(i: InventoryRecord): Promise<void> {
    this.#db
      .prepare(
        `insert into inventory
           (sku, title, condition_band, cost_basis_cents, bin, status,
            listed_price_cents, sold_price_cents, channels, received_at)
         values
           (@sku, @title, @condition_band, @cost_basis_cents, @bin, @status,
            @listed_price_cents, @sold_price_cents, @channels, @received_at)
         on conflict(sku) do update set
            title = excluded.title,
            condition_band = excluded.condition_band,
            cost_basis_cents = excluded.cost_basis_cents,
            bin = excluded.bin,
            status = excluded.status,
            listed_price_cents = excluded.listed_price_cents,
            sold_price_cents = excluded.sold_price_cents,
            channels = excluded.channels,
            received_at = excluded.received_at`,
      )
      .run({
        sku: i.sku,
        title: i.title,
        condition_band: i.conditionBand ?? null,
        cost_basis_cents: centsToText(i.costBasisCents),
        bin: i.bin,
        status: i.status,
        listed_price_cents: maybeText(i.listedPriceCents),
        sold_price_cents: maybeText(i.soldPriceCents),
        channels: JSON.stringify(i.channels),
        received_at: i.receivedAt,
      });
  }

  async listInventory(): Promise<InventoryRecord[]> {
    const rows = this.#db.prepare("select * from inventory order by rowid").all() as Record<string, unknown>[];
    return sortInventory(rows.map(rowToInventory));
  }

  async getInventory(sku: string): Promise<InventoryRecord | undefined> {
    const r = this.#db.prepare("select * from inventory where sku = ?").get(sku) as Record<string, unknown> | undefined;
    return r ? rowToInventory(r) : undefined;
  }

  async patchInventory(sku: string, patch: Partial<InventoryRecord>): Promise<InventoryRecord | undefined> {
    const cur = await this.getInventory(sku);
    if (!cur) return undefined;
    const next = { ...cur, ...patch };
    await this.putInventory(next);
    return next;
  }

  async putAlert(a: AlertRecord): Promise<void> {
    this.#db
      .prepare(
        `insert into alert (id, created_at, band, channel, title, opportunity_id)
         values (@id, @created_at, @band, @channel, @title, @opportunity_id)
         on conflict(id) do update set
            created_at = excluded.created_at,
            band = excluded.band,
            channel = excluded.channel,
            title = excluded.title,
            opportunity_id = excluded.opportunity_id`,
      )
      .run({
        id: a.id,
        created_at: a.createdAt,
        band: a.band,
        channel: a.channel,
        title: a.title,
        opportunity_id: a.opportunityId,
      });
  }

  async listAlerts(): Promise<AlertRecord[]> {
    const rows = this.#db.prepare("select * from alert order by rowid").all() as Record<string, unknown>[];
    return sortAlerts(
      rows.map((r) => ({
        id: r.id as string,
        createdAt: r.created_at as string,
        band: r.band as string,
        channel: r.channel as string,
        title: r.title as string,
        opportunityId: r.opportunity_id as string,
      })),
    );
  }

  async setPnl(p: PnlSnapshot): Promise<void> {
    this.#db
      .prepare(
        `insert into pnl (id, revenue_cents, cogs_cents, fees_cents, net_profit_cents, inventory_value_cents, flips)
         values (1, @revenue, @cogs, @fees, @net, @inv, @flips)
         on conflict(id) do update set
            revenue_cents = excluded.revenue_cents,
            cogs_cents = excluded.cogs_cents,
            fees_cents = excluded.fees_cents,
            net_profit_cents = excluded.net_profit_cents,
            inventory_value_cents = excluded.inventory_value_cents,
            flips = excluded.flips`,
      )
      .run({
        revenue: centsToText(p.revenueCents),
        cogs: centsToText(p.cogsCents),
        fees: centsToText(p.feesCents),
        net: centsToText(p.netProfitCents),
        inv: centsToText(p.inventoryValueCents),
        flips: p.flips,
      });
  }

  async getPnl(): Promise<PnlSnapshot> {
    const r = this.#db.prepare("select * from pnl where id = 1").get() as Record<string, unknown> | undefined;
    if (!r) return EMPTY_PNL;
    return {
      revenueCents: textToCents(r.revenue_cents as string),
      cogsCents: textToCents(r.cogs_cents as string),
      feesCents: textToCents(r.fees_cents as string),
      netProfitCents: textToCents(r.net_profit_cents as string),
      inventoryValueCents: textToCents(r.inventory_value_cents as string),
      flips: Number(r.flips),
    };
  }

  async putHealth(h: HealthRecord): Promise<void> {
    this.#db
      .prepare(
        `insert into health (source, tier, state, last_poll_at, note)
         values (@source, @tier, @state, @last_poll_at, @note)
         on conflict(source) do update set
            tier = excluded.tier,
            state = excluded.state,
            last_poll_at = excluded.last_poll_at,
            note = excluded.note`,
      )
      .run({
        source: h.source,
        tier: h.tier,
        state: h.state,
        last_poll_at: h.lastPollAt ?? null,
        note: h.note ?? null,
      });
  }

  async listHealth(): Promise<HealthRecord[]> {
    const rows = this.#db.prepare("select * from health").all() as Record<string, unknown>[];
    return sortHealth(
      rows.map((r) => ({
        source: r.source as string,
        tier: r.tier as string,
        state: r.state as HealthRecord["state"],
        ...(r.last_poll_at != null ? { lastPollAt: r.last_poll_at as string } : {}),
        ...(r.note != null ? { note: r.note as string } : {}),
      })),
    );
  }
}
