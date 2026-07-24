# Simulation lab — methodology & honesty statement

> **Everything the simulation produces is SYNTHETIC.** The listing stream, prices, and outcomes are
> generated from hand-chosen probability models — not scraped, not backtested against real sales. The
> lab exists to exercise the **real** FLIP DESK engine and the **real** double-entry ledger against a
> controllable, reproducible market, and to measure the result like a fund. It validates the
> **machinery and the math**. It does **not** claim a live trading edge.

## What runs

`npm run sim -- --days 90 --seed 42 --out reports/sim-90d.html`

Under the hood (`packages/sim`):

1. **Generate the market** (`market.ts`) — up front, deterministically from the seed, build the whole
   90-day listing stream: one uniquely-tagged product per listing, its recent sold **comps**, an
   **ask** price, and the item's hidden ground truth (the price it will clear at and how long it will
   take to sell). Pre-generating means the engine — itself deterministic — sees identical inputs on
   every run of a seed, so the simulation is reproducible bit-for-bit.
2. **Drive the real engine** (`harness.ts`, `simulate.ts`) — each simulated day, every listing goes
   through the production path: `ingest → identify → appraise → underwrite → rank`. The engine decides
   what is a buy exactly as it would live.
3. **Trade & book** — any floors-passing, non-hard-blocked opportunity is bought in score order, under
   a per-day deployment cap (this is "L2 auto-approve-in-sim"). Buys and sales post to the **real**
   `Bookkeeper`/`Ledger` (integer-cents double-entry). Items settle at their hidden clearing price
   after their hidden hold time.
4. **Measure** (`metrics.ts`, `render.ts`) — mark equity to (cost) book each day and compute the
   tearsheet: money-weighted return, total return, IRR, hit rate, hold-day stats, max drawdown,
   per-category ROI, capital utilization, fee burden, and **band calibration**.

## The generator (what the numbers come from)

Per category (`config.ts`) the model fixes a value scale and its dispersion, deal incidence, liquidity,
and a bad-outcome rate. For each listing:

- **True value** `V ~ Lognormal(median, σ_value)` — the item's good-condition market value.
- **Comps** — 13 sold comps at `V · exp(σ_comp · Z)`, dated in the 30 days before the listing appears.
  These are the ONLY value signal the appraiser sees.
- **Ask** — with probability `dealRate` the listing is a deal (a steal at 0.42–0.62·V, or a modest
  deal at 0.62–0.82·V); otherwise it is fair/high at 0.90–1.15·V.
- **Clearing price (hidden)** — `V · haircut · exp(σ_comp · Z)`, where `haircut` is 1 normally and a
  0.35–0.68 penalty on a bad outcome (return / DOA / misgrade). Drawn from the *same* dispersion as the
  comps, so the appraiser's predicted band is tested honestly.
- **Time to sale (hidden)** — geometric with the category's daily sale hazard.

### Parameter table (default config)

| Category | Weight | Median value | σ value | σ comp | Deal rate | Steal rate | Sale hazard/day | Bad-outcome |
|---|--:|--:|--:|--:|--:|--:|--:|--:|
| Retro games | 0.22 | $120 | 0.60 | 0.17 | 0.40 | 0.30 | 0.060 | 0.09 |
| LEGO sets | 0.18 | $180 | 0.50 | 0.14 | 0.34 | 0.25 | 0.050 | 0.06 |
| Vinyl records | 0.16 | $45 | 0.70 | 0.22 | 0.46 | 0.35 | 0.045 | 0.12 |
| Music gear | 0.16 | $260 | 0.55 | 0.15 | 0.30 | 0.20 | 0.035 | 0.14 |
| Vintage cameras | 0.14 | $150 | 0.65 | 0.20 | 0.38 | 0.30 | 0.040 | 0.13 |
| Graphing calculators | 0.14 | $70 | 0.40 | 0.12 | 0.44 | 0.28 | 0.070 | 0.05 |

Global: 18 listings/day · marketplace fee ≈13.1% + $0.30 · $6.50 outbound shipping · capital phased in
$800 (day 0), $600 (day 30), $600 (day 60), with bounded top-ups if a buy is briefly cash-short.

## Metrics — how to read them

- **Money-weighted return (Modified Dietz)** — the headline. Gain over the horizon ÷ the *time-weighted*
  average capital deployed; a dollar added on day 60 counts a third as much as one present from day 0.
  A **period** figure (not annualized), so it stays intuitive.
- **Total return** — final equity vs every dollar contributed.
- **Annualized IRR** — shown for completeness but **directional only**: annualizing a 90-day window
  inflates it heavily. Prefer the money-weighted return.
- **Band calibration** — the honest test of the appraiser. For each flip we compare the realized sale
  price against the appraiser's predicted P10–P90 (nominal 80% coverage) and P25–P75 (nominal 50%,
  derived from a lognormal fit of P10/P50/P90). Under- or over-coverage means the bands are too tight
  or too wide; the tail split (below P10 vs above P90) shows directional bias.
- **Capital deployed** — average share of the bankroll tied up in stock. This strategy is deliberately
  selective, so most capital sits idle waiting for deals; a low number is expected, not a defect.

## What this DOES validate

- The engine runs the full loop end-to-end, deterministically, over thousands of listings.
- The double-entry ledger stays balanced at **every** day boundary (asserted as a property test).
- The appraiser's uncertainty bands can be scored for calibration against known outcomes.
- The accounting closes: final equity ≡ total contributions + realized net profit (property test).

## What this does NOT validate

- Any claim about real-world profitability, real marketplaces, or real price distributions.
- The realism of the category parameters — they are plausible guesses, deliberately labeled synthetic.
- Behavior under adversarial supply, fraud, platform risk, or regime shifts not in the model.

## Determinism

Same `--seed` ⇒ identical `SimResult`, identical tearsheet, byte-identical HTML. Asserted in
`packages/sim/test/sim.test.ts`.
