import type { RawListing } from "@flip-desk/core";
import type { Engine } from "@flip-desk/engine";
import type { ActionScope, Sentinel } from "@flip-desk/policy";
import { ShareSheetService, type VerdictCard } from "./sharesheet.js";

/**
 * Overlay Copilot (plan §4, §16 Phase 3): a T3 assisted-sourcing overlay. The human browses a
 * marketplace on their own logged-in session; the copilot evaluates whatever listing they're looking
 * at and returns a verdict card. Because it's T3 (own-account automation), every evaluation passes the
 * Sentinel's opt-in ceremony gate first — no signed risk-acceptance on file, no evaluation.
 */
export interface OverlayResult {
  readonly allowed: boolean;
  readonly card?: VerdictCard;
  readonly blockedReason?: string;
}

export class OverlayCopilot {
  private readonly sheet: ShareSheetService;

  constructor(
    engine: Engine,
    private readonly sentinel: Sentinel,
  ) {
    this.sheet = new ShareSheetService(engine);
  }

  async evaluate(raw: RawListing, scope: ActionScope): Promise<OverlayResult> {
    const decision = this.sentinel.check({ gate: "overlay_evaluate", tier: "T3", scope });
    if (decision.type === "deny") return { allowed: false, blockedReason: decision.reason };
    const card = await this.sheet.underwrite(raw);
    return { allowed: true, card };
  }
}
