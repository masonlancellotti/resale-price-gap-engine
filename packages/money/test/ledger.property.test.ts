import { describe, expect, test } from "vitest";
import * as fc from "fast-check";
import {
  type Account,
  ACCOUNTS,
  InvalidEntryError,
  Ledger,
  type RawEntry,
  UnbalancedTransactionError,
  validateTransaction,
  capitalInjection,
  purchase,
  returnRefund,
  sale,
} from "../src/index.js";

// ---- generators ---------------------------------------------------------------------------------

const account = fc.constantFrom<Account>(...ACCOUNTS);
const posCents = fc.bigInt({ min: 1n, max: 100_000_00n }); // up to $100,000
const nonNegCents = fc.bigInt({ min: 0n, max: 100_000_00n });

/** A single generic value move between two accounts — balanced on its own. */
const transferLegs = fc
  .tuple(account, account, posCents)
  .map(([from, to, amount]): RawEntry[] => [
    { account: to, debit: amount },
    { account: from, credit: amount },
  ]);

/** sale() args with the invariant fees + adFees ≤ gross. */
const saleArgs = posCents.chain((grossCents) =>
  fc.bigInt({ min: 0n, max: grossCents }).chain((feesCents) =>
    fc.bigInt({ min: 0n, max: grossCents - feesCents }).chain((adFeesCents) =>
      posCents.map((costBasisCents) => ({ grossCents, feesCents, adFeesCents, costBasisCents })),
    ),
  ),
);

/** returnRefund() args with 0 ≤ restock ≤ costBasis. */
const returnArgs = posCents.chain((costBasisCents) =>
  fc.bigInt({ min: 0n, max: costBasisCents }).chain((restockValueCents) =>
    posCents.map((refundCents) => ({ refundCents, restockValueCents, costBasisCents })),
  ),
);

// ---- the gate: the ledger balances for any generated transaction sequence ----------------------

describe("double-entry invariant (Phase 0 gate #1)", () => {
  test("a stream of business events keeps the ledger globally balanced", () => {
    const event = fc.oneof(
      posCents.map((c) => capitalInjection(c)),
      posCents.map((c) => purchase({ costBasisCents: c })),
      saleArgs.map((a) => sale(a)),
      returnArgs.map((a) => returnRefund(a)),
    );
    fc.assert(
      fc.property(fc.array(event, { maxLength: 200 }), (transactions) => {
        const ledger = new Ledger();
        for (const legs of transactions) {
          const txn = ledger.post(legs);
          // every individual transaction balances...
          const d = txn.entries.reduce((s, e) => s + e.debitCents, 0n);
          const c = txn.entries.reduce((s, e) => s + e.creditCents, 0n);
          expect(d).toBe(c);
        }
        // ...and so does the whole book.
        const tb = ledger.trialBalance();
        expect(tb.balanced).toBe(true);
        expect(tb.totalDebits).toBe(tb.totalCredits);
        expect(() => ledger.assertBalancedGlobally()).not.toThrow();
      }),
    );
  });

  test("arbitrary multi-leg balanced transactions post and foot", () => {
    fc.assert(
      fc.property(fc.array(transferLegs, { minLength: 1, maxLength: 30 }), (legSets) => {
        const entries = legSets.flat();
        const { total } = validateTransaction(entries);
        expect(total).toBeTypeOf("bigint");
        const ledger = new Ledger();
        ledger.post(entries);
        expect(ledger.isBalanced()).toBe(true);
      }),
    );
  });

  test("balanceOf across all accounts sums to zero (assets = liabilities + equity, signed)", () => {
    fc.assert(
      fc.property(fc.array(transferLegs, { minLength: 1, maxLength: 40 }), (legSets) => {
        const ledger = new Ledger();
        ledger.post(legSets.flat());
        const grand = ACCOUNTS.reduce((s, a) => s + ledger.balanceOf(a), 0n);
        expect(grand).toBe(0n);
      }),
    );
  });
});

// ---- the negative space: imbalance and illegal legs must be rejected ---------------------------

