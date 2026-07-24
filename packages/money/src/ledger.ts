import { randomUUID } from "node:crypto";
import { type Cents, ZERO_CENTS } from "./cents.js";

/**
 * Chart of accounts (plan §6, `ledger_entry.account`). Debit-normal accounts (assets, expenses)
 * and credit-normal accounts (liabilities, revenue, capital) all live here; the double-entry
 * invariant (Σdebit = Σcredit) is what actually enforces correctness, not per-account sign.
 */
export const ACCOUNTS = [
  "cash",
  "virtual_card",
  "inventory",
  "cogs",
  "revenue",
  "platform_fees",
  "ad_fees",
  "shipping_expense",
  "shipping_income",
  "supplies",
  "mileage",
  "returns_reserve",
  "sales_tax_payable",
  "income_tax_reserve",
  "write_off",
  "capital",
] as const;

export type Account = (typeof ACCOUNTS)[number];

const ACCOUNT_SET: ReadonlySet<string> = new Set(ACCOUNTS);

/** One leg of a transaction as supplied by a caller. Exactly one of debit/credit must be nonzero. */
export interface RawEntry {
  readonly account: Account;
  readonly debit?: Cents;
  readonly credit?: Cents;
  readonly memo?: string;
  readonly refType?: string;
  readonly refId?: number;
}

/** A persisted leg. `debitCents` and `creditCents` are both present; one is always 0. */
export interface LedgerEntry {
  readonly id: number;
  readonly txnId: string;
  readonly ts: string;
  readonly account: Account;
  readonly debitCents: Cents;
  readonly creditCents: Cents;
  readonly memo?: string;
  readonly refType?: string;
  readonly refId?: number;
}

export interface Transaction {
  readonly txnId: string;
  readonly ts: string;
  readonly entries: readonly LedgerEntry[];
}

export interface PostOptions {
  readonly txnId?: string;
  readonly ts?: string;
}

export class UnbalancedTransactionError extends Error {
  constructor(
    readonly totalDebits: Cents,
    readonly totalCredits: Cents,
  ) {
    super(`unbalanced transaction: Σdebit=${totalDebits} ≠ Σcredit=${totalCredits}`);
    this.name = "UnbalancedTransactionError";
  }
}

export class InvalidEntryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidEntryError";
  }
}

interface NormalizedEntry {
  readonly account: Account;
  readonly debit: Cents;
  readonly credit: Cents;
  readonly memo?: string;
  readonly refType?: string;
  readonly refId?: number;
}

function normalize(entry: RawEntry): NormalizedEntry {
  if (!ACCOUNT_SET.has(entry.account)) {
    throw new InvalidEntryError(`unknown account: ${entry.account}`);
  }
  const debit = entry.debit ?? ZERO_CENTS;
  const credit = entry.credit ?? ZERO_CENTS;
  if (debit < 0n || credit < 0n) {
    throw new InvalidEntryError(`negative amount on ${entry.account} (debit=${debit}, credit=${credit})`);
  }
  // Schema CHECK: (debit = 0) <> (credit = 0) — exactly one side is nonzero.
  if ((debit === 0n) === (credit === 0n)) {
    throw new InvalidEntryError(
      `entry on ${entry.account} must have exactly one nonzero side (debit=${debit}, credit=${credit})`,
    );
  }
  return {
    account: entry.account,
    debit,
    credit,
    ...(entry.memo !== undefined ? { memo: entry.memo } : {}),
    ...(entry.refType !== undefined ? { refType: entry.refType } : {}),
    ...(entry.refId !== undefined ? { refId: entry.refId } : {}),
  };
}

/**
 * Validate that a set of raw entries forms a legal, balanced double-entry transaction.
 * Returns the normalized entries and the (equal) debit/credit total. Throws otherwise.
 * Pure — used both by {@link Ledger.post} and directly in tests.
 */
export function validateTransaction(entries: readonly RawEntry[]): {
  normalized: NormalizedEntry[];
  total: Cents;
} {
  if (entries.length === 0) {
    throw new InvalidEntryError("a transaction needs at least one entry");
  }
  const normalized = entries.map(normalize);
  let totalDebits = 0n;
  let totalCredits = 0n;
  for (const e of normalized) {
    totalDebits += e.debit;
    totalCredits += e.credit;
  }
  if (totalDebits !== totalCredits) {
    throw new UnbalancedTransactionError(totalDebits, totalCredits);
  }
  return { normalized, total: totalDebits };
}

/**
 * In-memory double-entry ledger (source of truth is Postgres `ledger_entry` in production; this is
 * the same posting logic, storage-agnostic). Every `post` is atomic and balanced-or-throws, so the
 * global invariant Σdebit = Σcredit holds after every successful call, by construction.
 */
export class Ledger {
  #entries: LedgerEntry[] = [];
  #nextId = 1;

  post(entries: readonly RawEntry[], opts: PostOptions = {}): Transaction {
    const { normalized } = validateTransaction(entries);
    const txnId = opts.txnId ?? randomUUID();
    const ts = opts.ts ?? new Date().toISOString();
    const posted: LedgerEntry[] = normalized.map((e) => ({
      id: this.#nextId++,
      txnId,
      ts,
      account: e.account,
      debitCents: e.debit,
      creditCents: e.credit,
      ...(e.memo !== undefined ? { memo: e.memo } : {}),
      ...(e.refType !== undefined ? { refType: e.refType } : {}),
      ...(e.refId !== undefined ? { refId: e.refId } : {}),
    }));
    this.#entries.push(...posted);
    return { txnId, ts, entries: posted };
  }

  get entries(): readonly LedgerEntry[] {
    return this.#entries;
  }

  /** Signed balance for an account: Σdebit − Σcredit (natural for debit-normal accounts). */
  balanceOf(account: Account): Cents {
    let bal = 0n;
    for (const e of this.#entries) {
      if (e.account === account) bal += e.debitCents - e.creditCents;
    }
    return bal;
  }

  trialBalance(): { totalDebits: Cents; totalCredits: Cents; balanced: boolean } {
    let totalDebits = 0n;
    let totalCredits = 0n;
    for (const e of this.#entries) {
      totalDebits += e.debitCents;
      totalCredits += e.creditCents;
    }
    return { totalDebits, totalCredits, balanced: totalDebits === totalCredits };
  }

  isBalanced(): boolean {
    return this.trialBalance().balanced;
  }

  /** The nightly invariant (plan §10.2): the whole ledger must foot. Throws if it ever doesn't. */
  assertBalancedGlobally(): void {
    const { totalDebits, totalCredits } = this.trialBalance();
    if (totalDebits !== totalCredits) {
      throw new UnbalancedTransactionError(totalDebits, totalCredits);
    }
  }
}
