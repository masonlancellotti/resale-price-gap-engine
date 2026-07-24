import {
  capitalInjection,
  type Cents,
  Ledger,
  type RawEntry,
  returnRefund,
  sale,
  type Transaction,
} from "@flip-desk/money";

/**
 * The Bookkeeper (plan §8.9, §6 double-entry). It turns economic events into balanced ledger
 * transactions, tracks per-SKU cost basis for exact COGS, and produces the reports a CPA needs
 * (Schedule C P&L, sales-tax accrual, 1099-K reconciliation) — all in integer cents, ledger-first.
 */
export class UnknownSkuError extends Error {
  constructor(sku: string) {
    super(`no cost basis recorded for SKU ${sku}`);
    this.name = "UnknownSkuError";
  }
}

export interface PurchaseInput {
  readonly sku: string;
  readonly pricePaidCents: Cents;
  readonly taxCents?: Cents; // sales tax paid on acquisition
  readonly shipInCents?: Cents; // inbound shipping (capitalized)
  readonly travelCents?: Cents; // mileage at IRS rate (expensed, not capitalized)
  readonly refId?: number;
  readonly ts?: string;
}

export interface SaleInput {
  readonly sku: string;
  readonly grossCents: Cents;
  readonly feesCents: Cents;
  readonly adFeesCents?: Cents;
  readonly shipLabelCents?: Cents; // what we pay the carrier
  readonly shipIncomeCents?: Cents; // buyer-paid shipping
  readonly taxCollectedCents?: Cents; // sales tax we collected & owe
  readonly state?: string;
  readonly refId?: number;
  readonly ts?: string;
}

export interface ReturnInput {
  readonly sku: string;
  readonly refundCents: Cents;
  readonly restockValueCents: Cents;
  readonly refId?: number;
  readonly ts?: string;
}

export interface ScheduleC {
  readonly revenueCents: Cents;
  readonly shippingIncomeCents: Cents;
  readonly cogsCents: Cents;
  readonly platformFeesCents: Cents;
  readonly adFeesCents: Cents;
  readonly shippingExpenseCents: Cents;
  readonly suppliesCents: Cents;
  readonly mileageCents: Cents;
  readonly writeOffCents: Cents;
  readonly grossProfitCents: Cents; // revenue − cogs
  readonly netProfitCents: Cents;
}

export class Bookkeeper {
  readonly ledger: Ledger;
  readonly #costBasis = new Map<string, Cents>();
  readonly #salesTaxByState = new Map<string, Cents>();

  constructor(ledger: Ledger = new Ledger()) {
    this.ledger = ledger;
  }

  injectCapital(amountCents: Cents, ts?: string): Transaction {
    return this.ledger.post(capitalInjection(amountCents), ts ? { ts } : {});
  }

  recordPurchase(input: PurchaseInput): Transaction {
    const tax = input.taxCents ?? 0n;
    const shipIn = input.shipInCents ?? 0n;
    const travel = input.travelCents ?? 0n;
    const basis = input.pricePaidCents + tax + shipIn; // capitalized cost basis
    const cashOut = basis + travel;

    const memo = "purchase";
    const ref = input.refId !== undefined ? { refType: "purchase", refId: input.refId } : {};
    const entries: RawEntry[] = [{ account: "inventory", debit: basis, memo, ...ref }];
    if (travel > 0n) entries.push({ account: "mileage", debit: travel, memo: "pickup mileage", ...ref });
    entries.push({ account: "cash", credit: cashOut, memo, ...ref });

    const txn = this.ledger.post(entries, input.ts ? { ts: input.ts } : {});
    this.#costBasis.set(input.sku, basis);
    return txn;
  }

  costBasisOf(sku: string): Cents | undefined {
    return this.#costBasis.get(sku);
  }

