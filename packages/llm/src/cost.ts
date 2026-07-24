import type { ModelTier } from "./client.js";

/**
 * Per-model USD price per 1M tokens. These are **approximate, configurable placeholders** — the
 * accounting mechanism is what matters here, not the exact numbers. Verify current pricing against
 * the claude-api reference and override via {@link estimateCostUsd}'s `prices` argument in
 * production wiring; the Money view targets LLM spend < 2% of gross profit (plan §7.8).
 */
export interface ModelPrice {
  readonly inputPerMTok: number;
  readonly outputPerMTok: number;
}

export type PriceTable = Readonly<Record<ModelTier, ModelPrice>>;

export const APPROX_PRICES: PriceTable = {
  haiku: { inputPerMTok: 1, outputPerMTok: 5 },
  sonnet: { inputPerMTok: 3, outputPerMTok: 15 },
  opus: { inputPerMTok: 15, outputPerMTok: 75 },
};

export function estimateCostUsd(
  model: ModelTier,
  tokensIn: number,
  tokensOut: number,
  prices: PriceTable = APPROX_PRICES,
): number {
  const p = prices[model];
  return (tokensIn * p.inputPerMTok + tokensOut * p.outputPerMTok) / 1_000_000;
}
