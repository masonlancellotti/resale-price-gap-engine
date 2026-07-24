import { describe, expect, test } from "vitest";
import { KillSwitch, type Policy, Sentinel } from "@flip-desk/policy";
import { Acquirer, type AcquireRequest } from "../src/index.js";

const basePolicy: Policy = {
  purchaseDayCapCents: 100_000n,
  autonomy: { commit_purchase_checkout: "L2", commit_purchase_pickup: "L2" },
  tiersEnabled: ["T0", "T2"],
};

function req(over: Partial<AcquireRequest> = {}): AcquireRequest {
  return {
    opportunityExternalId: "opp-1",
    allInCents: 6_000n,
    purchasePriceCents: 5_000n,
    confidence: 0.8,
    band: "feed",
    hardBlock: false,
    bankroll: { totalCents: 350_000n, deployedCents: 0n },
    tier: "T2",
    scope: { source: "craigslist" },
    method: "cash_pickup",
    netP50Cents: 4_000n,
    ...over,
  };
}

describe("Acquirer — L2 approval flow (§8.6, §9)", () => {
  const acquirer = () => new Acquirer(new Sentinel({ killSwitch: new KillSwitch(), policy: basePolicy }));

  test("a good deal needs one-tap approval and produces an evidence tile", () => {
    const d = acquirer().prepare(req());
    expect(d.outcome).toBe("needs_approval");
    expect(d.tile?.allInCents).toBe(6_000n);
    expect(d.tile?.capCents).toBe(17_500n); // 5% of $3,500
    expect(d.tile?.autonomyGate).toBe("L2");
  });

  test("a hard-blocked opportunity is denied", () => {
    const d = acquirer().prepare(req({ hardBlock: true }));
    expect(d.outcome).toBe("denied");
    expect(d.reason).toBe("hard_block");
  });

  test("a buy over the position cap is denied", () => {
    const d = acquirer().prepare(req({ allInCents: 20_000n })); // > $175 per-deal cap
    expect(d.outcome).toBe("denied");
    expect(d.reason).toBe("over_position_cap");
  });

  test("a tripped kill switch denies via the Sentinel", () => {
    const ks = new KillSwitch();
    ks.trip({ kind: "source", code: "craigslist" });
    const d = new Acquirer(new Sentinel({ killSwitch: ks, policy: basePolicy })).prepare(req());
    expect(d.outcome).toBe("denied");
    expect(d.reason).toBe("kill_switch");
  });

  test("a disabled tier is denied", () => {
    const d = acquirer().prepare(req({ tier: "T4", scope: { source: "fb_mkt" } }));
    expect(d.outcome).toBe("denied");
    expect(d.reason).toBe("tier_not_enabled");
  });

  test("a graduated action class (L3) auto-executes", () => {
    const policy: Policy = { ...basePolicy, autonomy: { commit_purchase_checkout: "L3" } };
    const d = new Acquirer(new Sentinel({ killSwitch: new KillSwitch(), policy })).prepare(
      req({ method: "platform_checkout", tier: "T0", scope: { platform: "ebay" } }),
    );
    expect(d.outcome).toBe("auto_execute");
  });

  test("commit produces a bookable purchase record", () => {
    const r = req();
    const purchase = acquirer().commit(r, "human:mason", "2026-07-04T18:00:00Z");
    expect(purchase).toMatchObject({
      opportunityExternalId: "opp-1",
      pricePaidCents: 5_000n,
      method: "cash_pickup",
      approvedBy: "human:mason",
    });
  });
});
