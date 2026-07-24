-- FLIP DESK — SQLite persistence schema (the durable desk projection).
--
-- This is the SQLite dialect of the desk's read/write projection: the same records the
-- InMemoryStore holds in maps, made durable. The full production design schema lives in
-- db/migrations/0001_init.sql (Postgres + pgvector); these tables are the thin, serialization-
-- friendly projections the UI reads and the pipeline writes (see packages/store/src/records.ts).
-- Postgres remains the "same SQL family" production target — see db/README.md for the mapping.
--
-- Dialect mapping (Postgres design -> SQLite here):
--   serial / bigserial / bigint PK  -> INTEGER PRIMARY KEY (rowid), or TEXT id where app-assigned
--   timestamptz                     -> TEXT (ISO-8601 UTC strings, exactly as produced by the app)
--   bigint cents (money)            -> TEXT (decimal string; preserves bigint EXACTLY — never a float)
--   jsonb / text[]                  -> TEXT (JSON document; arrays are JSON arrays)
--   boolean                         -> INTEGER (0/1)
--   real / double precision         -> REAL
--   vector(768) / bit(64) (pgvector)-> dropped (embeddings/phash are not part of the desk projection)
--
-- Money invariant preserved: cents cross the boundary as decimal TEXT, parsed back with BigInt().
-- No floating point ever touches a currency value.

-- Opportunities: the triage feed. `taken`/`identified` are 0/1; `risk_flags`/`waterfall` are JSON.
-- rowid (implicit) preserves insertion order for a stable, deterministic feed tiebreak.
create table if not exists opportunity (
  id                     text primary key,
  created_at             text    not null,
  listing_external_id    text    not null,
  source                 text    not null,
  title                  text    not null,
  product_id             integer,
  valuation_p50_cents    text,
  valuation_p10_cents    text,
  valuation_p90_cents    text,
  net_p50_cents          text,
  cash_at_risk_cents     text,
  roi                    real,
  score                  real,
  band                   text,
  taken                  integer not null default 0,
  identified             integer not null default 0,
  risk_flags             text    not null default '[]',
  waterfall              text,
  status                 text    not null default 'new'
);

-- Inventory items, keyed by SKU. Money columns are decimal TEXT; channels is a JSON array.
create table if not exists inventory (
  sku               text primary key,
  title             text    not null,
  condition_band    text,
  cost_basis_cents  text    not null,
  bin               text    not null,
  status            text    not null default 'received',
  listed_price_cents text,
  sold_price_cents  text,
  channels          text    not null default '[]',
  received_at       text    not null
);

-- Alerts raised on triage bands (push/feed/digest). rowid preserves insertion order.
create table if not exists alert (
  id             text primary key,
  created_at     text not null,
  band           text not null,
  channel        text not null,
  title          text not null,
  opportunity_id text not null
);

-- P&L snapshot — a singleton row (id = 1). All amounts are decimal TEXT cents.
create table if not exists pnl (
  id                     integer primary key check (id = 1),
  revenue_cents          text not null default '0',
  cogs_cents             text not null default '0',
  fees_cents             text not null default '0',
  net_profit_cents       text not null default '0',
  inventory_value_cents  text not null default '0',
  flips                  integer not null default 0
);

-- Source health, keyed by source code (newest write wins).
create table if not exists health (
  source       text primary key,
  tier         text not null,
  state        text not null default 'ok',
  last_poll_at text,
  note         text
);
