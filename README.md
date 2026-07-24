# FLIP DESK

**Compliance-first resale-arbitrage engine.** A 41-package TypeScript monorepo that runs the full
**discover → identify → value → underwrite → rank → alert → buy → list → reprice → sell → ship →
account → learn** loop behind an exact integer-cents double-entry ledger. Every external dependency
(HTTP, LLM, mail, carriers, marketplaces, database) sits behind a seam with a deterministic fake, so
the whole system runs — and is tested — **fully offline**, with no keys, no network, and no database.
Flipping to live eBay + LLM extraction is a one-line config change, not a code change.

- **275 tests, green** · `tsc -b` clean · Next.js 15 terminal UI that demos entirely offline.
- Runs the *real* engine over a deterministic demo corpus out of the box — the same code path the
  live system uses, just fed a fixture.

---

## Why it's interesting

- **Money math is exact.** Currency is `bigint` cents end to end; a double-entry ledger is
  property-tested for balance invariants (`@flip-desk/money`). Floats never touch money.
- **Everything is a seam.** Ingestion, sold-comps, exit channels, HTTP, the LLM, and persistence are
  all narrow interfaces with fakes. The composition root (`@flip-desk/runtime`) picks fake or live per
  seam from the environment — nothing downstream knows the difference.
- **Compliance is enforced in code, not in a doc.** Every consequential action passes a **Sentinel**
  that resolves kill-switches, tier enablement, signed opt-ins, spend caps, and autonomy level before
  anything happens. Sources are scored `T0–T5`; actions run at autonomy `L0–L4`. See
  [`COMPLIANCE.md`](COMPLIANCE.md).
- **Stop, don't sneak.** On any block/ban/lockout a module *halts and alerts* — it never rotates
  identities, spoofs fingerprints, or evades. This is chaos-tested, not hoped for.
- **A learning loop.** Calibration and model weights refit from realized outcomes; a class *earns*
  more autonomy on a clean track record and is demoted instantly on a breach.

---

## Architecture at a glance

```
SourceAdapter → pipeline → identify → providers → appraise → underwrite → rank ─┐
                                                                                 │
                                                             ┌── Sentinel ◄──────┘
                                            gate L0–L2 ──────┤
                                            allow L3–L4 ─────┴─→ acquire → intake →
                                            lister/crosslist → pricer → exit (delist saga)
                                            → bookkeeper (ledger) → regret + learn ─┐
                                                                                    │
                                            calibration feedback ◄──────────────────┘
```

Full package map, seam table, data flow, and the tier/autonomy model are in
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

---

## Quickstart (zero keys, fully offline)

Requires **Node 22** (see `.nvmrc`).

```bash
npm install
npm test              # vitest — 275 tests, no network, no keys
npm run typecheck     # tsc -b across all 41 packages
npm run web:dev       # the terminal UI at http://localhost:3000
```

`npm run web:dev` boots the Next.js terminal against the demo corpus in an in-memory store — no DB, no
keys, no live sources. To produce a production build instead:

```bash
npm run web:build && npm run web:start
```

### The demo, explained

