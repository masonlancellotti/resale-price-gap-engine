import { getDesk } from "../lib/desk";
import { BandChip } from "../components/ui";

export const dynamic = "force-dynamic";

export default async function HealthPage() {
  const { desk, mode } = await getDesk();
  const [health, alerts] = await Promise.all([desk.health(), desk.alerts()]);

  return (
    <>
      <div className="page-title">
        <h1>Health</h1>
        <span className="sub">
          adapters, tiers, and the halt-don&apos;t-sneak posture (P7) · runtime http:{mode.http} llm:{mode.llm}
        </span>
      </div>

      <div className="grid k2">
        <div className="card">
          <div className="hd">Sources &amp; tiers</div>
          <div className="bd" style={{ padding: 0 }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Source</th>
                  <th>Tier</th>
                  <th>State</th>
                  <th>Note</th>
                </tr>
              </thead>
              <tbody>
                {health.map((h) => (
                  <tr key={h.source}>
                    <td>{h.source}</td>
                    <td className="dim">{h.tier}</td>
                    <td>
                      <span className={`chip sq ${h.state}`}>{h.state}</span>
                    </td>
                    <td className="faint">{h.note ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card">
          <div className="hd">Recent alerts ({alerts.length})</div>
          <div className="bd" style={{ padding: 0 }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Band</th>
                  <th>Channel</th>
                  <th>Product</th>
                </tr>
              </thead>
              <tbody>
                {alerts.slice(0, 12).map((a) => (
                  <tr key={a.id}>
                    <td>
                      <BandChip band={a.band} />
                    </td>
                    <td className="dim">{a.channel}</td>
                    <td>{a.title}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  );
}
