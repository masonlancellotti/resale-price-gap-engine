import { describe, expect, test } from "vitest";
import { pctToBp } from "@flip-desk/money";
import { DEFAULT_FLOORS, feeFor, underwrite } from "../src/index.js";

describe("net-profit waterfall — §13.2 golden (DeWalt DCD996)", () => {
  // FB listing $60 "moving, must go", 6 mi away (12 mi round trip), eBay resale.
  const result = underwrite({
    channel: "ebay",
    resaleP50Cents: 14_200n, // $142.00, good condition, kit complete, n=23 comps
    fee: { pctBp: pctToBp("13.6"), fixedCents: 30n },
    promotedRateBp: pctToBp("3"),
    outboundShipCents: 1_420n, // 7 lb zone-avg commercial
    packagingCents: 150n,
    returns: { pReturnBp: pctToBp("4"), expectedLossCents: 3_500n }, // tools 4% × ~$35
    purchaseCents: 5_000n, // negotiated $50 (opener $45)
    travelMiles: 12,
    irsCentsPerMile: 70,
    aprBp: 800,
    expTtsDays: 9,
    laborMinutes: 55,
    laborRatePerHourCents: 2_500n,
  });

  test("each waterfall line matches the plan to the cent", () => {
    const line = (label: string) => result.waterfall.find((l) => l.label.startsWith(label))?.amountCents;
    expect(line("Platform fee")).toBe(-1_961n); // 13.6% of 142 + $0.30 = $19.61
    expect(line("Promoted ads")).toBe(-426n); // 3% = $4.26
    expect(line("Outbound shipping")).toBe(-1_420n);
    expect(line("Packaging")).toBe(-150n);
    expect(line("Returns reserve")).toBe(-140n); // 4% × $35 = $1.40
    expect(line("Travel")).toBe(-840n); // 12 mi × $0.70
    expect(line("Capital carry")).toBe(-12n); // $58.40 × 8%/365 × 9d
    expect(line("Labor")).toBe(-2_292n); // 55 min @ $25/hr
  });

  test("subtotals and net match the plan", () => {
    expect(result.netResaleProceedsCents).toBe(10_103n); // $101.03
    expect(result.cashAtRiskCents).toBe(5_840n); // $58.40 all-in
    expect(result.netP50Cents).toBe(1_959n); // $19.59 accounting-true
    expect(result.cashNetCents).toBe(4_251n); // $42.51 cash-in-pocket
  });

  test("ROI and per-hour metrics match the plan", () => {
    expect(result.roi).toBeCloseTo(0.335, 3); // 33% true
    expect(result.cashRoi).toBeCloseTo(0.728, 3); // 73% cash
    expect(result.dollarPerLaborHourCents).toBe(4_637n); // $46.37/hr of labor
    expect(result.dollarPerCapitalDayCents).toBe(218n); // ~$2.18/capital-day
  });

  test("floors: this marginal deal fails net_p50 but passes roi and $/hr", () => {
    // The plan uses this exact deal to show why labor belongs in the model: it's below the $25 floor.
    expect(result.floors.netP50).toBe(false); // $19.59 < $25
    expect(result.floors.roi).toBe(true); // 33% ≥ 30%
    expect(result.floors.laborHr).toBe(true); // $46/hr ≥ $30
    expect(result.floors.pass).toBe(false);
    expect(DEFAULT_FLOORS.netP50Cents).toBe(2_500n);
  });
});

describe("p_profit and break-even", () => {
  test("a wide-margin deal has p_profit near 1", () => {
    const r = underwrite({
      channel: "ebay",
      resaleP50Cents: 20_000n,
      resaleP10Cents: 17_000n,
      resaleP90Cents: 24_000n,
      fee: feeFor("ebay")!,
      outboundShipCents: 800n,
      purchaseCents: 4_000n,
      expTtsDays: 7,
      laborMinutes: 25,
    });
    expect(r.netP50Cents).toBeGreaterThan(0n);
    expect(r.breakEvenResaleCents).toBeLessThan(17_000n); // break-even below P10
    expect(r.pProfit).toBeGreaterThan(0.95);
  });

  test("a thin deal near break-even has p_profit near 0.5", () => {
    // Choose purchase so break-even ≈ P50 → about half the distribution is profitable.
    const r = underwrite({
      channel: "ebay",
      resaleP50Cents: 10_000n,
      resaleP10Cents: 8_000n,
      resaleP90Cents: 12_500n,
      fee: feeFor("ebay")!,
      outboundShipCents: 900n,
      purchaseCents: 6_450n, // tuned so break-even ≈ P50 → ~half the distribution profitable
      expTtsDays: 10,
      laborMinutes: 30,
    });
    expect(r.pProfit).toBeGreaterThan(0.4);
    expect(r.pProfit).toBeLessThan(0.6);
  });

  test("feeFor resolves the seeded eBay schedule", () => {
    const fee = feeFor("ebay");
    expect(fee?.pctBp).toBe(1360);
    expect(fee?.fixedCents).toBe(30n);
  });
});
