import type { Money, OpportunityDTO } from "@flip-desk/api";

export function BandChip({ band }: { band?: string }) {
  const b = (band ?? "archive").toLowerCase();
  return <span className={`chip ${b}`}>{b}</span>;
}

export function StateChip({ state }: { state: string }) {
  return <span className={`chip sq ${state}`}>{state}</span>;
}

export function Amount({ money, sign = false }: { money?: Money; sign?: boolean }) {
  if (!money) return <span className="faint">—</span>;
  const neg = money.cents.startsWith("-");
  const cls = !sign ? "num" : neg ? "num neg" : "num pos";
  return <span className={cls}>{money.display}</span>;
}

export function Pct({ value }: { value?: number }) {
  if (value === undefined) return <span className="faint">—</span>;
  return <span className="num">{Math.round(value * 100)}%</span>;
}

export function RiskFlags({ flags }: { flags: readonly string[] }) {
  if (flags.length === 0) return <span className="faint">none</span>;
  return (
    <span style={{ display: "inline-flex", gap: 6, flexWrap: "wrap" }}>
      {flags.map((f) => (
        <span key={f} className="chip flag">
          {f}
        </span>
      ))}
    </span>
  );
}

export function Verdict({ o }: { o: OpportunityDTO }) {
  if (!o.identified) return <span className="chip archive">unidentified</span>;
  if (o.status === "approved") return <span className="chip feed">approved</span>;
  if (o.status === "rejected") return <span className="chip archive">passed</span>;
  if (o.taken) return <span className="chip push">buy</span>;
  if (o.band === "digest") return <span className="chip digest">watch</span>;
  return <span className="chip archive">pass</span>;
}

export function KpiCard({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="card kpi-card">
      <div className="bd">
        <div className="k">{label}</div>
        <div className="v">{children}</div>
      </div>
    </div>
  );
}
