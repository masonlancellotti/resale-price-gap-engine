import type { ReactNode } from "react";
import { getAnalytics } from "../lib/desk";
import { AnalyticsNav } from "./AnalyticsNav";

export const dynamic = "force-dynamic";

export default async function AnalyticsLayout({ children }: { children: ReactNode }) {
  const a = await getAnalytics();
  return (
    <div className="an">
      <div className="an-head">
        <div>
          <div className="an-eyebrow">Performance review</div>
          <h1 className="an-h1">How the desk performed</h1>
          <p className="an-lede">
            A {a.meta.days}-day dry run of the whole buy-to-sell loop, measured like a fund. The desk
            scanned {a.meta.listingsSeen.toLocaleString()} listings, bought {a.meta.listingsTaken}, and
            resold {a.meta.flips} of them.
          </p>
        </div>
        <div className="an-synthetic" role="note">
          <b>Simulated</b>
          <span>Seeded synthetic data — not real sales. Methodology in docs/SIMULATION.md.</span>
        </div>
      </div>
      <AnalyticsNav />
      <div className="an-body">{children}</div>
    </div>
  );
}
