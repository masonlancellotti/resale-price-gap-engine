-- FLIP DESK — initial schema (design artifact; see db/README.md and docs/ARCHITECTURE.md).
-- Money is bigint cents, always. Times are timestamptz (UTC). Idempotent where practical.
--
-- Deviation note: the geo design calls for `location geography(point)` (PostGIS). To keep this
-- migration runnable on the plain `pgvector/pgvector:pg16` image (no PostGIS), `listing.location`
-- is modeled as `lat`/`lon double precision`. Swap in a PostGIS geography column when the geo
-- vertical needs it.

create extension if not exists vector;

-- ============ LOOKUPS ============
create table category (
  id            serial primary key,
  slug          text unique not null,             -- 'video_games','lego','vinyl','music_gear',...
  parent_id     int references category,          -- hierarchical shrinkage borrows strength across categories
  rubric        jsonb not null default '{}'        -- condition-grading rubric + gotcha checklist seeds
);

-- ============ SOURCING SIDE ============
create table source (
  id            smallserial primary key,
  code          text unique not null,             -- 'ebay','fb_mkt','craigslist',...
  tier          text not null check (tier in ('T0','T1','T2','T3','T4','T5')),
  enabled       boolean not null default false,
  rate_budget   jsonb not null default '{}',       -- token-bucket params
  config        jsonb not null default '{}'        -- regions, saved searches, creds ref
);

create table listing_raw (                          -- append-only, source of truth
  id            bigserial primary key,
  source_id     smallint not null references source,
  external_id   text not null,
  channel       text not null check (channel in ('api','email_alert','share_sheet','overlay','export','poll')),
  fetched_at    timestamptz not null default now(),
  payload       jsonb not null,
  content_hash  bytea not null,
  unique (source_id, external_id, content_hash)
);

create table listing (
  id                bigserial primary key,
  source_id         smallint not null references source,
  external_id       text not null,
  url               text,
  title             text not null,
  description       text,
  price_cents       bigint not null,
  lat               double precision,
  lon               double precision,
  distance_mi       real,
  seller_handle     text,
  seller_signals    jsonb,                          -- rating, tenure, response rate
  condition_claimed text,
  attrs             jsonb not null default '{}',    -- extracted: brand, model, variant...
  extraction_conf   real,
  embedding         vector(768),
  phash             bit(64),
  status            text not null default 'active'
                     check (status in ('active','pending','sold','removed','stale')),
  posted_at         timestamptz,
  first_seen        timestamptz not null default now(),
  last_seen         timestamptz not null default now(),
  unique (source_id, external_id)
);
create index on listing (status, first_seen desc);
create index on listing using hnsw (embedding vector_cosine_ops);

create table listing_media (
  id            bigserial primary key,
  listing_id    bigint not null references listing,
  object_key    text not null,
  phash         bit(64),
  ocr_text      text,
  vision_notes  jsonb
);

create table listing_price_event (
  id            bigserial primary key,
  listing_id    bigint not null references listing,
  observed_at   timestamptz not null default now(),
  price_cents   bigint not null
);

-- ============ CATALOG & VALUATION ============
create table product (                              -- canonical, deduped catalog
  id            bigserial primary key,
  canonical_key text unique not null,               -- 'upc:0885909…','epid:2334…','pcid:6910','bl:75192-1'
  category_id   int not null references category,
  brand         text,
  model         text,
  variant       jsonb not null default '{}',        -- {storage:'256GB',carrier:'unlocked',gen:2}
  identifiers   jsonb not null default '{}',        -- upc[], asin, epid, mpn
  title         text not null,
  embedding     vector(768),
  gotchas       jsonb not null default '[]'         -- category trap checklist
);

create table listing_product_match (
  listing_id    bigint not null references listing,
  product_id    bigint not null references product,
  confidence    real not null,
  method        text not null,                      -- 'barcode','epid','embed+llm','human'
  primary key (listing_id, product_id)
);

create table comp (
  id             bigserial primary key,
  product_id     bigint not null references product,
  provider       text not null,                     -- 'terapeak','pricecharting','discogs','vendor:apify',...
  condition_band text not null check (condition_band in ('new','like_new','good','fair','parts')),
  completeness   text,                              -- complete|item_only|sealed
  price_cents    bigint not null,
  sold_at        date not null,
  listing_ref    text,
  seller_key     text,                              -- hashed; anti-shill diversity check
  raw            jsonb
);
create index on comp (product_id, condition_band, sold_at desc);

