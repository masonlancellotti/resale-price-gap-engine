import type { Cents } from "./cents.js";
import { type Account, InvalidEntryError, type RawEntry } from "./ledger.js";

/**
 * Posting builders (plan §8.9). Each returns a set of `RawEntry` legs that is **balanced by
 * construction** — Σdebit = Σcredit is an algebraic property of the builder, so `Ledger.post` can
 * never receive an unbalanced business event from this module. These are the code-reviewed posting
 * rules referenced by the Bookkeeper.
 */

function requireNonNeg(name: string, v: Cents): void {
  if (v < 0n) throw new InvalidEntryError(`${name} must be ≥ 0, got ${v}`);
}
function requirePositive(name: string, v: Cents): void {
  if (v <= 0n) throw new InvalidEntryError(`${name} must be > 0, got ${v}`);
}

/** Generic value move: debit the destination, credit the source. */
export function transfer(from: Account, to: Account, amount: Cents, memo?: string): RawEntry[] {
  requirePositive("transfer amount", amount);
  return [
    { account: to, debit: amount, ...(memo !== undefined ? { memo } : {}) },
    { account: from, credit: amount, ...(memo !== undefined ? { memo } : {}) },
  ];
}

/** Seed the bankroll: Dr cash / Cr capital. */
export function capitalInjection(amount: Cents): RawEntry[] {
  return transfer("capital", "cash", amount, "capital injection");
}

/** Buy inventory for cash at its all-in cost basis: Dr inventory / Cr cash. */
export function purchase(args: { costBasisCents: Cents; refId?: number }): RawEntry[] {
  requirePositive("costBasisCents", args.costBasisCents);
  const memo = "purchase";
  return [
    { account: "inventory", debit: args.costBasisCents, memo, ...(args.refId !== undefined ? { refType: "purchase", refId: args.refId } : {}) },
    { account: "cash", credit: args.costBasisCents, memo, ...(args.refId !== undefined ? { refType: "purchase", refId: args.refId } : {}) },
  ];
}

/**
 * Recognize a sale (plan §8.9):
 *   Dr cash (net)         Dr platform_fees      Dr ad_fees      / Cr revenue (gross)
 *   Dr cogs (cost basis)                                        / Cr inventory (cost basis)
 * where net = gross − fees − adFees. Balanced: debits = gross + costBasis = credits.
 */
export function sale(args: {
  grossCents: Cents;
  feesCents: Cents;
  adFeesCents: Cents;
  costBasisCents: Cents;
  refId?: number;
}): RawEntry[] {
  const { grossCents, feesCents, adFeesCents, costBasisCents } = args;
  requirePositive("grossCents", grossCents);
  requireNonNeg("feesCents", feesCents);
  requireNonNeg("adFeesCents", adFeesCents);
  requirePositive("costBasisCents", costBasisCents);
  const net = grossCents - feesCents - adFeesCents;
  if (net < 0n) {
    throw new InvalidEntryError(`fees (${feesCents} + ${adFeesCents}) exceed gross (${grossCents})`);
  }
  const ref = args.refId !== undefined ? { refType: "sale", refId: args.refId } : {};
  const entries: RawEntry[] = [];
  if (net > 0n) entries.push({ account: "cash", debit: net, memo: "sale proceeds", ...ref });
  if (feesCents > 0n) entries.push({ account: "platform_fees", debit: feesCents, memo: "platform fee", ...ref });
  if (adFeesCents > 0n) entries.push({ account: "ad_fees", debit: adFeesCents, memo: "promoted ad fee", ...ref });
  entries.push({ account: "revenue", credit: grossCents, memo: "sale", ...ref });
  entries.push({ account: "cogs", debit: costBasisCents, memo: "cost of goods sold", ...ref });
  entries.push({ account: "inventory", credit: costBasisCents, memo: "relieve inventory", ...ref });
  return entries;
}

/**
 * Process a return/refund (plan §8.9): reverse cash to the buyer, restock the item at a (possibly
 * haircut) value, and write off the difference.
 *   Dr revenue (refund)                         / Cr cash (refund)
 *   Dr inventory (restock) + Dr write_off (loss) / Cr cogs (cost basis)
 * `restockValueCents` must be ≤ `costBasisCents` (the haircut is the write-off).
 */
export function returnRefund(args: {
  refundCents: Cents;
  restockValueCents: Cents;
  costBasisCents: Cents;
  refId?: number;
}): RawEntry[] {
  const { refundCents, restockValueCents, costBasisCents } = args;
  requirePositive("refundCents", refundCents);
  requireNonNeg("restockValueCents", restockValueCents);
  requirePositive("costBasisCents", costBasisCents);
  if (restockValueCents > costBasisCents) {
    throw new InvalidEntryError(`restock value ${restockValueCents} exceeds cost basis ${costBasisCents}`);
  }
  const loss = costBasisCents - restockValueCents;
  const ref = args.refId !== undefined ? { refType: "return", refId: args.refId } : {};
  const entries: RawEntry[] = [
    { account: "revenue", debit: refundCents, memo: "refund (reverse revenue)", ...ref },
    { account: "cash", credit: refundCents, memo: "refund to buyer", ...ref },
    { account: "cogs", credit: costBasisCents, memo: "reverse COGS", ...ref },
  ];
  if (restockValueCents > 0n) entries.push({ account: "inventory", debit: restockValueCents, memo: "restock", ...ref });
  if (loss > 0n) entries.push({ account: "write_off", debit: loss, memo: "return haircut write-off", ...ref });
  return entries;
}
