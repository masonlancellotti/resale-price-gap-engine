import { getAnalytics } from "../../lib/desk";
import { CalibrationChart, CoverageBar } from "../charts";
import { Info, StatTile } from "../ui";

export const dynamic = "force-dynamic";

const pct = (x: number) => `${(x * 100).toFixed(0)}%`;

export default async function CalibrationPage() {
  const a = await getAnalytics();
  const c = a.calibration;
  const gap = c.coverageP10P90 - c.nominalP10P90;
  const verdict =
    Math.abs(gap) <= 0.05
      ? "well-calibrated — the confidence bands mean what they say"
      : gap < 0
        ? "slightly overconfident — its bands are a touch too narrow"
        : "slightly underconfident — its bands are a touch too wide";

  return (
    <>
      <p className="takeaway">
        When the appraiser drew an <b>80% confidence band</b> around an item&apos;s value, the real sale
        price landed inside it <b>{pct(c.coverageP10P90)}</b> of the time. The appraiser is <b>{verdict}</b>.
      </p>

      <div className="card">
        <div className="hd">
          Do the confidence bands hold up?
          <span className="hd-note">green tick = what the appraiser claimed · bar = what actually happened</span>
        </div>
        <div className="bd">
          <CoverageBar
            label="80% band (P10–P90)"
            empirical={c.coverageP10P90}
            nominal={c.nominalP10P90}
            hint="The appraiser says it's 80% sure the true price sits in this range. It was right this often."
          />
          <CoverageBar
            label="50% band (P25–P75)"
            empirical={c.coverageP25P75}
            nominal={c.nominalP25P75}
            hint="A tighter 50% range around the mid estimate. Coverage this close to 50% means the middle is well-judged."
          />
        </div>
      </div>

      <div className="card chart-card">
        <div className="hd">
          Predicted price band vs. what it sold for
          <span className="hd-note">one column per item, sorted cheap → expensive</span>
        </div>
        <div className="bd">
          <CalibrationChart points={c.points} />
        </div>
      </div>

      <div className="stat-grid">
        <StatTile label="Flips scored" value={String(c.n)} caption="Number of sold items compared against their prediction" />
        <StatTile
          label="Sold below the band"
          value={pct(c.belowP10)}
          tone={c.belowP10 > c.aboveP90 ? "neg" : undefined}
          caption="Came in cheaper than the appraiser's low estimate (P10)"
        />
        <StatTile
          label="Sold above the band"
          value={pct(c.aboveP90)}
          tone={c.aboveP90 > c.belowP10 ? "pos" : undefined}
          caption="Beat the appraiser's high estimate (P90)"
        />
        <StatTile
          label="Middle band (P25–P75)"
          value={pct(c.coverageP25P75)}
          caption="How often the sale hit the tight 50% range"
        />
      </div>

      <p className="fineprint">
        This is the honest &quot;show me your calibration&quot; test <Info>Calibration asks: when a model claims 80% confidence, is it actually right 80% of the time? Over- or under-coverage reveals a model that&apos;s too sure of itself, or not sure enough.</Info>: real predicted bands scored
        against real (simulated) outcomes. A balanced miss split — roughly equal below and above — means
        the bands are centered right, just a little tight.
      </p>
    </>
  );
}
