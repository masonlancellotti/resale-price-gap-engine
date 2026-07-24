"use client";

import { useTransition } from "react";
import { approveOpportunity, rejectOpportunity } from "../actions";

/**
 * The L2 one-tap money gate (plan §9.1) as a UI control. Optimistic-ish via useTransition; the server
 * action mutates the store and revalidates. Terminal states render as a note, not buttons.
 */
export function DecisionButtons({ id, status }: { id: string; status: string }) {
  const [pending, start] = useTransition();

  if (status === "approved") return <span className="status-note pos">✓ Approved — purchase staged (L2)</span>;
  if (status === "rejected") return <span className="status-note dim">✗ Passed</span>;

  return (
    <div className="btn-row">
      <button className="btn buy" disabled={pending} onClick={() => start(() => approveOpportunity(id))}>
        {pending ? "…" : "Approve buy"}
      </button>
      <button className="btn pass" disabled={pending} onClick={() => start(() => rejectOpportunity(id))}>
        Pass
      </button>
    </div>
  );
}
