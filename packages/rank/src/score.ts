import type { RiskFlag } from "@flip-desk/core";
import { clamp } from "@flip-desk/stats";

/** Alert bands (plan §7.6): ≥85 push · 70–84 feed · 55–69 digest · <55 archive. */
export type Band = "push" | "feed" | "digest" | "archive";

export interface ScoreWeights {
  readonly roi: number;
  readonly pProfit: number;
  readonly liquidity: number;
  readonly confidence: number;
  readonly effort: number;
}

/** v1 priors (plan §7.6). The learner refits these against realized $/hr and pass/take behavior. */
export const DEFAULT_WEIGHTS: ScoreWeights = {
  roi: 0.35,
  pProfit: 0.25,
  liquidity: 0.2,
  confidence: 0.1,
  effort: 0.1,
};

/** Risk penalties (plan §7.6). `stolen_risk` also hard-blocks. */
export const RISK_PENALTIES: Readonly<Record<RiskFlag, number>> = {
  stolen_risk: 25,
  counterfeit_risk: 20,
  condition_conflict: 10,
  untested: 8,
  oversize: 6,
  single_provider_comps: 5,
  no_return_exit: 5,
};

export const HARD_BLOCK_FLAGS: readonly RiskFlag[] = ["stolen_risk"];

export interface ScoreInput {
  readonly roi: number;
  readonly pProfit: number;
  readonly confidence: number;
  readonly laborMinutes: number;
  readonly sellThrough90d?: number;
  readonly ttsDaysP50?: number;
  readonly riskFlags?: readonly RiskFlag[];
  readonly weights?: ScoreWeights;
}

export interface ScoreResult {
  readonly score: number; // 0..100
  readonly band: Band;
  readonly liquidity: number; // 0..1
  readonly hardBlock: boolean;
  readonly penalties: number;
  readonly components: {
    readonly roi: number;
    readonly pProfit: number;
    readonly liquidity: number;
    readonly confidence: number;
    readonly effort: number;
  };
}

/** Collapse sell-through and time-to-sale into a single [0,1] liquidity score. */
export function liquidityScore(sellThrough90d?: number, ttsDaysP50?: number): number {
  const ttsScore = ttsDaysP50 !== undefined ? clamp(1 - ttsDaysP50 / 60, 0, 1) : undefined;
  if (sellThrough90d !== undefined && ttsScore !== undefined) {
    return clamp(0.6 * sellThrough90d + 0.4 * ttsScore, 0, 1);
  }
  if (sellThrough90d !== undefined) return clamp(sellThrough90d, 0, 1);
  if (ttsScore !== undefined) return ttsScore;
  return 0.5; // no liquidity signal → neutral
}

export function bandFor(score: number, hardBlock: boolean): Band {
  if (hardBlock) return "archive";
  if (score >= 85) return "push";
  if (score >= 70) return "feed";
  if (score >= 55) return "digest";
  return "archive";
}

/** The opportunity score (plan §7.6). Pure function of underwriting + valuation + risk. */
export function score(input: ScoreInput): ScoreResult {
  const w = input.weights ?? DEFAULT_WEIGHTS;
  const roiComp = clamp(Math.min(input.roi, 1.5) / 1.5, 0, 1);
  const pProfitComp = clamp(input.pProfit, 0, 1);
  const liq = liquidityScore(input.sellThrough90d, input.ttsDaysP50);
  const confComp = clamp(input.confidence, 0, 1);
  const effortNorm = clamp(input.laborMinutes / 120, 0, 1); // 2h of handling = max effort
  const effortComp = 1 - effortNorm;

  const base =
    100 *
    (w.roi * roiComp +
      w.pProfit * pProfitComp +
      w.liquidity * liq +
      w.confidence * confComp +
      w.effort * effortComp);

  let penalties = 0;
  let hardBlock = false;
  for (const f of input.riskFlags ?? []) {
    penalties += RISK_PENALTIES[f] ?? 0;
    if (HARD_BLOCK_FLAGS.includes(f)) hardBlock = true;
  }

  const finalScore = clamp(base - penalties, 0, 100);
  return {
    score: finalScore,
    band: bandFor(finalScore, hardBlock),
    liquidity: liq,
    hardBlock,
    penalties,
    components: { roi: roiComp, pProfit: pProfitComp, liquidity: liq, confidence: confComp, effort: effortComp },
  };
}
