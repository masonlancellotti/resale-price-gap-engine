"use client";

import { useRef, useState } from "react";
import type { AnalyticsDTO } from "@flip-desk/api";

/** cents → "$1,234" (no decimals — these are display spar-values, exactness lives in the DTO). */
function usd(cents: number): string {
  const d = Math.round(cents / 100);
  return `$${d.toLocaleString("en-US")}`;
}
function usd2(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const VB_W = 820;
const VB_H = 300;
const PAD = { l: 8, r: 12, t: 14, b: 26 };

function useHoverX(count: number): { idx: number | null; onMove: (e: React.MouseEvent<SVGSVGElement>) => void; onLeave: () => void; ref: React.RefObject<SVGSVGElement | null> } {
  const ref = useRef<SVGSVGElement | null>(null);
  const [idx, setIdx] = useState<number | null>(null);
  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const el = ref.current;
    if (!el || count === 0) return;
    const rect = el.getBoundingClientRect();
    const vbX = ((e.clientX - rect.left) / rect.width) * VB_W;
    const frac = (vbX - PAD.l) / (VB_W - PAD.l - PAD.r);
    const i = Math.round(frac * (count - 1));
    setIdx(Math.max(0, Math.min(count - 1, i)));
  };
  return { idx, onMove, onLeave: () => setIdx(null), ref };
}

// ------------------------------------------------------------------ Equity (stacked area + line)

export function EquityChart({ equity }: { equity: AnalyticsDTO["equity"] }) {
  const { idx, onMove, onLeave, ref } = useHoverX(equity.length);
  const n = equity.length;
  if (n === 0) return null;
  const max = Math.max(...equity.map((d) => d.equityCents)) * 1.08;
  const x = (i: number) => PAD.l + (i / (n - 1)) * (VB_W - PAD.l - PAD.r);
  const y = (v: number) => VB_H - PAD.b - (v / max) * (VB_H - PAD.t - PAD.b);
  const baseY = y(0);

  const cashPts = equity.map((d, i) => `${x(i).toFixed(1)},${y(d.cashCents).toFixed(1)}`);
  const eqPts = equity.map((d, i) => `${x(i).toFixed(1)},${y(d.equityCents).toFixed(1)}`);
  const cashArea = `M${x(0).toFixed(1)},${baseY.toFixed(1)} L${cashPts.join(" L")} L${x(n - 1).toFixed(1)},${baseY.toFixed(1)} Z`;
  const invArea = `M${eqPts.join(" L")} L${[...cashPts].reverse().join(" L")} Z`;

  const gy = [0.25, 0.5, 0.75, 1].map((f) => f * max);
  const hov = idx != null ? equity[idx] : undefined;

  return (
    <figure className="chart-fig">
      <svg ref={ref} viewBox={`0 0 ${VB_W} ${VB_H}`} className="chart-svg" onMouseMove={onMove} onMouseLeave={onLeave} role="img" aria-label={`Equity over ${n} days, ending ${usd(equity[n - 1]!.equityCents)}`}>
        {gy.map((v, i) => (
          <g key={i}>
            <line x1={PAD.l} y1={y(v)} x2={VB_W - PAD.r} y2={y(v)} className="grid" />
            <text x={PAD.l} y={y(v) - 3} className="axis-lbl">{usd(v)}</text>
          </g>
        ))}
        <path d={cashArea} fill="var(--blue)" fillOpacity={0.16} />
        <path d={invArea} fill="var(--green)" fillOpacity={0.22} />
        <path d={`M${cashPts.join(" L")}`} fill="none" stroke="var(--blue)" strokeWidth={1.25} strokeOpacity={0.7} />
        <path d={`M${eqPts.join(" L")}`} fill="none" stroke="var(--green)" strokeWidth={2} />
        {hov && idx != null && (
          <g>
            <line x1={x(idx)} y1={PAD.t} x2={x(idx)} y2={baseY} className="crosshair" />
            <circle cx={x(idx)} cy={y(hov.equityCents)} r={3.5} fill="var(--green)" stroke="var(--bg)" strokeWidth={1.5} />
            <circle cx={x(idx)} cy={y(hov.cashCents)} r={3} fill="var(--blue)" stroke="var(--bg)" strokeWidth={1.5} />
          </g>
        )}
      </svg>
      <div className="chart-x"><span>{equity[0]!.date}</span><span>day {hov?.day ?? "—"}</span><span>{equity[n - 1]!.date}</span></div>
      <div className="legend">
        <span><i className="sw" style={{ background: "var(--green)" }} />Equity (cash + inventory)</span>
        <span><i className="sw" style={{ background: "var(--blue)", opacity: 0.6 }} />Cash on hand</span>
        <span><i className="sw" style={{ background: "var(--green)", opacity: 0.4 }} />Inventory at cost</span>
      </div>
      {hov ? (
        <div className="tip-inline">
          <b>Day {hov.day}</b> · {hov.date} — equity <b className="num">{usd2(hov.equityCents)}</b> · cash {usd2(hov.cashCents)} · stock {usd2(hov.inventoryCents)}
        </div>
      ) : (
        <div className="tip-inline faint">Hover the chart to read any day. Green is total worth; blue is uninvested cash.</div>
      )}
    </figure>
  );
}

// ------------------------------------------------------------ Calibration (band + realized dots)

