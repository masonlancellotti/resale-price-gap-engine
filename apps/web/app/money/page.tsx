import { getDesk } from "../lib/desk";
import { Amount, KpiCard, StateChip } from "../components/ui";

export const dynamic = "force-dynamic";

export default async function MoneyPage() {
  const { desk } = await getDesk();
  const [pnl, inventory] = await Promise.all([desk.pnl(), desk.inventory()]);

  return (
    <>
      <div className="page-title">
        <h1>Money</h1>
        <span className="sub">book from the double-entry ledger (§8.9) · {pnl.flips} flip(s) booked</span>
      </div>

      <div className="grid k4" style={{ marginBottom: 12 }}>
        <KpiCard label="Net profit">
          <span className={pnl.netProfit.cents.startsWith("-") ? "neg" : "pos"}>{pnl.netProfit.display}</span>
        </KpiCard>
        <KpiCard label="Revenue">{pnl.revenue.display}</KpiCard>
        <KpiCard label="COGS + fees">
          <Amount money={{ cents: "0", display: `${pnl.cogs.display} + ${pnl.fees.display}` }} />
        </KpiCard>
        <KpiCard label="Inventory value">{pnl.inventoryValue.display}</KpiCard>
      </div>

      <div className="card">
        <div className="hd">Inventory ({inventory.length})</div>
        <div className="bd" style={{ padding: 0 }}>
          <table className="table">
            <thead>
              <tr>
                <th>SKU</th>
                <th>Product</th>
                <th>Status</th>
                <th>Bin</th>
                <th className="r">Cost basis</th>
                <th className="r">Listed</th>
                <th className="r">Sold</th>
                <th>Channels</th>
              </tr>
            </thead>
            <tbody>
              {inventory.map((it) => (
                <tr key={it.sku}>
                  <td className="dim num">{it.sku}</td>
                  <td>{it.title}</td>
                  <td>
                    <StateChip state={it.status} />
                  </td>
                  <td className="dim">{it.bin}</td>
                  <td className="r">
                    <Amount money={it.costBasis} />
                  </td>
                  <td className="r">
                    <Amount money={it.listedPrice} />
                  </td>
                  <td className="r">
                    <Amount money={it.soldPrice} />
                  </td>
                  <td className="dim">{it.channels.map((c) => c.platform).join(", ") || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
