import { beforeEach, describe, expect, test } from "vitest";
import { KillSwitch, type Policy, RISK_TEXT, Sentinel, type SignedRiskAcceptance, signedTiers } from "../src/index.js";

const policy: Policy = {
  purchaseDayCapCents: 20_000n, // $200/day (Appendix B)
  autonomy: {
    ingest: "L4",
    commit_purchase_checkout: "L2",
    send_offer_ebay: "L3",
    publish_api: "L3",
  },
  tiersEnabled: ["T0", "T2"],
};

let ks: KillSwitch;
beforeEach(() => {
  ks = new KillSwitch();
});

describe("Sentinel policy engine (plan §9.4)", () => {
  test("pure-compute L4 action is allowed silently", () => {
    const s = new Sentinel({ killSwitch: ks, policy });
    expect(s.check({ gate: "ingest", tier: "T0", scope: {} })).toEqual({ type: "allow" });
  });

  test("money gate defaults to a one-tap L2 human gate", () => {
    const s = new Sentinel({ killSwitch: ks, policy });
    const d = s.check({ gate: "commit_purchase_checkout", tier: "T0", scope: {}, amountCents: 5_000n });
    expect(d).toEqual({ type: "gate", level: "L2", reason: "requires_human" });
  });

  test("L3 action (eBay Best Offer) acts automatically", () => {
    const s = new Sentinel({ killSwitch: ks, policy });
    expect(s.check({ gate: "send_offer_ebay", tier: "T0", scope: { platform: "ebay" } })).toEqual({
      type: "allow",
    });
  });

  describe("daily spend cap", () => {
    test("within cap → gated (not denied)", () => {
      const s = new Sentinel({ killSwitch: ks, policy, spentTodayCents: 15_000n });
      const d = s.check({ gate: "commit_purchase_checkout", tier: "T0", scope: {}, amountCents: 4_000n });
      expect(d.type).toBe("gate");
    });
    test("over cap → denied", () => {
      const s = new Sentinel({ killSwitch: ks, policy, spentTodayCents: 15_000n });
      const d = s.check({ gate: "commit_purchase_checkout", tier: "T0", scope: {}, amountCents: 6_000n });
      expect(d).toEqual({ type: "deny", reason: "spend_cap_exceeded" });
    });
    test("non-positive amount → denied", () => {
      const s = new Sentinel({ killSwitch: ks, policy });
      expect(s.check({ gate: "commit_purchase_checkout", tier: "T0", scope: {}, amountCents: 0n })).toEqual({
        type: "deny",
        reason: "invalid_amount",
      });
    });
  });

  describe("locked invariants override everything", () => {
    test("kill-switch precedence: a global trip denies even an L4 action", () => {
      const s = new Sentinel({ killSwitch: ks, policy });
      ks.trip({ kind: "global" });
      expect(s.check({ gate: "ingest", tier: "T0", scope: {} })).toEqual({
        type: "deny",
        reason: "kill_switch",
      });
    });

    test("a suspended account freezes all actions on that platform", () => {
      const health = new Map([["ebay", "suspended" as const]]);
      const s = new Sentinel({ killSwitch: ks, policy, accountHealth: health });
      expect(s.check({ gate: "ingest", tier: "T0", scope: { platform: "ebay" } })).toEqual({
        type: "deny",
        reason: "account_suspended",
      });
    });

    test("T5 capabilities are permanently excluded", () => {
      const s = new Sentinel({ killSwitch: ks, policy });
      expect(s.check({ gate: "ingest", tier: "T5", scope: {} })).toEqual({
        type: "deny",
        reason: "t5_excluded",
      });
    });

    test("a disabled tier (T4 default-off) is denied", () => {
      const s = new Sentinel({ killSwitch: ks, policy });
      expect(s.check({ gate: "poll", tier: "T4", scope: { source: "fb_mkt" } })).toEqual({
        type: "deny",
        reason: "tier_not_enabled",
      });
    });
  });

  describe("T3/T4 opt-in ceremony (plan §3.4)", () => {
    test("enabling a gray tier is not enough — an unsigned T3 action is denied", () => {
      const s = new Sentinel({ killSwitch: ks, policy: { ...policy, tiersEnabled: ["T0", "T2", "T3"] } });
      expect(s.check({ gate: "overlay_evaluate", tier: "T3", scope: { source: "fb_mkt" } })).toEqual({
        type: "deny",
        reason: "opt_in_required",
      });
    });

    test("with a signed acceptance on file the T3 action passes the ceremony gate", () => {
      const acceptances: SignedRiskAcceptance[] = [
        { tier: "T3", operator: "mason", acceptedAt: "2026-07-04T00:00:00Z", riskAcknowledged: RISK_TEXT["T3"]! },
      ];
      const s = new Sentinel({
        killSwitch: ks,
        policy: { ...policy, tiersEnabled: ["T0", "T2", "T3"], signedOptIns: signedTiers(acceptances) },
      });
      const d = s.check({ gate: "overlay_evaluate", tier: "T3", scope: { source: "fb_mkt" } });
      expect(d.type).not.toBe("deny");
    });
  });
});
