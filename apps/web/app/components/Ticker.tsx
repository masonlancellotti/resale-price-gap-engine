import { getDesk } from "../lib/desk";

function Kpi({ lbl, val, tone }: { lbl: string; val: string; tone?: "pos" | "neg" }) {
  return (
    <span className="kpi">
      <span className="lbl">{lbl}</span>
      <span className={`val ${tone ?? ""}`}>{val}</span>
    </span>
  );
}

/** The always-on P&L ticker (plan §14). Also surfaces the runtime mode so you can see, at a glance,
 *  whether the desk is running on Fakes (offline demo) or live I/O. */
export async function Ticker() {
  const { desk, mode } = await getDesk();
  const [summary, pnl] = await Promise.all([desk.summary(mode), desk.pnl()]);
  const netTone = pnl.netProfit.cents.startsWith("-") ? "neg" : "pos";

  return (
    <header className="ticker">
      <span className="brand">◆ FLIP&nbsp;DESK</span>
      <Kpi lbl="Net P&L" val={pnl.netProfit.display} tone={netTone} />
      <Kpi lbl="Revenue" val={pnl.revenue.display} />
      <Kpi lbl="Inventory" val={pnl.inventoryValue.display} />
      <Kpi lbl="New" val={String(summary.newCount)} />
      <Kpi lbl="Approved" val={String(summary.approvedCount)} />
      <Kpi lbl="Flips" val={String(pnl.flips)} />
      <span className="mode">
        <span className={`badge ${mode.http === "live" ? "live" : "fake"}`}>http:{mode.http}</span>
        <span className={`badge ${mode.llm === "live" ? "live" : "fake"}`}>llm:{mode.llm}</span>
        <span className="badge">store:{mode.store}</span>
      </span>
    </header>
  );
}
