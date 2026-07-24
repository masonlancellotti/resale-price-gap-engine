/**
 * Compliance tiers (plan §3.1) and the autonomy ladder (plan §9.1). These two enums are the spine
 * of the whole risk model: a source's Tier sets its default-enabled state and autonomy ceiling; an
 * action's Autonomy level sets how much a human is in the loop.
 */

export const TIERS = ["T0", "T1", "T2", "T3", "T4", "T5"] as const;
export type Tier = (typeof TIERS)[number];

/** Ordinal for comparisons ("is this at least T3?"). T5 is the excluded ceiling. */
export function tierRank(t: Tier): number {
  return TIERS.indexOf(t);
}

/** Default-enabled tiers per §3.1: official APIs (T0) and platform-provided feeds (T2). */
export function tierDefaultEnabled(t: Tier): boolean {
  return t === "T0" || t === "T2";
}

/** T5 is permanently excluded — never selectable, never enableable (see COMPLIANCE.md). */
export function isExcluded(t: Tier): boolean {
  return t === "T5";
}

export const AUTONOMY_LEVELS = ["L0", "L1", "L2", "L3", "L4"] as const;
export type Autonomy = (typeof AUTONOMY_LEVELS)[number];

/**
 * L0 log-only · L1 draft · L2 one-tap approve · L3 auto+undo · L4 silent auto (plan §9.1).
 * Higher rank = more autonomous.
 */
export function autonomyRank(a: Autonomy): number {
  return AUTONOMY_LEVELS.indexOf(a);
}

/** The channel a raw listing arrived through (plan §6, `listing_raw.channel`). */
export const CHANNELS = ["api", "email_alert", "share_sheet", "overlay", "export", "poll"] as const;
export type Channel = (typeof CHANNELS)[number];
