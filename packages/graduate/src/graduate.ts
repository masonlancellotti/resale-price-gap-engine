import type { Autonomy } from "@flip-desk/core";

/**
 * The graduation engine (plan §9.3, §7.7). Autonomy is EARNED per action class: an L2 (one-tap) class
 * graduates to L3 (auto within envelope) only after a track record — enough samples, high agreement
 * between our recommendation and the human's decision (plan's ≥95%), and a low bad-outcome rate.
 * Breaches demote INSTANTLY (asymmetric on purpose, plan §9.1): trust is slow to earn, fast to lose.
 * This decides the LEVEL; the money envelope (≤$50, ≤$200/day) is enforced independently by the
 * Sentinel (plan §12.1).
 */
export interface ActionOutcome {
  /** Did the human approve the staged action? */
  readonly approved: boolean;
  /** Did the human's decision match what we recommended? (the agreement signal) */
  readonly followedRecommendation: boolean;
  /** Did the realized result come out fine (no loss / no policy issue)? */
  readonly realizedOk: boolean;
}

export interface GraduationCriteria {
  readonly minSamples: number;
  readonly minAgreement: number; // fraction in [0,1]
  readonly maxBadRate: number; // fraction in [0,1]
}

export const DEFAULT_GRADUATION: GraduationCriteria = { minSamples: 20, minAgreement: 0.95, maxBadRate: 0.05 };

export interface GraduationEvaluation {
  readonly actionClass: string;
  readonly n: number;
  readonly agreement: number;
  readonly badRate: number;
  readonly eligible: boolean;
  readonly reason: string;
}

export class GraduationEngine {
  readonly #records = new Map<string, ActionOutcome[]>();
  readonly #level = new Map<string, Autonomy>();

  constructor(
    initialLevels: Readonly<Record<string, Autonomy>> = {},
    private readonly criteria: GraduationCriteria = DEFAULT_GRADUATION,
  ) {
    for (const [k, v] of Object.entries(initialLevels)) this.#level.set(k, v);
  }

  level(actionClass: string): Autonomy {
    return this.#level.get(actionClass) ?? "L2";
  }

  record(actionClass: string, outcome: ActionOutcome): void {
    const rows = this.#records.get(actionClass) ?? [];
    rows.push(outcome);
    this.#records.set(actionClass, rows);
    // A bad realized outcome at L3 is a breach → instant demotion (asymmetric trust).
    if (!outcome.realizedOk && this.level(actionClass) === "L3") this.demote(actionClass, "bad_outcome");
  }

  evaluate(actionClass: string): GraduationEvaluation {
    const rows = this.#records.get(actionClass) ?? [];
    const n = rows.length;
    const agreement = n > 0 ? rows.filter((r) => r.followedRecommendation).length / n : 0;
    const badRate = n > 0 ? rows.filter((r) => !r.realizedOk).length / n : 0;
    let reason = "eligible";
    let eligible = true;
    if (n < this.criteria.minSamples) {
      eligible = false;
      reason = "insufficient_samples";
    } else if (agreement < this.criteria.minAgreement) {
      eligible = false;
      reason = "low_agreement";
    } else if (badRate > this.criteria.maxBadRate) {
      eligible = false;
      reason = "bad_outcomes";
    }
    return { actionClass, n, agreement, badRate, eligible, reason };
  }

  /** Promote L2→L3 iff the track record earns it. Returns whether a promotion happened. */
  tryPromote(actionClass: string): boolean {
    if (this.level(actionClass) !== "L2") return false;
    if (!this.evaluate(actionClass).eligible) return false;
    this.#level.set(actionClass, "L3");
    return true;
  }

  /** Instant demotion on a breach (drops one rung, floored at L2). */
  demote(actionClass: string, _reason: string): void {
    const current = this.level(actionClass);
    if (current === "L4") this.#level.set(actionClass, "L3");
    else if (current === "L3") this.#level.set(actionClass, "L2");
  }

  /** Explicit breach report (e.g. money moved wrongly) — always demotes from L3. */
  recordBreach(actionClass: string): void {
    this.demote(actionClass, "breach");
  }
}
