import type { ConditionBand, RiskFlag } from "@flip-desk/core";
import type { Extraction } from "./extract.js";

const BAND_RANK: Record<ConditionBand, number> = { new: 4, like_new: 3, good: 2, fair: 1, parts: 0 };
const RANK_BAND: ConditionBand[] = ["parts", "fair", "good", "like_new", "new"];

export interface Grade {
  readonly band: ConditionBand;
  readonly conflict: boolean;
  readonly certainty: number; // [0,1]
  readonly riskFlags: RiskFlag[];
}

/** Map free-text red flags to structured risk flags (plan §3.2, §7.6). */
export function mapRedFlags(extraction: Extraction): RiskFlag[] {
  const flags = new Set<RiskFlag>();
  const text = [...extraction.redFlags, ...extraction.defects].join(" ").toLowerCase();
  if (/\b(stolen|filed serial|no receipt|blacklist|imei bad)\b/.test(text)) flags.add("stolen_risk");
  if (/\b(replica|clone|counterfeit|fake|knock-?off|aaa)\b/.test(text)) flags.add("counterfeit_risk");
  if (/\b(untested|as-?is|for parts|not working|doesn'?t turn on|no power)\b/.test(text)) flags.add("untested");
  if (extraction.conditionClaim === "parts") flags.add("untested");
  return [...flags];
}

/**
 * Condition grading (plan §7.3). Grades from the claim but **cross-checks it**: a high claim with
 * defects present is a `condition_conflict` — we distrust the whole listing, grade down, and widen
 * uncertainty. Vision grading (when available) overrides the claim entirely.
 */
export function gradeCondition(extraction: Extraction, visionBand?: ConditionBand): Grade {
  const riskFlags = mapRedFlags(extraction);
  const claim: ConditionBand =
    extraction.conditionClaim === "unknown" ? "good" : extraction.conditionClaim;

  if (visionBand !== undefined) {
    const conflict = BAND_RANK[visionBand] < BAND_RANK[claim] - 1;
    if (conflict && !riskFlags.includes("condition_conflict")) riskFlags.push("condition_conflict");
    return { band: visionBand, conflict, certainty: conflict ? 0.55 : 0.8, riskFlags };
  }

  const hasDefects = extraction.defects.length > 0;
  const claimIsHigh = BAND_RANK[claim] >= BAND_RANK.like_new;
  if (hasDefects && claimIsHigh) {
    if (!riskFlags.includes("condition_conflict")) riskFlags.push("condition_conflict");
    const downgraded = RANK_BAND[Math.max(0, BAND_RANK[claim] - 1)]!;
    return { band: downgraded, conflict: true, certainty: 0.5, riskFlags };
  }

  const certainty = extraction.conditionClaim === "unknown" ? 0.6 : 0.82;
  return { band: claim, conflict: false, certainty, riskFlags };
}