create table valuation (
  id               bigserial primary key,
  product_id       bigint not null references product,
  condition_band   text not null,
  computed_at      timestamptz not null default now(),
  model_version    text not null,
  n_comps          int,
  window_days      int,
  providers        text[],
  p10_cents        bigint,
  p50_cents        bigint,
  p90_cents        bigint,
  sell_through_90d real,                            -- sold/(sold+active)
  active_count     int,
  tts_days_p50     real,
  tts_days_p90     real,
  price_tts_curve  jsonb,                           -- [{price_ratio, exp_days}] ladder
  trend_30d        real,
  confidence       real not null
);

-- ============ DEAL FLOW ============
create table opportunity (
  id               bigserial primary key,
  listing_id       bigint unique not null references listing,
  product_id       bigint references product,
  valuation_id     bigint references valuation,
  state            text not null default 'new',
  buy_price_cents  bigint,                          -- expected post-negotiation
  all_in_cents     bigint,                          -- + tax, travel, inbound ship
  net_p50_cents    bigint,
  net_p10_cents    bigint,
  roi              real,
  score            real,
  p_profit         real,
  expected_hours   real,
  exp_days_capital real,
  risk_flags       text[] not null default '{}',
  waterfall        jsonb,                           -- itemized cost lines for UI evidence
  alerted_at       timestamptz,
  decided_at       timestamptz,
  outcome          jsonb                            -- realized actuals (learner fills)
);
create index on opportunity (state, score desc);

create table decision (                              -- the audit spine
  id             bigserial primary key,
  subject_type   text not null,
  subject_id     bigint not null,
  gate           text not null,                     -- purchase|msg_send|publish|reprice|refund|...
  action         text not null,                     -- approve|reject|modify|auto_approve|auto_execute
  actor          text not null,                     -- 'human:mason' | 'agent:underwriter@v12'
  autonomy_level text not null check (autonomy_level in ('L0','L1','L2','L3','L4')),
  rationale      text,
  policy_version text not null,
  created_at     timestamptz not null default now()
);

create table negotiation_thread (
  id                  bigserial primary key,
  opportunity_id      bigint references opportunity,
  platform_thread_ref text,
  state               text not null default 'draft'
                        check (state in ('draft','sent','countered','accepted','declined','expired')),
  strategy            jsonb                          -- anchor, floor, script version, bundle notes
);

create table message (
  id          bigserial primary key,
  thread_id   bigint not null references negotiation_thread,
  direction   text not null check (direction in ('in','out')),
  body        text not null,
  drafted_by  text,
  approved_by text,
  sent_via    text,                                 -- human_manual|assisted|automated
  created_at  timestamptz not null default now()
);

-- ============ OWNERSHIP & EXIT ============
create table purchase (
  id               bigserial primary key,
  opportunity_id   bigint unique references opportunity,
  price_paid_cents bigint not null,
  tax_cents        bigint not null default 0,
  ship_in_cents    bigint not null default 0,
  travel_cents     bigint not null default 0,
  method           text,                            -- cash_pickup|platform_checkout|snipe
  payment_ref      text,
  receipt_key      text,
  purchased_at     timestamptz not null
);

create table inventory_item (
  id                 bigserial primary key,
  sku                text unique not null,           -- 'FD-2026-00417'
  purchase_id        bigint references purchase,
  product_id         bigint references product,
  status             text not null default 'intake',
  condition_verified text,
  test_results       jsonb,
  serials            jsonb,                          -- incl. IMEI/serial check outcomes
  bin                text,
  photo_keys         text[],
  cost_basis_cents   bigint not null,                -- purchase alloc + inbound + parts
  target_cents       bigint,
  floor_cents        bigint,
  listed_at          timestamptz,
  sold_at            timestamptz
);

create table listing_out (
  id             bigserial primary key,
  inventory_id   bigint not null references inventory_item,
  platform       text not null,
  external_id    text,
  url            text,
  state          text not null default 'draft'
                   check (state in ('draft','pending','live','ended','sold_here','error')),
  price_cents    bigint not null,
  promoted_rate  real not null default 0,
  content        jsonb,                              -- per-platform title/desc/specifics
  published_at   timestamptz,
  unique (inventory_id, platform)
);

