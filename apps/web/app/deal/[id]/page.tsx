import Link from "next/link";
import { notFound } from "next/navigation";
import { getDesk } from "../../lib/desk";
import { DecisionButtons } from "../../components/DecisionButtons";
import { Amount, BandChip, KpiCard, Pct, RiskFlags, Verdict } from "../../components/ui";

export const dynamic = "force-dynamic";

export default async function DealPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { desk } = await getDesk();
  const o = await desk.opportunity(id);
  if (!o) notFound();

  return (
    <>
      <div className="page-title">
        <Link href="/" className="dim">
          ← feed
        </Link>
        <h1>{o.title}</h1>
        <BandChip band={o.band} />
        <Verdict o={o} />
        <span className="sub">
          {o.source} · {id}
        </span>
      </div>

      <div className="grid k4" style={{ marginBottom: 12 }}>
        <KpiCard label="Comp P50">
          <Amount money={o.valuationP50} />
        </KpiCard>
        <KpiCard label="Net profit P50">
          <span className={o.netP50?.cents.startsWith("-") ? "neg" : "pos"}>
            <Amount money={o.netP50} sign />
          </span>
        </KpiCard>
        <KpiCard label="Cash at risk">
          <Amount money={o.cashAtRisk} />
        </KpiCard>
        <KpiCard label="ROI · Score">
          <Pct value={o.roi} /> <span className="faint">·</span> <span className="score">{o.score ?? "—"}</span>
        </KpiCard>
      </div>

      <div className="grid k2">
        <div className="card">
          <div className="hd">Net-profit waterfall (§7.5)</div>
          <div className="bd">
            {o.waterfall && o.waterfall.length > 0 ? (
              <table className="wf">
                <tbody>
                  {o.waterfall.map((w, i) => (
                    <tr key={i}>
                      <td>{w.label}</td>
                      <td className={`r ${w.amount.cents.startsWith("-") ? "neg" : "pos"}`}>{w.amount.display}</td>
                    </tr>
                  ))}
                  <tr className="total">
                    <td>Net (P50)</td>
                    <td className={`r ${o.netP50?.cents.startsWith("-") ? "neg" : "pos"}`}>{o.netP50?.display ?? "—"}</td>
                  </tr>
                </tbody>
              </table>
            ) : (
              <div className="faint">No waterfall (unidentified or filtered).</div>
            )}
          </div>
        </div>

        <div className="card">
          <div className="hd">Evidence &amp; decision</div>
          <div className="bd" style={{ display: "grid", gap: 14 }}>
            <div>
              <div className="k faint" style={{ marginBottom: 4 }}>
                RISK FLAGS
              </div>
              <RiskFlags flags={o.riskFlags} />
            </div>
            <div>
              <div className="k faint" style={{ marginBottom: 4 }}>
                IDENTIFICATION
              </div>
              {o.identified ? (
                <span className="chip feed">identified · product #{o.productId ?? "?"}</span>
              ) : (
                <span className="chip archive">unidentified</span>
              )}
            </div>
            <div>
              <div className="k faint" style={{ marginBottom: 6 }}>
                MONEY GATE (L2)
              </div>
              <DecisionButtons id={o.id} status={o.status} />
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
