import { type Cents, pctToBp } from "@flip-desk/money";

/**
 * Platform fee shape (plan §6 `fee_schedule`, Appendix A). Stored per platform/category with a
 * `verifiedAt` date; this seed is a **planning snapshot**, not the runtime source of truth — the DB
 * table is, and it carries a quarterly re-verification chore. Fees are basis points + fixed cents.
 */
export interface PlatformFee {
  readonly pctBp: number;
  readonly fixedCents: Cents;
  /** Separate payment-processing fee where the platform charges one on top of the selling fee. */
  readonly paymentPctBp?: number;
  readonly paymentFixedCents?: Cents;
}

export interface FeeRow extends PlatformFee {
  readonly platform: string;
  readonly category: string; // '*' = default
  readonly verifiedAt: string;
}

/** Verified 2026-07 (Appendix A). Re-check quarterly; the DB `fee_schedule` overrides this. */
export const SEED_FEE_SCHEDULE: readonly FeeRow[] = [
  { platform: "ebay", category: "*", pctBp: pctToBp("13.6"), fixedCents: 30n, verifiedAt: "2026-07-01" },
  { platform: "mercari", category: "*", pctBp: pctToBp("10"), fixedCents: 0n, verifiedAt: "2026-07-01" },
  { platform: "poshmark", category: "*", pctBp: pctToBp("20"), fixedCents: 0n, verifiedAt: "2026-07-01" },
  {
    platform: "depop",
    category: "*",
    pctBp: 0,
    fixedCents: 0n,
    paymentPctBp: pctToBp("3.3"),
    paymentFixedCents: 45n,
    verifiedAt: "2026-07-01",
  },
  { platform: "reverb", category: "*", pctBp: pctToBp("5"), fixedCents: 0n, paymentPctBp: pctToBp("3.2"), verifiedAt: "2026-07-01" },
  { platform: "discogs", category: "*", pctBp: pctToBp("9"), fixedCents: 0n, verifiedAt: "2026-07-01" },
  { platform: "bricklink", category: "*", pctBp: pctToBp("3"), fixedCents: 0n, verifiedAt: "2026-07-01" },
  { platform: "tcgplayer", category: "*", pctBp: pctToBp("10.25"), fixedCents: 0n, verifiedAt: "2026-07-01" },
  { platform: "etsy", category: "*", pctBp: pctToBp("6.5"), fixedCents: 20n, paymentPctBp: pctToBp("3"), paymentFixedCents: 25n, verifiedAt: "2026-07-01" },
];

export function feeFor(platform: string, category = "*"): PlatformFee | undefined {
  return (
    SEED_FEE_SCHEDULE.find((f) => f.platform === platform && f.category === category) ??
    SEED_FEE_SCHEDULE.find((f) => f.platform === platform && f.category === "*")
  );
}
