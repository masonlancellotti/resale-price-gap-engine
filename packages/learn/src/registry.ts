import { type Cents, centsFromInt } from "@flip-desk/money";
import type { ConditionBand } from "@flip-desk/core";
import { mape, type ValuationPair } from "./calibrate.js";

/**
 * Champion/challenger model registry (plan §7.7). Every model change is a challenger, shadow-scored
 * against a held-out window (the "2 weeks" in prod), and promoted ONLY if it strictly improves
 * calibration by a margin. The champion is what ships; the challenger is auditioned. This is the
 * safety rail that stops a noisy refit from silently degrading valuations.
 */
export interface ValuationFeatures {
  readonly categoryId: number;
  readonly band: ConditionBand;
  readonly baseCents: Cents;
}

export interface CalibratedModel {
  readonly version: string;
  predict(f: ValuationFeatures): Cents;
}

export class MultiplierValuationModel implements CalibratedModel {
  constructor(
    readonly version: string,
    private readonly multipliers: ReadonlyMap<string, number>,
    private readonly fallback = 1,
  ) {}
  predict(f: ValuationFeatures): Cents {
    const m = this.multipliers.get(`${f.categoryId}:${f.band}`) ?? this.fallback;
    return centsFromInt(Math.round(Number(f.baseCents) * m));
  }
}

export interface LabeledSample {
  readonly features: ValuationFeatures;
  readonly realizedCents: Cents;
}

export function scoreModel(model: CalibratedModel, dataset: readonly LabeledSample[]): number {
  const pairs: ValuationPair[] = dataset.map((d) => ({ predictedCents: model.predict(d.features), realizedCents: d.realizedCents }));
  return mape(pairs);
}

export interface PromotionConfig {
  /** Minimum relative MAPE reduction (basis points) required to promote. */
  readonly minImprovementBp: number;
}
export const DEFAULT_PROMOTION: PromotionConfig = { minImprovementBp: 100 }; // ≥1% better

export interface PromotionResult {
  readonly promote: boolean;
  readonly championMape: number;
  readonly challengerMape: number;
  readonly improvementBp: number;
}

export function evaluatePromotion(
  champion: CalibratedModel,
  challenger: CalibratedModel,
  dataset: readonly LabeledSample[],
  cfg: PromotionConfig = DEFAULT_PROMOTION,
): PromotionResult {
  const championMape = scoreModel(champion, dataset);
  const challengerMape = scoreModel(challenger, dataset);
  const improvementBp = championMape > 0 ? ((championMape - challengerMape) / championMape) * 10_000 : 0;
  return {
    promote: challengerMape < championMape && improvementBp >= cfg.minImprovementBp,
    championMape,
    challengerMape,
    improvementBp,
  };
}

export class ModelRegistry {
  #champion: CalibratedModel;
  #challenger: CalibratedModel | undefined;
  readonly #archive: CalibratedModel[] = [];

  constructor(champion: CalibratedModel) {
    this.#champion = champion;
  }

  get champion(): CalibratedModel {
    return this.#champion;
  }
  get challenger(): CalibratedModel | undefined {
    return this.#challenger;
  }

  proposeChallenger(model: CalibratedModel): void {
    this.#challenger = model;
  }

  /** Shadow-score the challenger; promote only if it wins. Returns the evaluation either way. */
  tryPromote(dataset: readonly LabeledSample[], cfg: PromotionConfig = DEFAULT_PROMOTION): PromotionResult {
    if (!this.#challenger) throw new Error("no challenger to evaluate");
    const result = evaluatePromotion(this.#champion, this.#challenger, dataset, cfg);
    if (result.promote) {
      this.#archive.push(this.#champion);
      this.#champion = this.#challenger;
      this.#challenger = undefined;
    }
    return result;
  }

  history(): readonly CalibratedModel[] {
    return [...this.#archive];
  }
}
