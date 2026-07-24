import type { ReactNode } from "react";

/** A single headline number with a plain-language caption underneath (the legibility rule). */
export function StatTile({ label, value, caption, tone }: { label: string; value: string; caption: string; tone?: "pos" | "neg" }) {
  return (
    <div className="stat">
      <div className="stat-k">{label}</div>
      <div className={`stat-v ${tone ?? ""}`}>{value}</div>
      <div className="stat-cap">{caption}</div>
    </div>
  );
}

/** The one-sentence "what am I looking at" framing that opens every analytics view. */
export function Takeaway({ children }: { children: ReactNode }) {
  return <p className="takeaway">{children}</p>;
}

/** An inline ⓘ that reveals a plain-language definition on hover/focus (keyboard-reachable). */
export function Info({ children }: { children: ReactNode }) {
  return (
    <span className="info" tabIndex={0} role="note">
      <span aria-hidden="true">ⓘ</span>
      <span className="info-tip">{children}</span>
    </span>
  );
}

export function SectionTitle({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="an-title">
      <h1>{title}</h1>
      <span className="sub">{sub}</span>
    </div>
  );
}
