import type { ConditionBand, Product, RiskFlag } from "@flip-desk/core";
import { extract, type LlmClient, z } from "@flip-desk/llm";
import { type Embedder, ProductIndex } from "./embedding.js";
import { type Extraction, runExtraction } from "./extract.js";
import { type FilterConfig, f0Filter, type IdentifyListing } from "./filters.js";
import { gradeCondition } from "./grade.js";

export type MatchMethod = "barcode" | "mpn" | "embed" | "llm" | "none";

export interface Identification {
  readonly listingExternalId: string;
  readonly stage: "F0" | "F1" | "F3" | "done";
  readonly passed: boolean;
  readonly reason?: string;
  readonly product?: Product;
  readonly matchConfidence: number;
  readonly matchMethod: MatchMethod;
  readonly conditionBand?: ConditionBand;
  readonly conditionCertainty: number;
  readonly extraction?: Extraction;
  readonly riskFlags: readonly RiskFlag[];
  readonly costUsd: number;
}

export interface IdentifierConfig {
  readonly filter: FilterConfig;
  readonly gotchas?: readonly string[];
  /** 0..1 LLM budget pressure; under stress the cheap-match bar rises before we spend on F2 (§7.8). */
  readonly budgetPressure?: () => number;
  readonly embedStrongThreshold?: number; // default 0.6 → resolve on embed alone
  readonly embedGap?: number; // default 0.1 → top-2 separation to skip adjudication
  readonly ambiguityFloor?: number; // default 0.4 → below this, unidentified
}

export interface IdentifyDeps {
  readonly llm: LlmClient;
  readonly embedder: Embedder;
  readonly products: ReadonlyArray<{ product: Product; text: string }>;
}

const AdjudicationSchema = z.object({ chosen: z.number().int().nullable(), reason: z.string().default("") });

/**
 * The identification funnel F0→F3 (plan §7.1–7.3). Cheap filters and a local embedding pre-match
 * run before any LLM spend; extraction (Haiku) and — only on ambiguity — catalog adjudication
 * (Sonnet, with the gotcha checklist) run last. Returns a rich result the underwriter consumes.
 */
export class Identifier {
  readonly #index: ProductIndex;
  readonly #products: ReadonlyArray<{ product: Product; text: string }>;

  constructor(
    private readonly deps: IdentifyDeps,
    private readonly cfg: IdentifierConfig,
  ) {
    this.#index = new ProductIndex(deps.embedder, deps.products);
    this.#products = deps.products;
  }

  async identify(listing: IdentifyListing): Promise<Identification> {
    const base = {
      listingExternalId: listing.externalId,
      matchMethod: "none" as MatchMethod,
      matchConfidence: 0,
      conditionCertainty: 0,
      riskFlags: [] as RiskFlag[],
      costUsd: 0,
    };

    // F0 — cheap filters.
    const f0 = f0Filter(listing, this.cfg.filter);
    if (!f0.pass) return { ...base, stage: "F0", passed: false, ...(f0.reason ? { reason: f0.reason } : {}) };

    // F1 — local embedding pre-match; under high budget pressure, drop weak matches cheaply.
    const listingVec = this.deps.embedder.embed(`${listing.title} ${listing.description ?? ""}`);
    const pressure = this.cfg.budgetPressure?.() ?? 0;
    const pre = this.#index.topK(listingVec, 1)[0];
    if (this.#index.size > 0 && pressure > 0.8 && (!pre || pre.score < 0.2 + 0.4 * pressure)) {
      return { ...base, stage: "F1", passed: false, reason: "budget_degraded_low_match" };
    }

    // F2 — structured extraction (Haiku).
    const { extraction, usage } = await runExtraction(this.deps.llm, listing);
    let costUsd = usage.costUsd;
    const grade = gradeCondition(extraction);

    // F3 — catalog resolution.
    const res = await this.#resolve(extraction, listing);
    costUsd += res.costUsd;

    const passed = res.product !== undefined;
    return {
      listingExternalId: listing.externalId,
      stage: passed ? "done" : "F3",
      passed,
      ...(res.product ? { product: res.product } : {}),
      matchConfidence: res.confidence,
      matchMethod: res.method,
      conditionBand: grade.band,
      conditionCertainty: grade.certainty,
      extraction,
      riskFlags: grade.riskFlags,
      ...(passed ? {} : { reason: "unidentified" }),
      costUsd,
    };
  }

