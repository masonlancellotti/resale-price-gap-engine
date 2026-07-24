import { type Cents, formatCents } from "@flip-desk/money";
import type { CategoryStat, Tearsheet } from "./metrics.js";
import type { DailyPoint, SimResult } from "./types.js";

const SYNTHETIC_NOTE =
  "Simulated marketplace (seeded synthetic data) — methodology in docs/SIMULATION.md";

const pct = (x: number, digits = 1): string => `${(x * 100).toFixed(digits)}%`;
const signPct = (x: number, digits = 1): string => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(digits)}%`;

// ---- markdown ----------------------------------------------------------------------------------

/** Deterministic markdown tearsheet (no wall-clock, no randomness — same seed → identical bytes). */
export function renderMarkdown(result: SimResult, t: Tearsheet): string {
  const l: string[] = [];
  l.push(`# FLIP DESK — simulated tearsheet`);
  l.push("");
  l.push(`> ⚠ ${SYNTHETIC_NOTE}`);
  l.push("");
  l.push(`**Seed** \`${result.seed}\` · **Horizon** ${result.days} days from ${result.startDateIso.slice(0, 10)} · **Listings** ${result.listingsSeen} seen, ${result.listingsTaken} bought`);
  l.push("");
  l.push(`## Headline`);
  l.push("");
  l.push(`| Metric | Value | Plain-language |`);
  l.push(`| --- | ---: | --- |`);
  l.push(`| Money-weighted return (90d) | ${signPct(t.moneyWeightedReturn)} | Return weighted by when cash was deployed |`);
  l.push(`| Total return | ${signPct(t.totalReturn)} | Final equity vs every dollar contributed |`);
  l.push(`| Annualized IRR (directional) | ${signPct(t.irrAnnual, 0)} | Annualizing a 90-day window inflates this — read directionally |`);
  l.push(`| Net profit | ${formatCents(t.netProfitCents)} | Realized profit across settled flips |`);
  l.push(`| Final equity | ${formatCents(t.finalEquityCents)} | Cash + inventory at cost, end of window |`);
  l.push(`| Capital contributed | ${formatCents(t.totalContributionsCents)} | Total investor cash phased in |`);
  l.push(`| Flips | ${t.flips} | Items bought and sold |`);
  l.push(`| Hit rate | ${pct(t.hitRate)} | Share of flips that sold for a profit |`);
  l.push(`| Median / P90 hold days | ${t.medianHoldDays.toFixed(0)} / ${t.p90HoldDays.toFixed(0)} | Days from buy to sale (typical / slow) |`);
  l.push(`| Max drawdown (equity) | ${pct(t.maxDrawdown)} | Deepest dip from a prior equity high |`);
  l.push(`| Capital deployed | ${pct(t.capitalUtilization)} | Avg. share of bankroll tied up in stock |`);
  l.push(`| Fee burden (fees / revenue) | ${pct(t.feeBurden)} | Marketplace fees as a share of sale proceeds |`);
  l.push("");
  l.push(`## Band calibration`);
  l.push("");
  l.push(`Share of realized sale prices landing inside the appraiser's predicted band (n = ${t.calibration.n}).`);
  l.push("");
  l.push(`| Band | Nominal | Empirical |`);
  l.push(`| --- | ---: | ---: |`);
  l.push(`| P10–P90 | ${pct(t.calibration.nominalP10P90, 0)} | ${pct(t.calibration.coverageP10P90)} |`);
  l.push(`| P25–P75 | ${pct(t.calibration.nominalP25P75, 0)} | ${pct(t.calibration.coverageP25P75)} |`);
  l.push(`| Tail balance | — | ${pct(t.calibration.belowP10)} below P10 · ${pct(t.calibration.aboveP90)} above P90 |`);
  l.push("");
  l.push(`## By category`);
  l.push("");
  l.push(`| Category | Flips | Cost | Revenue | Net | ROI |`);
  l.push(`| --- | ---: | ---: | ---: | ---: | ---: |`);
  for (const c of t.categories) {
    l.push(`| ${c.label} | ${c.flips} | ${formatCents(c.costCents)} | ${formatCents(c.revenueCents)} | ${formatCents(c.netCents)} | ${signPct(c.roi)} |`);
  }
  l.push("");
  return l.join("\n");
}

