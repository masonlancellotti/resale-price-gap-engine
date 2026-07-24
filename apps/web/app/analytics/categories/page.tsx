import { getAnalytics } from "../../lib/desk";
import { CategoryBars } from "../charts";

export const dynamic = "force-dynamic";

const signPct = (x: number) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(0)}%`;

export default async function CategoriesPage() {
  const a = await getAnalytics();
  const cats = a.categories;
  const best = cats.reduce((m, c) => (c.roi > m.roi ? c : m), cats[0] ?? { label: "—", roi: 0 });
  const worst = cats.reduce((m, c) => (c.roi < m.roi ? c : m), cats[0] ?? { label: "—", roi: 0 });

  return (
    <>
      <p className="takeaway">
        {cats.length > 0 ? (
          <>
            <b className="pos">{best.label}</b> returned the most (<b className="pos">{signPct(best.roi)}</b> on
            cost); <b>{worst.label}</b> the least (<b className={worst.roi < 0 ? "neg" : ""}>{signPct(worst.roi)}</b>).
            Return on cost, by category, across every resold item.
          </>
        ) : (
          <>No categories traded yet.</>
        )}
      </p>

      <div className="card">
        <div className="hd">
          Return on cost by category
          <span className="hd-note">bar length = size of the return · green up, red down</span>
        </div>
        <div className="bd">
          <CategoryBars categories={cats} />
        </div>
      </div>

      <div className="card">
        <div className="hd">The numbers behind it</div>
        <div className="bd" style={{ padding: 0 }}>
          <table className="table">
            <thead>
              <tr>
                <th>Category</th>
                <th className="r">Flips</th>
                <th className="r">Spent</th>
                <th className="r">Sold for</th>
                <th className="r">Profit</th>
                <th className="r">Return</th>
              </tr>
            </thead>
            <tbody>
              {cats.map((c) => {
                const neg = c.net.cents.startsWith("-");
                return (
                  <tr key={c.slug}>
                    <td>{c.label}</td>
                    <td className="r num">{c.flips}</td>
                    <td className="r num">{c.cost.display}</td>
                    <td className="r num">{c.revenue.display}</td>
                    <td className={`r num ${neg ? "neg" : "pos"}`}>{c.net.display}</td>
                    <td className={`r num ${c.roi < 0 ? "neg" : "pos"}`}>{signPct(c.roi)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <p className="fineprint">
        &quot;Return&quot; is profit divided by what was spent to acquire the items — after marketplace fees
        and shipping. Simulated data; see docs/SIMULATION.md.
      </p>
    </>
  );
}
