import { describe, expect, test } from "vitest";
import * as fc from "fast-check";
import { Bookkeeper, UnknownSkuError } from "../src/index.js";

describe("Bookkeeper — a clean flip", () => {
  function bookAFlip(): Bookkeeper {
    const bk = new Bookkeeper();
    bk.injectCapital(350_000n);
    bk.recordPurchase({ sku: "FD-1", pricePaidCents: 5_000n, travelCents: 840n });
    bk.recordSale({ sku: "FD-1", grossCents: 14_200n, feesCents: 1_961n, adFeesCents: 426n, shipLabelCents: 1_420n });
    return bk;
  }

  test("ledger stays balanced", () => {
    expect(bookAFlip().ledger.isBalanced()).toBe(true);
  });

  test("inventory is relieved to zero on sale", () => {
    const bk = new Bookkeeper();
    bk.recordPurchase({ sku: "FD-1", pricePaidCents: 5_000n });
    expect(bk.inventoryValueCents()).toBe(5_000n);
    bk.recordSale({ sku: "FD-1", grossCents: 14_200n, feesCents: 1_961n });
    expect(bk.inventoryValueCents()).toBe(0n);
  });

  test("Schedule C P&L is exact", () => {
    const sc = bookAFlip().scheduleC();
    expect(sc.revenueCents).toBe(14_200n);
    expect(sc.cogsCents).toBe(5_000n);
    expect(sc.platformFeesCents).toBe(1_961n);
    expect(sc.adFeesCents).toBe(426n);
    expect(sc.shippingExpenseCents).toBe(1_420n);
    expect(sc.mileageCents).toBe(840n);
    expect(sc.grossProfitCents).toBe(9_200n);
    expect(sc.netProfitCents).toBe(4_553n); // 14200 − 5000 − 1961 − 426 − 1420 − 840
  });

  test("selling a SKU with no recorded basis throws", () => {
    const bk = new Bookkeeper();
    expect(() => bk.recordSale({ sku: "ghost", grossCents: 100n, feesCents: 10n })).toThrow(UnknownSkuError);
  });

  test("1099-K reconciliation flags a mismatch", () => {
    const bk = bookAFlip();
    expect(bk.reconcile1099k(14_200n).matched).toBe(true);
    const bad = bk.reconcile1099k(14_000n);
    expect(bad.matched).toBe(false);
    expect(bad.deltaCents).toBe(200n);
  });
});

describe("Bookkeeper — return after sale", () => {
  test("restocks at a haircut and writes off the loss", () => {
    const bk = new Bookkeeper();
    bk.recordPurchase({ sku: "FD-2", pricePaidCents: 5_000n });
    bk.recordSale({ sku: "FD-2", grossCents: 14_200n, feesCents: 1_961n });
    bk.recordReturn({ sku: "FD-2", refundCents: 14_200n, restockValueCents: 3_000n });

    expect(bk.ledger.isBalanced()).toBe(true);
    expect(bk.inventoryValueCents()).toBe(3_000n); // restocked
    expect(bk.scheduleC().writeOffCents).toBe(2_000n); // 5000 − 3000
    expect(bk.scheduleC().revenueCents).toBe(0n); // sale reversed
    expect(bk.costBasisOf("FD-2")).toBe(3_000n); // relisted basis
  });
});

describe("Bookkeeper — property: the book always foots and P&L is exact", () => {
  test("any stream of purchase+sale flips balances and nets correctly", () => {
    const flip = fc
      .bigInt({ min: 100n, max: 500_00n })
      .chain((price) =>
        fc.bigInt({ min: 1n, max: 2_000_00n }).chain((gross) =>
          fc.bigInt({ min: 0n, max: gross }).map((fees) => ({ price, gross, fees })),
        ),
      );

    fc.assert(
      fc.property(fc.array(flip, { maxLength: 100 }), (flips) => {
        const bk = new Bookkeeper();
        let expectedNet = 0n;
        flips.forEach((f, i) => {
          const sku = `FD-${i}`;
          bk.recordPurchase({ sku, pricePaidCents: f.price });
          bk.recordSale({ sku, grossCents: f.gross, feesCents: f.fees });
          expectedNet += f.gross - f.fees - f.price; // no shipping/ad/mileage here
        });
        expect(bk.ledger.isBalanced()).toBe(true);
        expect(bk.inventoryValueCents()).toBe(0n);
        expect(bk.scheduleC().netProfitCents).toBe(expectedNet);
      }),
    );
  });
});