  async #resolve(
    extraction: Extraction,
    listing: IdentifyListing,
  ): Promise<{ product?: Product; method: MatchMethod; confidence: number; costUsd: number }> {
    // Exact identifiers first (plan §7.2): barcode/MPN lookups skip the LLM entirely.
    if (extraction.upc) {
      const p = this.#findByIdentifier("upc", extraction.upc);
      if (p) return { product: p, method: "barcode", confidence: 0.98, costUsd: 0 };
    }
    if (extraction.mpn) {
      const p = this.#findByIdentifier("mpn", extraction.mpn) ?? this.#findByModel(extraction.mpn);
      if (p) return { product: p, method: "mpn", confidence: 0.95, costUsd: 0 };
    }

    const strong = this.cfg.embedStrongThreshold ?? 0.6;
    const gapNeeded = this.cfg.embedGap ?? 0.1;
    const floor = this.cfg.ambiguityFloor ?? 0.4;

    const qtext = [
      extraction.brand,
      extraction.model,
      Object.values(extraction.variant).join(" "),
      listing.title,
    ]
      .filter(Boolean)
      .join(" ");
    const hits = this.#index.topK(this.deps.embedder.embed(qtext), 2);
    const top = hits[0];
    if (!top || top.score < floor) return { method: "none", confidence: top?.score ?? 0, costUsd: 0 };

    const gap = top.score - (hits[1]?.score ?? 0);
    if (top.score >= strong && gap >= gapNeeded) {
      return { product: top.product, method: "embed", confidence: top.score, costUsd: 0 };
    }

    // Ambiguous → Sonnet adjudication with the gotcha checklist.
    const adj = await this.#adjudicate(listing, hits.map((h) => h.product));
    const chosen = adj.chosen !== null ? hits[adj.chosen] : undefined;
    if (chosen) return { product: chosen.product, method: "llm", confidence: Math.max(top.score, 0.7), costUsd: adj.costUsd };
    return { method: "none", confidence: top.score, costUsd: adj.costUsd };
  }

  #findByIdentifier(key: string, value: string): Product | undefined {
    for (const { product } of this.#products) {
      const raw = product.identifiers?.[key];
      if (raw === value) return product;
      if (Array.isArray(raw) && raw.includes(value)) return product;
    }
    return undefined;
  }

  #findByModel(model: string): Product | undefined {
    const m = model.toLowerCase();
    return this.#products.find(({ product }) => product.model?.toLowerCase() === m)?.product;
  }

  async #adjudicate(
    listing: IdentifyListing,
    candidates: readonly Product[],
  ): Promise<{ chosen: number | null; costUsd: number }> {
    const list = candidates
      .map((p, i) => `[${i}] ${p.title} (brand=${p.brand ?? "?"}, model=${p.model ?? "?"}, variant=${JSON.stringify(p.variant)})`)
      .join("\n");
    const gotchas = [...(this.cfg.gotchas ?? []), ...candidates.flatMap((c) => c.gotchas ?? [])];
    const gotchaText = gotchas.length ? `\nWatch for these confusions:\n- ${gotchas.join("\n- ")}` : "";
    const { value, usage } = await extract(this.deps.llm, AdjudicationSchema, {
      model: "sonnet",
      instruction:
        `Choose which candidate product the listing refers to, or null if none clearly match.\n` +
        `Candidates:\n${list}${gotchaText}`,
      data: [listing.title, listing.description].filter(Boolean).join("\n"),
    });
    const chosen = value.chosen !== null && value.chosen >= 0 && value.chosen < candidates.length ? value.chosen : null;
    return { chosen, costUsd: usage.costUsd };
  }
}
