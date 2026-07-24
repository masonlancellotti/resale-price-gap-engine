import { describe, expect, test } from "vitest";
import { type VerticalSpec, validateVertical } from "../src/index.js";

function spec(over: Partial<VerticalSpec> = {}): VerticalSpec {
  return {
    slug: "games",
    categoryId: 1,
    displayName: "Video Games & Consoles",
    compProviders: ["pricecharting", "terapeak"],
    hasProfile: true,
    hasChecklist: true,
    feeScheduleVerified: true,
    labeledSetSize: 120,
    ...over,
  };
}

describe("vertical onboarding validator", () => {
  test("a fully-prepared vertical is ready to launch", () => {
    const r = validateVertical(spec());
    expect(r.ready).toBe(true);
    expect(r.blockers).toHaveLength(0);
  });

  test("missing comps / profile / checklist / fees / labels all block", () => {
    const r = validateVertical(spec({ compProviders: [], hasProfile: false, hasChecklist: false, feeScheduleVerified: false, labeledSetSize: 10 }));
    expect(r.ready).toBe(false);
    expect(r.blockers.length).toBe(5);
  });

  test("a single-provider vertical is allowed but warned", () => {
    const r = validateVertical(spec({ compProviders: ["reverb"] }));
    expect(r.ready).toBe(true);
    expect(r.warnings.some((w) => w.includes("single-provider"))).toBe(true);
  });

  test("too-small labeled set blocks the MAPE gate", () => {
    const r = validateVertical(spec({ labeledSetSize: 40 }));
    expect(r.ready).toBe(false);
    expect(r.blockers.some((b) => b.includes("labeled set"))).toBe(true);
  });
});
