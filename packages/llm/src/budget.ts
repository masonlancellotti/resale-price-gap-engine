import type { LlmClient, LlmRequest, LlmResponse, LlmUsage } from "./client.js";

/**
 * Daily LLM spend guard (plan §7.8). The Sentinel's global cap ($40/day default) is enforced here;
 * `pressure()` (0..1 of the cap consumed) is what the identifier reads to tighten its funnel
 * thresholds — graceful quality degradation, never a dead pipeline.
 */
export class BudgetGuard {
  #spentUsd = 0;

  constructor(public dailyCapUsd: number) {}

  get spentUsd(): number {
    return this.#spentUsd;
  }
  remaining(): number {
    return Math.max(0, this.dailyCapUsd - this.#spentUsd);
  }
  pressure(): number {
    return this.dailyCapUsd > 0 ? Math.min(1, this.#spentUsd / this.dailyCapUsd) : 1;
  }
  wouldExceed(costUsd: number): boolean {
    return this.#spentUsd + costUsd > this.dailyCapUsd;
  }
  record(costUsd: number): void {
    this.#spentUsd += costUsd;
  }
  reset(): void {
    this.#spentUsd = 0;
  }
}

export class BudgetExceededError extends Error {
  constructor(readonly capUsd: number) {
    super(`LLM daily budget of $${capUsd.toFixed(2)} exhausted`);
    this.name = "BudgetExceededError";
  }
}

/** Wrap any {@link LlmClient} so every call is metered against a {@link BudgetGuard}. */
export class BudgetedLlm implements LlmClient {
  constructor(
    private readonly inner: LlmClient,
    private readonly budget: BudgetGuard,
    private readonly onSpend?: (usage: LlmUsage, req: LlmRequest) => void,
  ) {}

  async complete(req: LlmRequest): Promise<LlmResponse> {
    if (this.budget.remaining() <= 0) throw new BudgetExceededError(this.budget.dailyCapUsd);
    const res = await this.inner.complete(req);
    this.budget.record(res.costUsd);
    this.onSpend?.({ tokensIn: res.tokensIn, tokensOut: res.tokensOut, costUsd: res.costUsd }, req);
    return res;
  }
}