// ---- svg helpers -------------------------------------------------------------------------------

interface ChartGeom {
  readonly w: number;
  readonly h: number;
  readonly padL: number;
  readonly padR: number;
  readonly padT: number;
  readonly padB: number;
}

const GEOM: ChartGeom = { w: 760, h: 240, padL: 8, padR: 8, padT: 12, padB: 22 };

function xAt(i: number, n: number): number {
  const { w, padL, padR } = GEOM;
  return n <= 1 ? padL : padL + (i / (n - 1)) * (w - padL - padR);
}
function yAt(v: number, max: number): number {
  const { h, padT, padB } = GEOM;
  const span = max <= 0 ? 1 : max;
  return h - padB - (v / span) * (h - padT - padB);
}

/** Stacked-area SVG of cash (bottom) + inventory (top); the top edge is equity. */
function equitySvg(daily: readonly DailyPoint[]): string {
  const n = daily.length;
  if (n === 0) return "";
  const cash = daily.map((d) => Number(d.cashCents));
  const equity = daily.map((d) => Number(d.equityCents));
  const max = Math.max(...equity, 1) * 1.06;
  const baseY = yAt(0, max);

  const cashTop = daily.map((_, i) => `${xAt(i, n).toFixed(1)},${yAt(cash[i]!, max).toFixed(1)}`);
  const eqTop = daily.map((_, i) => `${xAt(i, n).toFixed(1)},${yAt(equity[i]!, max).toFixed(1)}`);

  const cashArea = `M${xAt(0, n).toFixed(1)},${baseY.toFixed(1)} L${cashTop.join(" L")} L${xAt(n - 1, n).toFixed(1)},${baseY.toFixed(1)} Z`;
  // inventory band: forward along equity top, back along cash top.
  const invArea = `M${eqTop.join(" L")} L${[...cashTop].reverse().join(" L")} Z`;
  const eqLine = `M${eqTop.join(" L")}`;

  const endEquity = equity[n - 1]!;
  const startEquity = equity[0]!;
  const endTone = endEquity >= startEquity ? "var(--green)" : "var(--red)";

  return `<svg viewBox="0 0 ${GEOM.w} ${GEOM.h}" role="img" aria-label="Equity, cash and inventory over ${n} days" preserveAspectRatio="none" class="chart">
  <line x1="${GEOM.padL}" y1="${baseY.toFixed(1)}" x2="${GEOM.w - GEOM.padR}" y2="${baseY.toFixed(1)}" class="axis"/>
  <path d="${cashArea}" fill="var(--blue)" fill-opacity="0.16"/>
  <path d="${invArea}" fill="var(--green)" fill-opacity="0.20"/>
  <path d="${cashTop.length ? `M${cashTop.join(" L")}` : ""}" fill="none" stroke="var(--blue)" stroke-width="1.25" stroke-opacity="0.7"/>
  <path d="${eqLine}" fill="none" stroke="${endTone}" stroke-width="2"/>
</svg>`;
}

/** A labeled coverage bar: empirical fill against a nominal tick. */
function coverageBar(label: string, empirical: number, nominal: number): string {
  const W = 320;
  const fill = Math.round(empirical * W);
  const tick = Math.round(nominal * W);
  return `<div class="cov">
    <div class="cov-l">${label}</div>
    <div class="cov-track" style="width:${W}px">
      <div class="cov-fill" style="width:${fill}px"></div>
      <div class="cov-tick" style="left:${tick}px" title="nominal ${pct(nominal, 0)}"></div>
    </div>
    <div class="cov-v num">${pct(empirical)} <span class="faint">/ ${pct(nominal, 0)}</span></div>
  </div>`;
}

function kpi(label: string, value: string, hint: string, tone?: "pos" | "neg"): string {
  return `<div class="kpi"><div class="k">${label}</div><div class="v ${tone ?? ""}">${value}</div><div class="hint">${hint}</div></div>`;
}

