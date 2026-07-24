# Database schema (design artifact)

`db/migrations/0001_init.sql` is the target persistence schema for FLIP DESK: PostgreSQL 16 +
`pgvector`, money as `bigint` cents everywhere, times as `timestamptz` (UTC).

> **Status:** this schema is a design artifact. The runtime's default `Store` is `InMemoryStore`
> (see `packages/store`), which is what the tests and the offline web demo use. A Postgres-backed
> `Store` implementation is on the roadmap; see `docs/ARCHITECTURE.md` (Persistence). The schema is
> checked in now because it is the contract that the future implementation and the `docker-compose`
> stack are built against.

## Applying the schema (once a Postgres instance is available)

```bash
docker compose up -d db            # from repo root — starts pgvector/pgvector:pg16
docker compose exec -T db psql -U flip -d flipdesk < db/migrations/0001_init.sql
```

Or against any Postgres 16 with the `vector` extension available:

```bash
psql "$DATABASE_URL" -f db/migrations/0001_init.sql
```

## Notes

- **Ledger invariant.** `ledger_entry` carries the per-row CHECK `(debit=0) <> (credit=0)`; the
  cross-row invariant Sum(debit) = Sum(credit) (per `txn_id` and globally) is enforced by the
  posting service (`@flip-desk/money`) and re-checked nightly. The same posting logic is
  property-tested in `packages/money`.
- **PostGIS.** The design uses `geography(point)` for `listing.location`; this migration uses
  `lat`/`lon` so it runs on the stock `pgvector` image. Swap in a PostGIS geography column when the
  geo/pickup-routing features land.
- Migrations are append-only and numbered. A proper migration runner (node-pg-migrate / drizzle)
  gets wired in alongside the Postgres `Store`; for now the file is applied directly.
