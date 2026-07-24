import { describe, expect, test } from "vitest";
import { type AutoBuyContext, autoBuyPermitted, DEFAULT_AUTOBUY_ENVELOPE } from "../src/index.js";

const base: AutoBuyContext = {
  level: "L3",
  allInCents: 4_000n,
  confidence: 0.85,
  categorySlug: "games",
  daySpentCents: 0n,
};

describe("auto-buy envelope (≤$50 whitelist)", () => {
  test("a small, confident, whitelisted L3 deal auto-buys", () => {
    expect(autoBuyPermitted(DEFAULT_AUTOBUY_ENVELOPE, base)).toEqual({ permitted: true, reason: "ok" });
  });

  test("an ungraduated (L2) class never auto-buys", () => {
    expect(autoBuyPermitted(DEFAULT_AUTOBUY_ENVELOPE, { ...base, level: "L2" }).reason).toBe("not_graduated");
  });

  test("over the per-deal cap falls back to approval", () => {
    expect(autoBuyPermitted(DEFAULT_AUTOBUY_ENVELOPE, { ...base, allInCents: 6_000n }).reason).toBe("over_deal_cap");
  });

  test("low confidence falls back to approval", () => {
    expect(autoBuyPermitted(DEFAULT_AUTOBUY_ENVELOPE, { ...base, confidence: 0.7 }).reason).toBe("low_confidence");
  });

  test("a non-whitelisted category falls back to approval", () => {
    expect(autoBuyPermitted(DEFAULT_AUTOBUY_ENVELOPE, { ...base, categorySlug: "cameras" }).reason).toBe(
      "category_not_whitelisted",
    );
  });

  test("the daily aggregate cap is enforced", () => {
    expect(autoBuyPermitted(DEFAULT_AUTOBUY_ENVELOPE, { ...base, daySpentCents: 18_000n, allInCents: 4_000n }).reason).toBe(
      "day_cap_exceeded",
    );
  });
});
