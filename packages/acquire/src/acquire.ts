import type { Tier } from "@flip-desk/core";
import type { Cents } from "@flip-desk/money";
import type { ActionScope, Decision, Sentinel } from "@flip-desk/policy";
import { type Bankroll, type Band, positionSize, type SizingPolicy, type SizingResult } from "@flip-desk/rank";

/**
 * The Acquirer (plan §8.6): it prepares everything for a buy — funds checked against the bankroll
 * (position sizing) and the Sentinel policy gate — then presents a single approval tile. A human tap
 * commits. It never holds card numbers (plan §12.1) and never auto-buys unless an action class has
 * *graduated* to L3 (Phase 2 default is L2 one-tap, plan §9.3).
 */
export type PurchaseMethod = "cash_pickup" | "platform_checkout" | "snipe";

export interface AcquireRequest {
  readonly opportunityExternalId: string;
  readonly allInCents: Cents; // ask + tax + travel + inbound (cash at risk)
  readonly purchasePriceCents: Cents; // the ask/negotiated price actually paid
  readonly confidence: number;
  readonly band: Band;
  readonly hardBlock: boolean;
  readonly bankroll: Bankroll;
  readonly tier: Tier;
  readonly scope: ActionScope;
  readonly method: PurchaseMethod;
  readonly sizingPolicy?: SizingPolicy;
  readonly netP50Cents?: Cents;
}

export type AcquireOutcome = "auto_execute" | "needs_approval" | "denied";

export interface ApprovalTile {
  readonly opportunityExternalId: string;
  readonly allInCents: Cents;
  readonly capCents: Cents;
  readonly method: PurchaseMethod;
  readonly netP50Cents?: Cents;
  readonly autonomyGate?: string;
}

export interface AcquireDecision {
  readonly outcome: AcquireOutcome;
  readonly reason?: string;
  readonly sizing: SizingResult;
  readonly sentinel: Decision;
  readonly tile?: ApprovalTile;
}

export interface PurchaseRecord {
  readonly opportunityExternalId: string;
  readonly pricePaidCents: Cents;
  readonly allInCents: Cents;
  readonly method: PurchaseMethod;
  readonly approvedBy: string;
  readonly purchasedAt: string;
}

export class Acquirer {
  constructor(private readonly sentinel: Sentinel) {}

  prepare(req: AcquireRequest): AcquireDecision {
    const sizing = positionSize({
      bankroll: req.bankroll,
      confidence: req.confidence,
      allInCents: req.allInCents,
      ...(req.sizingPolicy ? { policy: req.sizingPolicy } : {}),
    });
    const gate = req.method === "platform_checkout" ? "commit_purchase_checkout" : "commit_purchase_pickup";
    const sentinel = this.sentinel.check({ gate, tier: req.tier, scope: req.scope, amountCents: req.allInCents });

    if (req.hardBlock) return { outcome: "denied", reason: "hard_block", sizing, sentinel };
    if (sentinel.type === "deny") return { outcome: "denied", reason: sentinel.reason, sizing, sentinel };
    if (!sizing.allowed) return { outcome: "denied", reason: "over_position_cap", sizing, sentinel };

    const tile: ApprovalTile = {
      opportunityExternalId: req.opportunityExternalId,
      allInCents: req.allInCents,
      capCents: sizing.capCents,
      method: req.method,
      ...(req.netP50Cents !== undefined ? { netP50Cents: req.netP50Cents } : {}),
      ...(sentinel.type === "gate" ? { autonomyGate: sentinel.level } : {}),
    };

    // L3/L4 (graduated) → act automatically; L2 (default money gate) → one-tap approval.
    if (sentinel.type === "allow") return { outcome: "auto_execute", sizing, sentinel, tile };
    return { outcome: "needs_approval", sizing, sentinel, tile };
  }

  /** Human tapped approve (or a graduated auto-execute). Produces the purchase to be booked. */
  commit(req: AcquireRequest, approvedBy: string, at: string): PurchaseRecord {
    return {
      opportunityExternalId: req.opportunityExternalId,
      pricePaidCents: req.purchasePriceCents,
      allInCents: req.allInCents,
      method: req.method,
      approvedBy,
      purchasedAt: at,
    };
  }
}