function categoryRows(cats: readonly CategoryStat[]): string {
  const maxNet = Math.max(1, ...cats.map((c) => Math.abs(Number(c.netCents))));
  return cats
    .map((c) => {
      const w = Math.round((Math.abs(Number(c.netCents)) / maxNet) * 100);
      const tone = c.netCents >= 0n ? "pos" : "neg";
      return `<tr>
      <td>${c.label}</td>
      <td class="r num">${c.flips}</td>
      <td class="r num">${formatCents(c.costCents)}</td>
      <td class="r num">${formatCents(c.revenueCents)}</td>
      <td class="r num ${tone}">${formatCents(c.netCents)}</td>
      <td class="r num ${tone}">${signPct(c.roi)}</td>
      <td class="spark"><span class="bar ${tone}" style="width:${w}%"></span></td>
    </tr>`;
    })
    .join("\n");
}

const money = (c: Cents): string => formatCents(c);

/**
 * A self-contained, deterministic HTML tearsheet in the desk's terminal aesthetic. No external
 * assets, no wall-clock — identical input yields identical bytes, so the CLI's determinism test can
 * assert byte-equality. Renders light and dark via prefers-color-scheme.
 */
export function renderHtml(result: SimResult, t: Tearsheet): string {
  const retTone = t.totalReturn >= 0 ? "pos" : "neg";
  const mwrTone = t.moneyWeightedReturn >= 0 ? "pos" : "neg";
  const netTone = t.netProfitCents >= 0n ? "pos" : "neg";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>FLIP DESK — simulated tearsheet · seed ${result.seed}</title>
<style>
:root{--bg:#0a0e12;--bg-elev:#10161d;--bg-elev-2:#161e28;--line:#1f2a37;--line-bright:#2b3a4d;--fg:#d7e0ea;--fg-dim:#8595a7;--fg-faint:#566274;--green:#4ade80;--amber:#fbbf24;--red:#f87171;--blue:#60a5fa;--mono:ui-monospace,"SF Mono","JetBrains Mono","Cascadia Code",Menlo,Consolas,monospace}
@media (prefers-color-scheme:light){:root{--bg:#f4f6f8;--bg-elev:#fff;--bg-elev-2:#eef1f4;--line:#d9dee4;--line-bright:#c3cbd4;--fg:#1a2229;--fg-dim:#556575;--fg-faint:#8695a4;--green:#128a4a;--red:#c02626;--blue:#1d5fd0}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font-family:var(--mono);font-size:13px;line-height:1.5;-webkit-font-smoothing:antialiased}
.wrap{max-width:860px;margin:0 auto;padding:28px 20px 60px}
.num{font-variant-numeric:tabular-nums}
.pos{color:var(--green)}.neg{color:var(--red)}.faint{color:var(--fg-faint)}.dim{color:var(--fg-dim)}
.brand{color:var(--green);font-weight:700;letter-spacing:.16em;font-size:12px}
h1{font-size:20px;letter-spacing:-.01em;margin:6px 0 4px}
.banner{margin:14px 0 22px;padding:9px 12px;border:1px solid color-mix(in srgb,var(--amber) 40%,transparent);border-radius:6px;background:color-mix(in srgb,var(--amber) 9%,transparent);color:var(--amber);font-size:12px}
.meta{color:var(--fg-dim);font-size:12px;margin-bottom:22px}
.card{border:1px solid var(--line);background:var(--bg-elev);border-radius:8px;padding:16px;margin-bottom:16px}
.card>h2{font-size:11px;text-transform:uppercase;letter-spacing:.1em;color:var(--fg-faint);margin:0 0 14px}
.kgrid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}
@media(max-width:680px){.kgrid{grid-template-columns:repeat(2,1fr)}}
.kpi .k{color:var(--fg-faint);text-transform:uppercase;font-size:10px;letter-spacing:.08em;margin-bottom:3px}
.kpi .v{font-size:22px;font-weight:700;font-variant-numeric:tabular-nums;letter-spacing:-.01em}
.kpi .hint{color:var(--fg-faint);font-size:10.5px;line-height:1.35;margin-top:4px}
.chart{width:100%;height:auto;display:block}
.axis{stroke:var(--line-bright);stroke-width:1}
.legend{display:flex;gap:16px;margin-top:8px;color:var(--fg-dim);font-size:11px}
.legend .sw{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:6px;vertical-align:-1px}
.cov{display:flex;align-items:center;gap:12px;margin:8px 0}
.cov-l{width:88px;color:var(--fg-dim)}
.cov-track{position:relative;height:12px;background:var(--bg-elev-2);border:1px solid var(--line);border-radius:3px}
.cov-fill{position:absolute;left:0;top:0;bottom:0;background:var(--green);opacity:.55;border-radius:2px}
.cov-tick{position:absolute;top:-3px;bottom:-3px;width:2px;background:var(--fg)}
.cov-v{width:120px;text-align:right}
table{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums}
th{text-align:left;color:var(--fg-faint);text-transform:uppercase;font-size:10px;letter-spacing:.07em;padding:6px 8px;border-bottom:1px solid var(--line)}
td{padding:7px 8px;border-bottom:1px solid var(--line)}
td.r,th.r{text-align:right}
.spark{width:80px}
.spark .bar{display:inline-block;height:8px;border-radius:2px}
.spark .bar.pos{background:var(--green)}.spark .bar.neg{background:var(--red)}
.foot{color:var(--fg-faint);font-size:11px;margin-top:8px}
</style>
</head>
<body>
<div class="wrap">
  <div class="brand">◆ FLIP DESK</div>
  <h1>Simulated tearsheet</h1>
  <div class="banner">⚠ ${SYNTHETIC_NOTE}</div>
  <div class="meta">Seed <b class="num">${result.seed}</b> · ${result.days}-day horizon from ${result.startDateIso.slice(0, 10)} · ${result.listingsSeen} listings seen, ${result.listingsTaken} bought, ${t.flips} flips settled</div>

  <div class="card">
    <h2>Headline</h2>
    <div class="kgrid">
      ${kpi("Money-weighted return", signPct(t.moneyWeightedReturn), "Return over the 90 days, weighted by when cash was actually deployed", mwrTone)}
      ${kpi("Total return", signPct(t.totalReturn), "Final equity vs every dollar contributed", retTone)}
      ${kpi("Net profit", money(t.netProfitCents), "Realized profit across all settled flips", netTone)}
      ${kpi("Hit rate", pct(t.hitRate), "Share of flips that sold for a profit")}
      ${kpi("Max drawdown", pct(t.maxDrawdown), "Deepest dip in equity from a prior high")}
      ${kpi("Capital deployed", pct(t.capitalUtilization), "Avg. share of the bankroll tied up in stock — the rest waits for deals")}
      ${kpi("Fee burden", pct(t.feeBurden), "Marketplace fees as a share of sale proceeds")}
      ${kpi("Median hold", `${t.medianHoldDays.toFixed(0)}d`, "Typical days from buy to sale")}
    </div>
    <div class="foot">Annualized IRR ${signPct(t.irrAnnual, 0)} — directional only: annualizing a 90-day window inflates the figure heavily. Read the money-weighted return above instead.</div>
  </div>

  <div class="card">
    <h2>Equity · cash + inventory</h2>
    ${equitySvg(result.daily)}
    <div class="legend">
      <span><span class="sw" style="background:var(--blue);opacity:.5"></span>Cash</span>
      <span><span class="sw" style="background:var(--green);opacity:.55"></span>Inventory at cost</span>
      <span><span class="sw" style="background:var(--green)"></span>Equity (top edge)</span>
      <span class="faint">start ${money(result.daily[0]?.equityCents ?? 0n)} → end ${money(t.finalEquityCents)}</span>
    </div>
  </div>

  <div class="card">
    <h2>Band calibration — realized vs predicted (n = ${t.calibration.n})</h2>
    ${coverageBar("P10–P90", t.calibration.coverageP10P90, t.calibration.nominalP10P90)}
    ${coverageBar("P25–P75", t.calibration.coverageP25P75, t.calibration.nominalP25P75)}
    <div class="foot">Tail balance: ${pct(t.calibration.belowP10)} of sales below P10, ${pct(t.calibration.aboveP90)} above P90 (a well-calibrated ~10% / ~10% split means the band is neither too wide nor skewed).</div>
  </div>

  <div class="card">
    <h2>By category</h2>
    <table>
      <thead><tr><th>Category</th><th class="r">Flips</th><th class="r">Cost</th><th class="r">Revenue</th><th class="r">Net</th><th class="r">ROI</th><th></th></tr></thead>
      <tbody>
        ${categoryRows(t.categories)}
      </tbody>
    </table>
  </div>

  <div class="foot">Every figure above is computed by the real FLIP DESK engine and double-entry ledger over a seeded synthetic listing stream. This validates the machinery and the math, not a live trading edge. See docs/SIMULATION.md.</div>
</div>
</body>
</html>`;
}
