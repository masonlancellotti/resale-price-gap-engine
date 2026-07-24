import type { Autonomy } from "@flip-desk/core";
import type { LlmClient } from "@flip-desk/llm";
import { type Cents, formatCents } from "@flip-desk/money";

/**
 * The weekly Analyst memo (plan §8.10, §7.7). An Opus-tier narration over the week's own telemetry:
 * what drifted, what the learner changed on its own authority, and what it wants PERMISSION to change.
 * The input is our own computed data (trusted — not untrusted listing text), so it goes in the
 * instruction channel. The structured summary is deterministic; only the prose is model-generated.
 */
export interface GraduationChange {
  readonly actionClass: string;
  readonly from: Autonomy;
  readonly to: Autonomy;
}

export interface WeeklyInput {
  readonly weekOf: string;
  readonly flips: number;
  readonly netCents: Cents;
  readonly regretRate: number;
  readonly calibration: { readonly championMape: number; readonly challengerMape?: number; readonly promotedVersion?: string };
  readonly graduations: readonly GraduationChange[];
  /** Things it wants the operator to approve (plan: "what it wants permission to change"). */
  readonly requests: readonly string[];
}

export interface AnalystMemo {
  readonly weekOf: string;
  readonly headline: string;
  readonly whatDrifted: readonly string[];
  readonly whatChanged: readonly string[];
  readonly wantsPermission: readonly string[];
  readonly narrative: string;
}

function pct(x: number): string {
  return `${(x * 100).toFixed(1)}%`;
}

export class Analyst {
  constructor(private readonly llm: LlmClient) {}

  async memo(input: WeeklyInput): Promise<AnalystMemo> {
    const whatDrifted = [
      `Regret rate ${pct(input.regretRate)} (deals we passed that sold).`,
      `Valuation MAPE ${pct(input.calibration.championMape)} on the shipped model.`,
    ];
    const whatChanged: string[] = [];
    if (input.calibration.promotedVersion && input.calibration.challengerMape !== undefined) {
      whatChanged.push(
        `Promoted valuation model ${input.calibration.promotedVersion}: MAPE ${pct(input.calibration.championMape)} → ${pct(input.calibration.challengerMape)}.`,
      );
    }
    for (const g of input.graduations) whatChanged.push(`${g.actionClass} graduated ${g.from} → ${g.to}.`);
    const wantsPermission = [...input.requests];

    const headline = `Week of ${input.weekOf}: ${input.flips} flips, net ${formatCents(input.netCents)}.`;

    const brief = [
      headline,
      `Drifted: ${whatDrifted.join(" ")}`,
      `Changed: ${whatChanged.join(" ") || "nothing on my own authority."}`,
      `Requests: ${wantsPermission.join("; ") || "none."}`,
    ].join("\n");

    const res = await this.llm.complete({
      model: "opus",
      instruction:
        "You are the desk's weekly analyst. Write a concise, plain-language memo (4-6 sentences) for a solo " +
        "reseller from the structured summary below. Be candid about drift, state what changed, and clearly " +
        "flag anything needing their approval. Do not invent numbers beyond the summary.\n\n" +
        brief,
    });

    return { weekOf: input.weekOf, headline, whatDrifted, whatChanged, wantsPermission, narrative: res.text };
  }
}