export function CalibrationChart({ points }: { points: AnalyticsDTO["calibration"]["points"] }) {
  const [hi, setHi] = useState<number | null>(null);
  const sorted = [...points].sort((a, b) => a.p50Cents - b.p50Cents);
  const n = sorted.length;
  if (n === 0) return <div className="empty">No settled flips to calibrate yet.</div>;
  const max = Math.max(...sorted.map((p) => Math.max(p.p90Cents, p.realizedCents))) * 1.08;
  const x = (i: number) => PAD.l + 18 + (i / Math.max(1, n - 1)) * (VB_W - PAD.l - PAD.r - 30);
  const y = (v: number) => VB_H - PAD.b - (v / max) * (VB_H - PAD.t - PAD.b);
  const gy = [0.25, 0.5, 0.75, 1].map((f) => f * max);
  const hov = hi != null ? sorted[hi] : undefined;

  return (
    <figure className="chart-fig">
      <svg viewBox={`0 0 ${VB_W} ${VB_H}`} className="chart-svg" role="img" aria-label="Predicted price band versus realized sale price, per flip">
        {gy.map((v, i) => (
          <g key={i}>
            <line x1={PAD.l} y1={y(v)} x2={VB_W - PAD.r} y2={y(v)} className="grid" />
            <text x={PAD.l} y={y(v) - 3} className="axis-lbl">{usd(v)}</text>
          </g>
        ))}
        {sorted.map((p, i) => (
          <g key={i} onMouseEnter={() => setHi(i)} onMouseLeave={() => setHi(null)} className="cal-col">
            {/* predicted P10–P90 band */}
            <line x1={x(i)} y1={y(p.p10Cents)} x2={x(i)} y2={y(p.p90Cents)} stroke="var(--line-bright)" strokeWidth={hi === i ? 5 : 3} strokeLinecap="round" />
            {/* predicted P50 tick */}
            <line x1={x(i) - 3} y1={y(p.p50Cents)} x2={x(i) + 3} y2={y(p.p50Cents)} stroke="var(--fg-dim)" strokeWidth={1.5} />
            {/* realized sale — green inside band, red outside (shape too: ○ vs ◆) */}
            {p.inside ? (
              <circle cx={x(i)} cy={y(p.realizedCents)} r={hi === i ? 5 : 3.5} fill="none" stroke="var(--green)" strokeWidth={2} />
            ) : (
              <path d={diamond(x(i), y(p.realizedCents), hi === i ? 5 : 4)} fill="var(--red)" />
            )}
          </g>
        ))}
      </svg>
      <div className="legend">
        <span><i className="sw" style={{ background: "var(--line-bright)" }} />Predicted P10–P90 band</span>
        <span><svg width="14" height="14" style={{ verticalAlign: -2 }}><circle cx="7" cy="7" r="4" fill="none" stroke="var(--green)" strokeWidth="2" /></svg> Sold inside band</span>
        <span><svg width="14" height="14" style={{ verticalAlign: -2 }}><path d={diamond(7, 7, 4)} fill="var(--red)" /></svg> Sold outside band</span>
      </div>
      {hov ? (
        <div className="tip-inline">
          <b>{catLabel(hov.category)}</b> — sold <b className={hov.inside ? "num pos" : "num neg"}>{usd2(hov.realizedCents)}</b>, predicted band {usd2(hov.p10Cents)}–{usd2(hov.p90Cents)} (mid {usd2(hov.p50Cents)}). {hov.inside ? "Inside the band." : "Outside — the appraiser missed this one."}
        </div>
      ) : (
        <div className="tip-inline faint">Each column is one sold item: the grey bar is what the appraiser predicted it was worth (10th–90th percentile), the marker is what it actually sold for. Hover any column.</div>
      )}
    </figure>
  );
}

function diamond(cx: number, cy: number, r: number): string {
  return `M${cx},${cy - r} L${cx + r},${cy} L${cx},${cy + r} L${cx - r},${cy} Z`;
}

const CAT_LABELS: Record<string, string> = {
  retro_games: "Retro games",
  lego_sets: "LEGO sets",
  vinyl_records: "Vinyl records",
  music_gear: "Music gear",
  vintage_cameras: "Vintage cameras",
  calculators: "Graphing calculators",
};
function catLabel(slug: string): string {
  return CAT_LABELS[slug] ?? slug;
}

// -------------------------------------------------------------------------- Coverage bars

export function CoverageBar({ label, empirical, nominal, hint }: { label: string; empirical: number; nominal: number; hint: string }) {
  const pct = (x: number) => `${(x * 100).toFixed(0)}%`;
  return (
    <div className="cov">
      <div className="cov-head">
        <span className="cov-l">{label}</span>
        <span className="cov-v num">{pct(empirical)} <span className="faint">covered / {pct(nominal)} claimed</span></span>
      </div>
      <div className="cov-track">
        <div className="cov-fill" style={{ width: `${empirical * 100}%` }} />
        <div className="cov-tick" style={{ left: `${nominal * 100}%` }} title={`Claimed ${pct(nominal)}`} />
      </div>
      <div className="cov-hint faint">{hint}</div>
    </div>
  );
}

// -------------------------------------------------------------------------- Category bars

export function CategoryBars({ categories }: { categories: AnalyticsDTO["categories"] }) {
  const rows = [...categories];
  const maxRoi = Math.max(0.01, ...rows.map((c) => Math.abs(c.roi)));
  const pct = (x: number) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(0)}%`;
  return (
    <div className="catbars">
      {rows.map((c) => {
        const neg = c.net.cents.startsWith("-");
        const w = (Math.abs(c.roi) / maxRoi) * 100;
        return (
          <div className="catrow" key={c.slug}>
            <div className="catname">{c.label}</div>
            <div className="cattrack">
              <div className={`catfill ${neg ? "neg" : "pos"}`} style={{ width: `${w}%` }} />
            </div>
            <div className={`catroi num ${neg ? "neg" : "pos"}`}>{pct(c.roi)}</div>
            <div className="catmeta faint num">{c.flips} flip{c.flips === 1 ? "" : "s"} · net {c.net.display}</div>
          </div>
        );
      })}
    </div>
  );
}
