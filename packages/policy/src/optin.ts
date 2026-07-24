import type { Tier } from "@flip-desk/core";

/**
 * The opt-in ceremony record (plan §3.4, §9). Enabling a gray-tier (T3/T4) module requires the
 * operator to sign a plain-language risk acceptance — what can break, what it costs, and the P7
 * promise that on any block/ban the module HALTS and alerts rather than evading. Persisted so the
 * Sentinel can gate on it; nothing gray runs without a signature on file.
 */
export interface SignedRiskAcceptance {
  readonly tier: Tier;
  readonly operator: string;
  readonly acceptedAt: string; // ISO
  readonly riskAcknowledged: string; // the exact text the operator accepted
}

export const RISK_TEXT: Readonly<Record<string, string>> = {
  T3: "T3 runs automation on YOUR logged-in account/session. If a platform contests it, the risk is throttling, temporary limits, or losing that account. On any block or ban this module HALTS and alerts you — it never rotates identities, spoofs fingerprints, or solves CAPTCHAs (P7, COMPLIANCE.md).",
  T4: "T4 runs UNATTENDED polling against defenses that are actively hostile. Expect fast throttling/blocks; account loss is a realistic cost. Recommended posture is OFF. On any block or ban this module HALTS and alerts — zero evasion, ever (P7).",
};

/** Distinct tiers that have a signed acceptance on file → feed straight into `Policy.signedOptIns`. */
export function signedTiers(acceptances: readonly SignedRiskAcceptance[]): Tier[] {
  return [...new Set(acceptances.map((a) => a.tier))];
}
