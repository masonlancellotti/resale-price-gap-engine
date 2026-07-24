# COMPLIANCE — architectural invariants

> This file is normative. The **Sentinel** (`packages/policy`) enforces these rules **in code** — they
> are not left to good intentions. Changing this file is a governance action, not a refactor.
> The system architecture that these invariants constrain is documented in
> [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

---

## The tier system

Every data source and every automated capability carries a tier tag. The tier sets its
default-enabled status, its autonomy ceiling, and what sign-off enabling it requires.

| Tier | Definition | Default |
|---|---|---|
| **T0** | Official APIs / partner programs, used within their terms | **On** |
| **T1** | Licensed third-party data vendors (they collect; you buy the data) | Off — low friction |
| **T2** | Platform-provided feeds & user-initiated flows (saved-search alert emails, CSV/Terapeak exports, share-sheet handoffs) | **On** |
| **T3** | Automation of **your own account / your own browsing** at human scale, **no evasion** | Off — per-platform opt-in with risk text |
| **T4** | Unattended collection/action against platforms that prohibit it | Off — written risk acceptance, per platform, re-confirmed quarterly |
| **T5** | **Excluded permanently** (below) | **Never** |

## Portfolio rules

1. **No load-bearing T3+/T4 dependency.** The P&L must survive all T3/T4 modules being turned off
   simultaneously. Target: at least 60% of steady-state profit from T0–T2 alone.
2. **Blast-radius isolation.** T3/T4 modules run in separate processes with separate credentials and
   their own kill switches. A ban on one platform must not degrade any other module.

---

## P7 — Stop, don't sneak (the load-bearing invariant)

> On any block, ban, lockout, rate-limit wall we didn't choose, or cease-and-desist signal: the
> affected module **freezes, alerts the operator, and writes an incident record**. Recovery is a
> human decision. There are **no retries under a new identity, ever.**

P7 is what keeps T4 read-access a civil/contract question rather than a CFAA problem: the harmful
fact pattern in scraping case law is *continuing after* an explicit block or cease-and-desist, which
this system structurally cannot do. It is a **test, not a hope**: chaos tests assert that a
simulated block triggers halt-and-alert and never evasion.

---

## T5 — The exclusion list (permanent, not "v1")

**The system will never include:**

- CAPTCHA solving, or outsourcing thereof
- Browser-fingerprint or device spoofing
- User-agent falsification beyond honest client identification
- Proxy / IP rotation whose purpose is circumventing blocks
- Account multiplicity or aged-account purchasing
- Scraping data behind another user's session / auth
- Automated bulk messaging to users who haven't listed an item we are evaluating
- Deceptive identities or false statements in negotiations
- Shill bidding or shill comps
- Knowingly trafficking counterfeit, recalled, or stolen goods
- **Any mechanism whose purpose is to make automated traffic look human**

**Detection response is always: halt module → alert operator → log → human decides.**

These are architectural invariants. The Sentinel exposes them as `invariants_locked` in policy
(`t5_exclusions`, `killswitch_precedence`, `suspended_account_freeze`) — **no policy edit can
override them.**

---

## Adjacent legal/ethical commitments

- **Always shoot our own product photos.** Never republish a seller's/platform's images — that is
  both a copyright and a fraud problem (and it makes returns disputes worse).
- **Stolen-goods screening is a first-class pipeline step.** IMEI/serial checks, carrier blacklist
  checks, provenance heuristics; the underwriter carries a `stolen_risk` flag that hard-blocks
  certain combinations.
- **Counterfeit routing.** Items above authentication thresholds route through platform
  authentication programs or are skipped. Selling fakes is strict-liability trouble.
- **Negotiation is truthful.** Leverage comes from information advantage and pickup certainty — never
  from fabricated personas or false claims.
- **Taxes are not optional.** Resale certificate where applicable, Schedule C, 1099-K reconciliation
  against the ledger (assume every platform reports), quarterly estimates, mileage log.

---

## How enforcement works (so this file has teeth)

- `Sentinel.check(action)` runs **pre-flight on every consequential action** and returns
  `allow | gate(level) | deny(reason)`.
- Kill switches (global, per-source, per-agent, per-platform) **win over everything**.
- A `suspended` account-health status **freezes all actions** on that platform.
- Raising the daily spend cap above its hard ceiling requires typed re-confirmation.
- T4 activation requires a typed ceremony per platform, re-confirmed quarterly, and each T4 module
  is chaos-tested for P7 halt-don't-sneak **before** it may run.
