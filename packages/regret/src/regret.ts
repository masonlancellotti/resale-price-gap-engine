import type { Cents } from "@flip-desk/money";

/**
 * Regret watcher (plan §7.7, §6 `watch_regret`). "Deals we skipped that sold at 2× our estimate" is
 * the most valuable training signal we get for free. We record every pass/miss with our prediction,
 * then watch the listing to its terminal state and measure how wrong we were — the counterfactual
 * that the learner uses to tune the ranker and floors.
 */
export type FinalStatus = "sold" | "expired" | "active";

export interface RegretInput {
  readonly listingId: string;
  readonly skippedAt: string;
  readonly skipReason: string;
  readonly askCents: Cents;
  readonly predictedResaleP50Cents?: Cents;
  readonly predictedNetCents?: Cents;
}

export interface RegretRecord extends RegretInput {
  finalStatus?: FinalStatus;
  finalPriceCents?: Cents;
  /** finalPrice − our predicted resale (positive = we underestimated). */
  deltaVsPredictionCents?: Cents;
  /** A deal we should not have passed: it sold and we had modeled a profit. */
  missed: boolean;
}

export interface RegretSummary {
  readonly watched: number;
  readonly resolved: number;
  readonly sold: number;
  readonly missedDeals: number;
  readonly regretRate: number; // missed / resolved
  readonly avgDeltaCents: Cents;
}

export class RegretWatcher {
  readonly #records = new Map<string, RegretRecord>();

  watch(input: RegretInput): void {
    this.#records.set(input.listingId, { ...input, missed: false });
  }

  resolve(
    listingId: string,
    outcome: { finalStatus: FinalStatus; finalPriceCents?: Cents },
  ): RegretRecord | undefined {
    const rec = this.#records.get(listingId);
    if (!rec) return undefined;
    rec.finalStatus = outcome.finalStatus;
    if (outcome.finalPriceCents !== undefined) {
      rec.finalPriceCents = outcome.finalPriceCents;
      const basis = rec.predictedResaleP50Cents ?? rec.askCents;
      rec.deltaVsPredictionCents = outcome.finalPriceCents - basis;
    }
    // A miss: it sold (someone else took it) and we had modeled a profit yet passed.
    rec.missed = outcome.finalStatus === "sold" && (rec.predictedNetCents ?? 0n) > 0n;
    return rec;
  }

  records(): RegretRecord[] {
    return [...this.#records.values()];
  }

  summary(): RegretSummary {
    const all = this.records();
    const resolved = all.filter((r) => r.finalStatus !== undefined);
    const sold = resolved.filter((r) => r.finalStatus === "sold");
    const missed = resolved.filter((r) => r.missed);
    const deltas = resolved.map((r) => r.deltaVsPredictionCents).filter((d): d is Cents => d !== undefined);
    const avgDelta = deltas.length > 0 ? deltas.reduce((s, d) => s + d, 0n) / BigInt(deltas.length) : 0n;
    return {
      watched: all.length,
      resolved: resolved.length,
      sold: sold.length,
      missedDeals: missed.length,
      regretRate: resolved.length > 0 ? missed.length / resolved.length : 0,
      avgDeltaCents: avgDelta,
    };
  }

  regretRate(): number {
    return this.summary().regretRate;
  }
}
