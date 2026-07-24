import type { RawListing } from "@flip-desk/core";
import type { Engine, OpportunityResult } from "@flip-desk/engine";
import { formatCents } from "@flip-desk/money";

/**
 * Share-sheet underwriting (plan §4.2, the flagship compliant FB workflow): the operator shares one
 * listing from the native app; the system fetches that single user-initiated URL, underwrites it,
 * and pushes back a verdict card in seconds. Human does discovery; the machine does the thinking.
 */
export type Verdict = "buy" | "watch" | "pass";

export interface VerdictCard {
  readonly opportunity: OpportunityResult;
  readonly verdict: Verdict;
  readonly headline: string;
}

function deriveVerdict(opp: OpportunityResult): Verdict {
  if (!opp.identified) return "pass";
  if (opp.taken) return "buy";
  if (opp.band === "digest") return "watch";
  return "pass";
}

function headlineFor(opp: OpportunityResult, verdict: Verdict): string {
  if (!opp.identified) return `PASS — ${opp.reason ?? "unidentified"}`;
  const net = opp.netP50Cents !== undefined ? formatCents(opp.netP50Cents) : "?";
  const score = Math.round(opp.score ?? 0);
  return `${verdict.toUpperCase()} — net ~${net}, score ${score} (${opp.band})`;
}

export class ShareSheetService {
  constructor(private readonly engine: Engine) {}

  async underwrite(raw: RawListing): Promise<VerdictCard> {
    const opportunity = await this.engine.underwriteRaw(raw);
    const verdict = deriveVerdict(opportunity);
    return { opportunity, verdict, headline: headlineFor(opportunity, verdict) };
  }
}