  recordSale(input: SaleInput): Transaction {
    const costBasis = this.#costBasis.get(input.sku);
    if (costBasis === undefined) throw new UnknownSkuError(input.sku);

    const adFees = input.adFeesCents ?? 0n;
    const entries: RawEntry[] = [
      ...sale({
        grossCents: input.grossCents,
        feesCents: input.feesCents,
        adFeesCents: adFees,
        costBasisCents: costBasis,
        ...(input.refId !== undefined ? { refId: input.refId } : {}),
      }),
    ];

    const shipLabel = input.shipLabelCents ?? 0n;
    if (shipLabel > 0n) {
      entries.push({ account: "shipping_expense", debit: shipLabel, memo: "shipping label" });
      entries.push({ account: "cash", credit: shipLabel, memo: "shipping label" });
    }
    const shipIncome = input.shipIncomeCents ?? 0n;
    if (shipIncome > 0n) {
      entries.push({ account: "cash", debit: shipIncome, memo: "buyer-paid shipping" });
      entries.push({ account: "shipping_income", credit: shipIncome, memo: "buyer-paid shipping" });
    }
    const taxCollected = input.taxCollectedCents ?? 0n;
    if (taxCollected > 0n) {
      entries.push({ account: "cash", debit: taxCollected, memo: "sales tax collected" });
      entries.push({ account: "sales_tax_payable", credit: taxCollected, memo: "sales tax collected" });
      if (input.state) {
        this.#salesTaxByState.set(input.state, (this.#salesTaxByState.get(input.state) ?? 0n) + taxCollected);
      }
    }

    const txn = this.ledger.post(entries, input.ts ? { ts: input.ts } : {});
    // item is sold; keep its basis for audit but it no longer carries inventory value.
    return txn;
  }

  recordReturn(input: ReturnInput): Transaction {
    const costBasis = this.#costBasis.get(input.sku);
    if (costBasis === undefined) throw new UnknownSkuError(input.sku);
    const txn = this.ledger.post(
      returnRefund({
        refundCents: input.refundCents,
        restockValueCents: input.restockValueCents,
        costBasisCents: costBasis,
        ...(input.refId !== undefined ? { refId: input.refId } : {}),
      }),
      input.ts ? { ts: input.ts } : {},
    );
    // relisted item now carries its (haircut) restock value as basis.
    this.#costBasis.set(input.sku, input.restockValueCents);
    return txn;
  }

  /** Current book value of unsold inventory (Dr − Cr on the inventory account). */
  inventoryValueCents(): Cents {
    return this.ledger.balanceOf("inventory");
  }

  salesTaxByState(): ReadonlyMap<string, Cents> {
    return new Map(this.#salesTaxByState);
  }

  /** Schedule-C-style P&L derived from ledger balances (credit-normal accounts are negated). */
  scheduleC(): ScheduleC {
    const bal = (a: Parameters<Ledger["balanceOf"]>[0]) => this.ledger.balanceOf(a);
    const revenue = -bal("revenue");
    const shippingIncome = -bal("shipping_income");
    const cogs = bal("cogs");
    const platformFees = bal("platform_fees");
    const adFees = bal("ad_fees");
    const shippingExpense = bal("shipping_expense");
    const supplies = bal("supplies");
    const mileage = bal("mileage");
    const writeOff = bal("write_off");
    const grossProfit = revenue - cogs;
    const netProfit =
      revenue + shippingIncome - cogs - platformFees - adFees - shippingExpense - supplies - mileage - writeOff;
    return {
      revenueCents: revenue,
      shippingIncomeCents: shippingIncome,
      cogsCents: cogs,
      platformFeesCents: platformFees,
      adFeesCents: adFees,
      shippingExpenseCents: shippingExpense,
      suppliesCents: supplies,
      mileageCents: mileage,
      writeOffCents: writeOff,
      grossProfitCents: grossProfit,
      netProfitCents: netProfit,
    };
  }

  /** 1099-K reconciliation (plan §3.2): platform-reported gross vs our ledger revenue. */
  reconcile1099k(platformReportedCents: Cents): {
    ledgerRevenueCents: Cents;
    reportedCents: Cents;
    deltaCents: Cents;
    matched: boolean;
  } {
    const ledgerRevenue = -this.ledger.balanceOf("revenue");
    const delta = ledgerRevenue - platformReportedCents;
    return { ledgerRevenueCents: ledgerRevenue, reportedCents: platformReportedCents, deltaCents: delta, matched: delta === 0n };
  }
}