create table reprice_event (
  id             bigserial primary key,
  listing_out_id bigint not null references listing_out,
  at             timestamptz not null default now(),
  old_cents      bigint,
  new_cents      bigint,
  reason         text,
  actor          text
);

create table sale_order (
  id                    bigserial primary key,
  listing_out_id        bigint references listing_out,
  platform_order_id     text unique not null,
  sold_cents            bigint not null,
  buyer_ship_paid_cents bigint not null default 0,
  fees_cents            bigint,
  ad_fees_cents         bigint,
  tax_collected_cents   bigint,
  sold_at               timestamptz not null,
  payout_cents          bigint,
  payout_at             timestamptz,
  payout_ref            text
);

create table shipment (
  id            bigserial primary key,
  sale_order_id bigint not null references sale_order,
  carrier       text,
  service       text,
  tracking      text unique,
  label_cents   bigint,
  insured_cents bigint,
  weight_oz     int,
  dims_in       int[],
  status        text,                               -- label_created|in_transit|delivered|exception|lost
  events        jsonb
);

create table return_case (
  id                 bigserial primary key,
  sale_order_id      bigint not null references sale_order,
  reason             text,
  opened_at          timestamptz,
  state              text,
  refund_cents       bigint,
  return_label_cents bigint,
  restock_outcome    text,
  notes              text
);

-- ============ MONEY (double-entry) ============
create table ledger_entry (
  id           bigserial primary key,
  ts           timestamptz not null,
  txn_id       uuid not null,                        -- entries balance per txn_id
  account      text not null,                        -- cash|inventory|cogs|revenue|platform_fees|...
  debit_cents  bigint not null default 0,
  credit_cents bigint not null default 0,
  ref_type     text,
  ref_id       bigint,
  memo         text,
  check ((debit_cents = 0) <> (credit_cents = 0)),
  check (debit_cents >= 0 and credit_cents >= 0)
);
create index on ledger_entry (txn_id);
create index on ledger_entry (account, ts);
-- invariant enforced by posting service + nightly check: sum(debit)=sum(credit) per txn_id

create table fee_schedule (
  platform          text not null,
  category          text not null default '*',
  pct               numeric(6,4),
  fixed_cents       bigint,
  payment_pct       numeric(6,4),
  payment_fixed_cents bigint,
  effective         date not null,
  verified_at       date not null,
  primary key (platform, category, effective)
);

-- ============ SYSTEM ============
create table agent_run (
  id           bigserial primary key,
  agent        text not null,
  version      text not null,
  subject_type text,
  subject_id   bigint,
  input_ref    jsonb,
  output       jsonb,
  tokens_in    int,
  tokens_out   int,
  cost_usd     numeric(10,5),
  latency_ms   int,
  ok           boolean,
  error        text,
  created_at   timestamptz not null default now()
);

create table account_health (
  platform     text primary key,
  account_ref  text,
  status       text not null default 'healthy'
                 check (status in ('healthy','warned','restricted','suspended')),
  limits       jsonb,
  last_checked timestamptz,
  notes        text
);

create table policy_version (
  id           bigserial primary key,
  version      int unique not null,
  yaml         text not null,
  activated_at timestamptz not null default now(),
  activated_by text not null
);

create table watch_regret (                          -- counterfactual training data
  listing_id          bigint primary key references listing,
  skipped_at          timestamptz,
  skip_reason         text,
  final_status        text,
  final_price_cents   bigint,                         -- watcher fills when it sells
  delta_vs_prediction real
);

create table domain_event (
  id           bigserial primary key,
  ts           timestamptz not null default now(),
  entity_type  text not null,
  entity_id    bigint,
  type         text not null,
  payload      jsonb not null default '{}',
  causation_id uuid
);
create index on domain_event (entity_type, entity_id, ts);

create table alert (
  id             bigserial primary key,
  opportunity_id bigint references opportunity,
  band           text not null,                      -- push|feed|digest|archive
  channel        text,
  sent_at        timestamptz,
  acted_at       timestamptz,
  action         text
);

create table eval_run (
  id            bigserial primary key,
  suite         text not null,
  model_version text not null,
  metrics       jsonb not null default '{}',
  ran_at        timestamptz not null default now()
);
