import { describe, expect, test } from "vitest";
import { type ActionOutcome, GraduationEngine } from "../src/index.js";

const good: ActionOutcome = { approved: true, followedRecommendation: true, realizedOk: true };

describe("Graduation engine (§9.3)", () => {
  test("a clean track record graduates an action class L2 → L3", () => {
    const g = new GraduationEngine({ send_offer_ebay: "L2" }, { minSamples: 20, minAgreement: 0.95, maxBadRate: 0.05 });
    for (let i = 0; i < 25; i++) g.record("send_offer_ebay", good);
    const evaluation = g.evaluate("send_offer_ebay");
    expect(evaluation.eligible).toBe(true);
    expect(evaluation.agreement).toBe(1);
    expect(g.tryPromote("send_offer_ebay")).toBe(true);
    expect(g.level("send_offer_ebay")).toBe("L3");
  });

  test("insufficient samples block promotion", () => {
    const g = new GraduationEngine({ x: "L2" });
    for (let i = 0; i < 5; i++) g.record("x", good);
    expect(g.evaluate("x").reason).toBe("insufficient_samples");
    expect(g.tryPromote("x")).toBe(false);
  });

  test("too much disagreement blocks promotion", () => {
    const g = new GraduationEngine({ x: "L2" });
    for (let i = 0; i < 20; i++) g.record("x", { approved: true, followedRecommendation: i % 4 !== 0, realizedOk: true }); // 75% agreement
    expect(g.evaluate("x").reason).toBe("low_agreement");
    expect(g.tryPromote("x")).toBe(false);
  });

  test("a breach demotes L3 → L2 instantly", () => {
    const g = new GraduationEngine({ x: "L2" });
    for (let i = 0; i < 25; i++) g.record("x", good);
    g.tryPromote("x");
    expect(g.level("x")).toBe("L3");
    g.recordBreach("x");
    expect(g.level("x")).toBe("L2");
  });

  test("a bad realized outcome while at L3 self-demotes", () => {
    const g = new GraduationEngine({ x: "L2" });
    for (let i = 0; i < 25; i++) g.record("x", good);
    g.tryPromote("x");
    expect(g.level("x")).toBe("L3");
    g.record("x", { approved: true, followedRecommendation: true, realizedOk: false }); // money moved wrongly
    expect(g.level("x")).toBe("L2");
  });
});
