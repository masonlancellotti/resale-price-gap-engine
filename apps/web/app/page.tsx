import Link from "next/link";
import { getDesk } from "./lib/desk";
import { Amount, BandChip, Pct, Verdict } from "./components/ui";

export const dynamic = "force-dynamic";

export default async function FeedPage() {
  const { desk } = await getDesk();
  const feed = await desk.feed();
  const actionable = feed.filter((o) => o.taken).length;

  return (
    <>
      <div className="page-title">
        <h1>Triage feed</h1>
        <span className="sub">
          {feed.length} scanned · {actionable} actionable · ranked push → feed → digest
        </span>
      </div>

      {feed.length === 0 ? (
        <div className="empty">No opportunities yet.</div>
      ) : (
        <div className="card">
          <div className="bd" style={{ padding: 0 }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Band</th>
                  <th>Product</th>
                  <th>Source</th>
                  <th className="r">Comp P50</th>
                  <th className="r">Net P50</th>
                  <th className="r">ROI</th>
                  <th className="r">Score</th>
                  <th>Verdict</th>
                </tr>
              </thead>
              <tbody>
                {feed.map((o) => (
                  <tr key={o.id}>
                    <td>
                      <BandChip band={o.band} />
                    </td>
                    <td>
                      <Link className="row-link" href={`/deal/${o.id}`}>
                        {o.title}
                      </Link>
                    </td>
                    <td className="dim">{o.source}</td>
                    <td className="r">
                      <Amount money={o.valuationP50} />
                    </td>
                    <td className="r">
                      <Amount money={o.netP50} sign />
                    </td>
                    <td className="r">
                      <Pct value={o.roi} />
                    </td>
                    <td className="r score">{o.score ?? "—"}</td>
                    <td>
                      <Verdict o={o} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}
