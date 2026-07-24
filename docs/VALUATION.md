# Valuation methodology

How FLIP DESK turns a pile of sold comps into a resale price distribution and a go/no-go decision.
This is the internal memo version — every formula here is implemented in `packages/appraise`
(`appraise.ts`) and `packages/underwrite` (`underwrite.ts`), and pinned by the golden tests there.

Money is integer cents throughout; statistics run in floating point and round back to cents only at
the boundary.

---

## 1. Comp selection

The appraiser starts from sold comps for a matched product and filters aggressively before it trusts
any of them.

**Adjacent-band admission.** Condition bands are ordered `new > like_new > good > fair > parts`. A comp
is admissible only if it is within one band of the target: `|idx(comp) − idx(target)| ≤ 1`. A `parts`
comp never prices a `like_new` listing.

**Band transform.** An admissible comp sold in band `B` is re-expressed in the target band `T` by the
multiplier ratio

```
price_T = price_B · mult[T] / mult[B]
mult = { new: 1.15, like_new: 1.00, good: 0.80, fair: 0.60, parts: 0.30 }   (category rubrics override)
```

**Recency window.** The base window is 90 days. If fewer than `minComps = 5` admissible comps survive,
it widens to 180 days and raises the `stale_comps` flag (which later dents confidence).

**MAD outlier rejection.** On the transformed prices, drop anything more than `k = 3` MADs from the
median, where `MAD = 1.4826 · median(|xᵢ − median(x)|)`. Robust to a few bad prints; if MAD is 0 (all
equal) nothing is dropped.

**Seller-diversity guard.** Count distinct `seller_key`s among survivors (a missing key is treated as a
unique anonymous seller so shills can't masquerade as consensus). Fewer than 3 distinct sellers raises
`low_seller_diversity` and applies a confidence haircut — three listings from one seller are one
opinion, not three.

---

## 2. Band construction (P10 / P50 / P90)

Surviving comps are weighted by recency and reduced to quantiles.

**Recency decay.** Each comp gets an exponential weight with a 30-day half-life:

```
w(age) = 0.5 ^ (age_days / 30)
```

A comp sold today counts double one sold 30 days ago.

**Weighted quantiles.** Sort by price, accumulate weights, and read off the value where the cumulative
weight first crosses `q · Σw` for `q ∈ {0.10, 0.50, 0.90}`. These are `P10`, `P50`, `P90` — the resale
price distribution the underwriter consumes. (For finer bands, e.g. P25/P75 in the calibration lab, fit
a lognormal to (P10, P50, P90) and read its quantiles — see `lognormalFromQuantiles` / `lognormalQuantile`.)

**Dispersion.** `dispersion = (P90 − P10) / P50`. Above 0.8 it flags `high_dispersion` and widens the
confidence haircut.

---

## 3. Liquidity & time-to-sale

From the count of comps sold in the last 90 days (`sold90`) and the current active-listing count:

```
sell_through_90d = sold90 / (sold90 + active)
hazard           = (sold90 / 90) / (active + 1)      # your unit competing against the actives
TTS_p50 ≈ 1 / hazard            TTS_p90 ≈ 2.303 / hazard      # exponential: P90 ≈ 2.303 · mean
```

A price/TTS ladder is generated with demand elasticity `ε = 3`: cutting price ratio `r` below 1
multiplies hazard by `exp(−ε·(r−1))`, so the model can quote "list 10% under P50 → expected N days."

---

## 4. Confidence

A single [0, 1] score, built multiplicatively so any weak input drags the whole thing down:

```
confidence = clamp(n/12, 0.3, 1)              # comp count
           · clamp(1 − dispersion/2, 0.3, 1)  # tightness of the band
           · match_confidence                 # identifier's certainty this is the right product
           · condition_certainty              # grading certainty
           · (0.70 if low_seller_diversity)
           · (0.85 if stale_comps)
           · (0.80 if category_drift)          # |30-day trend| > 0.15
```

---

## 5. The net-profit waterfall

The underwriter never reasons in margins-of-price; it walks a cost waterfall to an accounting-true net,
evaluated at the resale P50 (and again at P10 for a margin-of-safety figure).

**Sell-side (a function of the resale price point):**

```
platform_fee(resale) = mulBp(resale, fee.pctBp) + fee.fixedCents
payment_fee(resale)  = mulBp(resale, payment.pctBp) + payment.fixedCents
promo(resale)        = mulBp(resale, promotedRateBp)
fixed_sell_costs     = outbound_ship + packaging + returns_reserve + fraud_reserve + doa_risk
returns_reserve      = mulBp(expected_return_loss, p_return_bp)

net_resale_proceeds(resale) = resale − platform_fee − payment_fee − promo − fixed_sell_costs
```

**Buy-side & carry:**

```
cash_at_risk   = purchase + acquisition_tax + inbound_ship + travel(miles · IRS_rate)
capital_carry  = carryCost(cash_at_risk, apr_bp, expected_TTS_days)
labor          = laborCost(labor_minutes, labor_rate_per_hour)
```

**Net (at P50):**

```
net_P50   = net_resale_proceeds(P50) − (purchase + tax + inbound + travel + capital_carry) − labor
cash_net  = net_P50 + labor                         # labor not charged to self
net_P10   = net_resale_proceeds(P10) − (…) − labor  # downside / margin of safety
ROI       = net_P50 / cash_at_risk
$/labor-hr = cash_net · 60 / labor_minutes
$/capital-day = net_P50 / expected_TTS_days
```

**Break-even & P(profit).** Solve the resale price at which net = 0, then read the probability of
clearing it off the fitted lognormal:

```
slope         = 1 − (fee.pctBp + payment.pctBp + promotedRateBp) / 10_000
K             = fixed_fees + fixed_sell_costs + below_line_ex_labor + labor
break_even    = K / slope
p_profit      = 1 − LognormalCDF(break_even ; fit(P10, P50, P90))
```

---

## 6. The floors (go / no-go)

A deal must clear **all three** floors to be taken (per-category overridable):

```
net_P50    ≥ $25.00
ROI        ≥ 0.30
$/labor-hr ≥ $30.00
```

Plus it must not be hard-blocked by risk rules and must rank above the `archive` band. These floors are
exactly what the simulation lab's L2 auto-approve honors, and what the calibration view scores against
realized outcomes — see [SIMULATION.md](./SIMULATION.md).

---

*Every constant above lives in code (`DEFAULT_BAND_MULTIPLIERS`, `DEFAULT_FLOORS`, the appraiser's
window/half-life defaults) and is covered by unit and golden tests. Change the number, watch the test
move.*