Out of the box the desk runs the real `@flip-desk/engine` over a deterministic, seeded corpus of
game/console listings (`@flip-desk/api`'s demo seeding) into an `InMemoryStore`. The UI is a dark,
monospace terminal with four screens:

- **Triage** — the ranked opportunity feed (push/feed/digest/archive bands).
- **Deal** — evidence, the net-profit waterfall, and the L2 one-tap money gate.
- **Money** — P&L and inventory.
- **Health** — adapter/tier status, with any default-off T4 source shown halted.

The badges in the top-right (`HTTP:FAKE` · `LLM:FAKE` · `STORE:MEMORY`) show the desk running fully
offline — no network, no keys, no database.

**Triage** — the ranked feed:

![Triage — the ranked opportunity feed](docs/screenshots/triage.png)

**Deal** — the net-profit waterfall and the L2 money gate:

![Deal — net-profit waterfall and money gate](docs/screenshots/deal.png)

**Money** — P&L booked from the double-entry ledger, plus inventory:

![Money — P&L and inventory](docs/screenshots/money.png)

---

## Live vs offline (the seam swap)

Everything is assembled in `@flip-desk/runtime`'s `buildRuntime(config)` from the environment. With
nothing set, the desk is fully offline (fakes + in-memory store). Set the switches below and
individual seams swap to their live implementations — no other code changes:

| Env var | Effect |
|---|---|
| *(none set)* | Fully offline: `FakeLlm`, `FakeTransport`, `InMemoryStore`. This is the demo. |
| `ANTHROPIC_API_KEY` | LLM seam swaps to the live `AnthropicLlm` (`/v1/messages`) for extraction + the weekly memo. |
| `FLIP_LIVE_HTTP=1` | HTTP seam swaps `FakeTransport` → `FetchTransport` (real network). |
| `PRICECHARTING_API_KEY`, `KEEPA_API_KEY` | Enable licensed sold-comp providers per vertical. |
| `EBAY_CLIENT_ID`, `EBAY_CLIENT_SECRET` | Enable the eBay Browse / Sell adapters. |
| `LLM_USD_DAY_CAP`, `PURCHASE_USD_DAY_CAP` | Budget/policy ceilings. |

See [`.env.example`](.env.example) for the full list. Copy it to `.env` (gitignored) to fill in.

> **Persistence is intentionally in-memory by default.** The `Store` seam ships one wired
> implementation — `InMemoryStore` — which is what the tests and the offline demo use.
> `db/migrations/0001_init.sql` is the **target Postgres schema** (a design artifact); a
> Postgres-backed `Store` is on the roadmap. `DATABASE_URL` is not yet read by the runtime — it only
> powers the optional `docker-compose` stack. This is called out honestly rather than implied to work.

---

## Testing

```bash
npm test          # vitest run — 275 tests across 45 files
npm run typecheck # tsc -b — strict, NodeNext, exactOptionalPropertyTypes, noUncheckedIndexedAccess
```

The suite runs with no network and no keys. `fast-check` property tests guard the money ledger;
adapters self-test against checked-in fixtures; `@flip-desk/flows` runs multi-package end-to-end flows
(delist saga, paper-trading loop). CI (`.github/workflows/ci.yml`) runs typecheck + tests + a web
typecheck + a Next.js production build on Node 22.

---

## Project structure

```
flip-desk/
├── packages/            # 34 domain packages (core, money, engine, appraise, underwrite, …)
│   └── adapters/        # ebay, ebay-sell, mercari, email, shopgoodwill, noop
├── apps/web/            # Next.js 15 terminal UI (@flip-desk/web)
├── db/                  # target Postgres schema (design artifact) + notes
├── docs/                # ARCHITECTURE.md
├── docker-compose.yml   # optional local infra (Postgres/pgvector, Redis, MinIO) — roadmap
├── COMPLIANCE.md        # normative tier/autonomy invariants (enforced by the Sentinel)
└── .env.example         # every switch; copy to .env to go live
```

## Toolchain

Node 22 · npm workspaces (no pnpm) · TypeScript (strict, NodeNext, `exactOptionalPropertyTypes`,
`noUncheckedIndexedAccess`) · vitest + fast-check · Next.js 15 / React 19. Internal packages export
`./src/index.ts` directly, so tooling resolves TypeScript source with no build step. The optional
`docker-compose.yml` (Postgres+pgvector, Redis, MinIO) sits behind seams and is not needed for tests
or the demo.

## Roadmap & honest limitations

- **Persistence:** only `InMemoryStore` is wired. The Postgres schema exists as a design artifact; the
  Postgres-backed `Store` is not implemented yet.
- **Live integrations:** the eBay and Anthropic clients are real and unit-tested behind their seams,
  but the end-to-end live path (real network, real credentials) has not been exercised against
  production marketplaces — the offline path is the proven one.
- **T3/T4 sources** ship default-off and require a signed opt-in ceremony before they can run; the
  system is designed to survive with T0–T2 alone.

## License

MIT © 2026 Mason Lancellotti. See [`LICENSE`](LICENSE).