describe("imbalance and illegal entries are rejected", () => {
  test("perturbing exactly one leg by ±δ makes the transaction throw", () => {
    fc.assert(
      fc.property(
        fc.array(transferLegs, { minLength: 1, maxLength: 20 }),
        fc.bigInt({ min: 1n, max: 1000n }),
        fc.boolean(),
        (legSets, delta, bumpDebit) => {
          const entries = legSets.flat();
          const idx = 0;
          const first = entries[idx]!;
          const bumped: RawEntry = bumpDebit
            ? { account: first.account, debit: (first.debit ?? 0n) + delta }
            : { account: first.account, credit: (first.credit ?? 0n) + delta };
          // Only a real imbalance should throw; if the perturbed leg was on the "wrong" side and
          // happens to still be a valid single-sided entry, the totals shift by δ ≠ 0 either way.
          const perturbed = [bumped, ...entries.slice(1)];
          expect(() => validateTransaction(perturbed)).toThrow(UnbalancedTransactionError);
        },
      ),
    );
  });

  test("an entry with both sides nonzero is rejected", () => {
    expect(() => validateTransaction([{ account: "cash", debit: 100n, credit: 100n }])).toThrow(
      InvalidEntryError,
    );
  });

  test("an all-zero entry is rejected", () => {
    expect(() => validateTransaction([{ account: "cash", debit: 0n, credit: 0n }])).toThrow(
      InvalidEntryError,
    );
  });

  test("a negative amount is rejected", () => {
    expect(() =>
      validateTransaction([
        { account: "cash", debit: -5n },
        { account: "revenue", credit: -5n },
      ]),
    ).toThrow(InvalidEntryError);
  });

  test("an unknown account is rejected", () => {
    expect(() =>
      validateTransaction([{ account: "not_an_account" as Account, debit: 1n }]),
    ).toThrow(InvalidEntryError);
  });

  test("empty transaction is rejected", () => {
    expect(() => validateTransaction([])).toThrow(InvalidEntryError);
  });
});

// ---- named builders produce the exact ledger effect we expect ----------------------------------

describe("posting builders (plan §8.9)", () => {
  test("sale nets cash = gross − fees − adFees and relieves inventory at cost", () => {
    const ledger = new Ledger();
    ledger.post(
      sale({ grossCents: 14200n, feesCents: 1961n, adFeesCents: 426n, costBasisCents: 5000n }),
    );
    expect(ledger.balanceOf("cash")).toBe(14200n - 1961n - 426n); // 11813
    expect(ledger.balanceOf("platform_fees")).toBe(1961n);
    expect(ledger.balanceOf("ad_fees")).toBe(426n);
    expect(ledger.balanceOf("revenue")).toBe(-14200n); // credit-normal → negative signed balance
    expect(ledger.balanceOf("cogs")).toBe(5000n);
    expect(ledger.balanceOf("inventory")).toBe(-5000n);
    expect(ledger.isBalanced()).toBe(true);
  });

  test("purchase then sale leaves inventory net zero for that item", () => {
    const ledger = new Ledger();
    ledger.post(purchase({ costBasisCents: 5000n }));
    expect(ledger.balanceOf("inventory")).toBe(5000n);
    ledger.post(sale({ grossCents: 14200n, feesCents: 1961n, adFeesCents: 0n, costBasisCents: 5000n }));
    expect(ledger.balanceOf("inventory")).toBe(0n);
    expect(ledger.isBalanced()).toBe(true);
  });

  test("sale throws when fees exceed gross", () => {
    expect(() =>
      sale({ grossCents: 1000n, feesCents: 900n, adFeesCents: 200n, costBasisCents: 500n }),
    ).toThrow(InvalidEntryError);
  });

  test("returnRefund writes off the restock haircut", () => {
    const ledger = new Ledger();
    ledger.post(returnRefund({ refundCents: 14200n, restockValueCents: 3000n, costBasisCents: 5000n }));
    expect(ledger.balanceOf("write_off")).toBe(2000n);
    expect(ledger.balanceOf("inventory")).toBe(3000n);
    expect(ledger.isBalanced()).toBe(true);
  });
});
