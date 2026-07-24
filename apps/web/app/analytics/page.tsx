import { getAnalytics } from "../lib/desk";
import { EquityChart } from "./charts";
import { Info, StatTile } from "./ui";

export const dynamic = "force-dynamic";

const pct = (x: number) => `${(x * 100).toFixed(0)}%`;
const signPct = (x: number) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(0)}%`;

export default async function EquityPage() {
  const a = await getAnalytics();
  const k = a.kpis;
  const grew = k.moneyWeightedReturn >= 0;

  return (
    <>
      <p className="takeaway">
        Starting capital of {k.totalContributions.display} grew to{" "}
        <b className={grew ? "pos" : "neg"}>{k.finalEquity.display}</b> over {a.meta.days} days — a{" "}
        <b className={grew ? "pos" : "neg"}>{signPct(k.moneyWeightedReturn)}</b> money-weighted return,
        earned across {a.meta.flips} flips with a {pct(k.hitRate)} win rate.
      </p>

      <div className="card chart-card">
        <div className="hd">
          Net worth over time
          <span className="hd-note">green line = everything the desk is worth (cash + unsold stock at cost)</span>
        </div>
        <div className="bd">
          <EquityChart equity={a.equity} />
        </div>
      </div>

      <div className="stat-grid">
        <StatTile
          label="Money-weighted return"
          value={signPct(k.moneyWeightedReturn)}
          tone={grew ? "pos" : "neg"}
          caption="Return over the 90 days, weighted by when cash was actually put to work"
        />
        <StatTile
          label="Total return"
          value={signPct(k.totalReturn)}
          tone={k.totalReturn >= 0 ? "pos" : "neg"}
          caption="Final net worth versus every dollar contributed"
        />
        <StatTile
          label="Net profit"
          value={k.netProfit.display}
          tone={k.netProfit.cents.startsWith("-") ? "neg" : "pos"}
          caption="Actual profit banked across all resold items"
        />
        <StatTile label="Win rate" value={pct(k.hitRate)} caption="Share of flips that sold for more than they cost" />
        <StatTile label="Worst dip" value={pct(k.maxDrawdown)} caption="Largest drop in net worth from a previous high" />
        <StatTile
          label="Capital at work"
          value={pct(k.capitalDeployed)}
          caption="Average share of the bankroll tied up in stock — the rest waits for good deals"
        />
      </div>

      <details className="more">
        <summary>More detail</summary>
        <div className="stat-grid tight">
          <StatTile
            label="Annualized IRR"
            value={signPct(k.irrAnnual)}
            tone={k.irrAnnual >= 0 ? "pos" : "neg"}
            caption="Directional only — annualizing a 90-day window inflates this. Read the money-weighted return instead."
          />
          <StatTile label="Fee burden" value={pct(k.feeBurden)} caption="Marketplace fees as a share of sale proceeds" />
          <StatTile label="Typical hold" value={`${k.medianHoldDays.toFixed(0)} days`} caption="Median time from buying an item to selling it" />
          <StatTile label="Slow hold (P90)" value={`${k.p90HoldDays.toFixed(0)} days`} caption="1 in 10 items took at least this long to sell" />
        </div>
        <p className="fineprint">
          Every figure is computed by the real FLIP DESK engine and double-entry ledger over a seeded
          synthetic market <Info>Same seed → identical result. This measures the machinery and the math, not a live trading edge.</Info> — no numbers are hardcoded.
        </p>
      </details>
    </>
  );
}
