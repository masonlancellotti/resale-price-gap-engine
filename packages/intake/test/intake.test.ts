import { describe, expect, test } from "vitest";
import { FakeBlacklistChecker, imeiValid, Intake, luhnValid } from "../src/index.js";

const now = () => new Date("2026-07-04T00:00:00.000Z");
// Canonical Luhn-valid test IMEI (14 payload digits + check digit).
const VALID_IMEI = "490154203237518";
const INVALID_IMEI = "490154203237511";

describe("Luhn / IMEI validation", () => {
  test("known-valid numbers pass, tampered ones fail", () => {
    expect(luhnValid("4539148803436467")).toBe(true); // valid test PAN
    expect(luhnValid("1234567890123456")).toBe(false);
    expect(imeiValid(VALID_IMEI)).toBe(true);
    expect(imeiValid(INVALID_IMEI)).toBe(false);
    expect(imeiValid("12345")).toBe(false); // wrong length
  });
});

describe("Intake — condition grading from test results", () => {
  const photos = ["front", "back", "disc/cart", "any defects"];

  test("all checks pass → like_new, photographed, SKU assigned", async () => {
    const intake = new Intake({ now });
    const r = await intake.receive({
      categorySlug: "games",
      costBasisCents: 3_000n,
      testResults: { disc_reads: true, no_deep_scratches: true, case_and_art: true },
      photos,
    });
    expect(r.conditionVerified).toBe("like_new");
    expect(r.status).toBe("photographed");
    expect(r.riskFlags).toEqual([]);
    expect(r.sku).toBe("FD-2026-00001");
    expect(r.bin).toBe("A-01");
  });

  test("a failed required functional test → parts (DOA)", async () => {
    const intake = new Intake({ now });
    const r = await intake.receive({
      categorySlug: "games",
      costBasisCents: 3_000n,
      testResults: { disc_reads: false, no_deep_scratches: true },
      photos,
    });
    expect(r.conditionVerified).toBe("parts");
    expect(r.blocked).toBe(false);
  });

  test("a cosmetic failure caps it at good", async () => {
    const intake = new Intake({ now });
    const r = await intake.receive({
      categorySlug: "games",
      costBasisCents: 3_000n,
      testResults: { disc_reads: true, no_deep_scratches: false, case_and_art: true },
      photos,
    });
    expect(r.conditionVerified).toBe("good");
  });

  test("missing a required check → untested + status testing", async () => {
    const intake = new Intake({ now });
    const r = await intake.receive({ categorySlug: "games", costBasisCents: 3_000n, testResults: {}, photos });
    expect(r.missingChecks).toContain("disc_reads");
    expect(r.riskFlags).toContain("untested");
    expect(r.status).toBe("testing");
  });

  test("too few photos → status testing with the missing shots listed", async () => {
    const intake = new Intake({ now });
    const r = await intake.receive({
      categorySlug: "games",
      costBasisCents: 3_000n,
      testResults: { disc_reads: true, no_deep_scratches: true, case_and_art: true },
      photos: ["front"],
    });
    expect(r.status).toBe("testing");
    expect(r.missingPhotos.length).toBeGreaterThan(0);
  });
});

describe("Intake — stolen-goods hard-block", () => {
  test("a blacklisted IMEI blocks intake with stolen_risk", async () => {
    const intake = new Intake({ now, blacklist: new FakeBlacklistChecker({ [VALID_IMEI]: "blacklisted" }) });
    const r = await intake.receive({
      categorySlug: "phone",
      costBasisCents: 20_000n,
      testResults: { powers_on: true, imei_clean: true, screen_ok: true },
      serials: { imei: VALID_IMEI },
    });
    expect(r.blocked).toBe(true);
    expect(r.blockReason).toBe("imei_blacklisted");
    expect(r.riskFlags).toContain("stolen_risk");
    expect(r.status).toBe("blocked");
    expect(r.conditionVerified).toBeUndefined();
  });

  test("an invalid IMEI flags stolen_risk but does not hard-block", async () => {
    const intake = new Intake({ now, blacklist: new FakeBlacklistChecker({}) });
    const r = await intake.receive({
      categorySlug: "phone",
      costBasisCents: 20_000n,
      testResults: { powers_on: true, imei_clean: true, screen_ok: true },
      serials: { imei: INVALID_IMEI },
    });
    expect(r.serials.imeiValid).toBe(false);
    expect(r.riskFlags).toContain("stolen_risk");
    expect(r.blocked).toBe(false);
  });

  test("a clean valid IMEI passes", async () => {
    const intake = new Intake({ now, blacklist: new FakeBlacklistChecker({ [VALID_IMEI]: "clean" }) });
    const r = await intake.receive({
      categorySlug: "phone",
      costBasisCents: 20_000n,
      testResults: { powers_on: true, imei_clean: true, screen_ok: true, battery_health: true },
      serials: { imei: VALID_IMEI },
      photos: ["front on", "back", "IMEI screen", "corners", "screen defects"],
    });
    expect(r.blocked).toBe(false);
    expect(r.serials.blacklist).toBe("clean");
    expect(r.riskFlags).not.toContain("stolen_risk");
  });
});
