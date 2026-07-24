import { describe, expect, test } from "vitest";
import { FakeLlm, type LlmRequest } from "@flip-desk/llm";
import { Analyst, type WeeklyInput } from "../src/index.js";

const input: WeeklyInput = {
  weekOf: "2026-06-29",
  flips: 14,
  netCents: 48_230n,
  regretRate: 0.11,
  calibration: { championMape: 0.25, challengerMape: 0.05, promotedVersion: "v2-refit" },
  graduations: [{ actionClass: "send_offer_ebay", from: "L2", to: "L3" }],
  requests: ["Enable T3 overlay on OfferUp"],
};

describe("Analyst weekly memo", () => {
  test("builds the structured memo and narrates it at the Opus tier", async () => {
    const seen: LlmRequest[] = [];
    const llm = new FakeLlm((req) => {
      seen.push(req);
      return "This week booked 14 flips for $482.30 net. The refit valuation model cut error to 5%. eBay offers now auto-send. I'd like your OK to try the OfferUp overlay.";
    });
    const memo = await new Analyst(llm).memo(input);

    expect(memo.headline).toContain("14 flips");
    expect(memo.headline).toContain("$482.30");
    expect(memo.whatChanged.some((s) => s.includes("v2-refit"))).toBe(true);
    expect(memo.whatChanged.some((s) => s.includes("send_offer_ebay") && s.includes("L3"))).toBe(true);
    expect(memo.wantsPermission).toContain("Enable T3 overlay on OfferUp");
    expect(memo.narrative).toContain("14 flips");
    expect(seen[0]?.model).toBe("opus");
  });

  test("a quiet week says nothing changed on its own authority", async () => {
    const memo = await new Analyst(new FakeLlm(() => "Quiet week.")).memo({
      weekOf: "2026-07-06",
      flips: 3,
      netCents: 9_000n,
      regretRate: 0.0,
      calibration: { championMape: 0.12 },
      graduations: [],
      requests: [],
    });
    expect(memo.whatChanged).toHaveLength(0);
    expect(memo.wantsPermission).toHaveLength(0);
  });
});
