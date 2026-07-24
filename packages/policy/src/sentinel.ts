import { type Autonomy, isExcluded, type Tier } from "@flip-desk/core";
import type { Cents } from "@flip-desk/money";
import type { ActionScope, KillSwitch } from "./killswitch.js";

/**
 * The Sentinel (plan §5.3 #15, §8.13, §9.4) evaluates every consequential action pre-flight and
 * returns allow / gate(level) / deny(reason). This Phase 0 skeleton enforces the **locked
 * invariants** that no policy edit may override (plan §9.4):
 *
 *   1. kill-switch precedence   — a tripped switch denies, period
 *   2. suspended-account freeze  — a suspended platform denies all actions
 *   3. T5 exclusion              — permanently-excluded capabilities never run
 *
 * plus tier-enablement, the daily spend cap, and autonomy resolution. Later phases add the full
 * graduation engine and YAML policy loading (Appendix B).
 */

export type AccountHealthStatus = "healthy" | "warned" | "restricted" | "suspended";

export type Decision =
  | { readonly type: "allow" }
  | { readonly type: "gate"; readonly level: Autonomy; readonly reason: string }
  | { readonly type: "deny"; readonly reason: DenyReason };

export type DenyReason =
  | "kill_switch"
  | "account_suspended"
  | "t5_excluded"
  | "tier_not_enabled"
  | "opt_in_required"
  | "spend_cap_exceeded"
  | "invalid_amount";

export interface Policy {
  /** Hard daily purchase cap. Raising it past its ceiling requires a typed re-confirm (plan §9.4). */
  readonly purchaseDayCapCents: Cents;
  /** action_class → autonomy level (Appendix B `autonomy:` block). */
  readonly autonomy: Readonly<Record<string, Autonomy>>;
  readonly tiersEnabled: readonly Tier[];
  /**
   * T3/T4 are ToS-gray and default-off; beyond being *enabled* they require a completed, signed
   * risk-acceptance ceremony (plan §3.4, §9). A tier here has that signature on file. Enabling the
   * tier without signing still denies — the ceremony is the real gate, not the toggle.
   */
  readonly signedOptIns?: readonly Tier[];
}

/** Tiers that require the signed opt-in ceremony before any action runs (plan §3.4). */
const CEREMONY_TIERS: readonly Tier[] = ["T3", "T4"];

export interface ActionRequest {
  /** e.g. 'ingest' | 'commit_purchase_checkout' | 'send_offer_ebay' | 'publish_api' | 'reprice_in_band' */
  readonly gate: string;
  readonly tier: Tier;
  readonly scope: ActionScope;
  /** Present for money-moving gates; checked against the daily cap. */
  readonly amountCents?: Cents;
}

export interface SentinelDeps {
  readonly killSwitch: KillSwitch;
  readonly policy: Policy;
  /** platform → health; a `suspended` entry freezes that platform (plan §9.4). */
  readonly accountHealth?: ReadonlyMap<string, AccountHealthStatus>;
  /** How much purchase spend has already happened today (against the cap). */
  spentTodayCents?: Cents;
}

const allow: Decision = { type: "allow" };
const deny = (reason: DenyReason): Decision => ({ type: "deny", reason });
const gate = (level: Autonomy, reason: string): Decision => ({ type: "gate", level, reason });

export class Sentinel {
  constructor(private readonly deps: SentinelDeps) {}

  check(req: ActionRequest): Decision {
    const { killSwitch, policy, accountHealth } = this.deps;

    // (1) kill-switch precedence — beats any policy, even an L4 auto action.
    if (killSwitch.isHalted(req.scope)) return deny("kill_switch");

    // (2) suspended-account freeze.
    const platform = req.scope.platform;
    if (platform !== undefined && accountHealth?.get(platform) === "suspended") {
      return deny("account_suspended");
    }

    // (3) T5 exclusion — permanent.
    if (isExcluded(req.tier)) return deny("t5_excluded");

    // Tier must be enabled (T1/T3/T4 are opt-in; this is where "default-off" is enforced).
    if (!policy.tiersEnabled.includes(req.tier)) return deny("tier_not_enabled");

    // T3/T4 additionally require the signed risk-acceptance ceremony (plan §3.4).
    if (CEREMONY_TIERS.includes(req.tier) && !(policy.signedOptIns ?? []).includes(req.tier)) {
      return deny("opt_in_required");
    }

    // Daily spend cap for money-moving gates.
    if (req.amountCents !== undefined) {
      if (req.amountCents <= 0n) return deny("invalid_amount");
      const spent = this.deps.spentTodayCents ?? 0n;
      if (spent + req.amountCents > policy.purchaseDayCapCents) return deny("spend_cap_exceeded");
    }

    // Autonomy resolution: L3/L4 act automatically; L0–L2 stage for a human (plan §9.1).
    const level = policy.autonomy[req.gate] ?? "L2";
    if (level === "L4" || level === "L3") return allow;
    return gate(level, "requires_human");
  }
}
