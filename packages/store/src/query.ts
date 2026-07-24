import type {
  AlertRecord,
  HealthRecord,
  InventoryRecord,
  OpportunityRecord,
  PnlSnapshot,
} from "./records.js";
import type { OpportunityFilter } from "./store.js";

/**
 * Pure read-model semantics shared by every {@link Store} implementation. Extracting the
 * filter/sort rules here is what lets the {@link InMemoryStore} and the SqliteStore pass the
 * *same* parameterized contract suite: both project their rows through these functions, so the
 * feed ordering, inventory ordering and empty-P&L default are identical by construction.
 */
export const EMPTY_PNL: PnlSnapshot = {
  revenueCents: 0n,
  cogsCents: 0n,
  feesCents: 0n,
  netProfitCents: 0n,
  inventoryValueCents: 0n,
  flips: 0,
};

/** BAND ordering for the triage feed (push first, archive last). */
export const BAND_RANK: Record<string, number> = { push: 0, feed: 1, digest: 2, archive: 3 };

/**
 * Feed order: band (push → feed → digest → archive), then score descending. Callers pass rows in
 * stable insertion order so equal (band, score) pairs keep their insertion order — a deterministic
 * tiebreak both stores honour (Map iteration order / SQLite rowid order).
 */
export function sortFeed(rows: readonly OpportunityRecord[]): OpportunityRecord[] {
  return [...rows].sort((a, b) => {
    const bandDiff = (BAND_RANK[a.band ?? "archive"] ?? 9) - (BAND_RANK[b.band ?? "archive"] ?? 9);
    if (bandDiff !== 0) return bandDiff;
    return (b.score ?? 0) - (a.score ?? 0);
  });
}

export function applyOpportunityFilter(
  rows: readonly OpportunityRecord[],
  filter: OpportunityFilter = {},
): OpportunityRecord[] {
  let out = [...rows];
  if (filter.status) out = out.filter((r) => r.status === filter.status);
  if (filter.band) out = out.filter((r) => r.band === filter.band);
  if (filter.takenOnly) out = out.filter((r) => r.taken);
  return sortFeed(out);
}

export function sortInventory(rows: readonly InventoryRecord[]): InventoryRecord[] {
  return [...rows].sort((a, b) => a.receivedAt.localeCompare(b.receivedAt));
}

export function sortAlerts(rows: readonly AlertRecord[]): AlertRecord[] {
  return [...rows].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function sortHealth(rows: readonly HealthRecord[]): HealthRecord[] {
  return [...rows].sort((a, b) => a.source.localeCompare(b.source));
}
