import { describe, expect, test } from "vitest";
import { type HandoffOrder, packSlip, pickRoute } from "../src/index.js";

function order(over: Partial<HandoffOrder> = {}): HandoffOrder {
  return {
    sku: "FD-2026-00007",
    title: "RetroGame One",
    bin: "B-03",
    platform: "ebay",
    trackingNumber: "TRK123",
    carrier: "USPS",
    labelUrl: "label://FD-2026-00007",
    weightOz: 20,
    saleGrossCents: 13_800n,
    ...over,
  };
}

describe("pack slip", () => {
  test("gives the helper everything and nothing more", () => {
    const slip = packSlip(order());
    expect(slip.text).toContain("Bin B-03");
    expect(slip.text).toContain("FD-2026-00007");
    expect(slip.text).toContain("TRK123");
    expect(slip.text).toContain("$138.00");
    expect(slip.text).toContain("do not contact the buyer");
    // no money/system access leaks into the sheet
    expect(slip.text).not.toMatch(/cost|profit|margin|password|token/i);
  });
});

describe("pick route", () => {
  test("orders SKUs by bin so shelves are walked once", () => {
    const slips = pickRoute([order({ bin: "C-01", sku: "S3" }), order({ bin: "A-02", sku: "S1" }), order({ bin: "B-01", sku: "S2" })]);
    expect(slips.map((s) => s.sku)).toEqual(["S1", "S2", "S3"]);
  });
});
