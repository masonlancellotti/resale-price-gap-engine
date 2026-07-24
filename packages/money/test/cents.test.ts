import { describe, expect, test } from "vitest";
import * as fc from "fast-check";
import { centsFromInt, dollarsToCents, formatCents, sumCents } from "../src/index.js";

describe("dollarsToCents — exact, no floating point", () => {
  test.each([
    ["142", 14200n],
    ["142.00", 14200n],
    ["$1,234.5", 123450n],
    ["-0.09", -9n],
    ["0", 0n],
    ["  $19.61 ", 1961n],
  ])("%s -> %s", (input, expected) => {
    expect(dollarsToCents(input)).toBe(expected);
  });

  test.each(["1.234", "1.2.3", "abc", "", "$", "1e3", "0x10", "12,34"])(
    "rejects %s",
    (bad) => {
      expect(() => dollarsToCents(bad)).toThrow(RangeError);
    },
  );
});

describe("formatCents", () => {
  test.each([
    [14200n, "$142.00"],
    [-1961n, "-$19.61"],
    [0n, "$0.00"],
    [5n, "$0.05"],
    [100n, "$1.00"],
  ])("%s -> %s", (input, expected) => {
    expect(formatCents(input)).toBe(expected);
  });
});

describe("centsFromInt", () => {
  test("accepts integers", () => {
    expect(centsFromInt(14200)).toBe(14200n);
  });
  test("rejects non-integers (floats never touch currency)", () => {
    expect(() => centsFromInt(1.5)).toThrow(RangeError);
    expect(() => centsFromInt(0.1 + 0.2)).toThrow(RangeError);
  });
});

describe("round-trip property", () => {
  test("dollarsToCents ∘ formatCents === identity for any integer cents", () => {
    fc.assert(
      fc.property(fc.bigInt({ min: -1_000_000_000_00n, max: 1_000_000_000_00n }), (c) => {
        expect(dollarsToCents(formatCents(c))).toBe(c);
      }),
    );
  });

  test("sumCents([]) is 0n and is associative over concatenation", () => {
    expect(sumCents([])).toBe(0n);
    fc.assert(
      fc.property(
        fc.array(fc.bigInt({ min: -1_000_00n, max: 1_000_00n })),
        fc.array(fc.bigInt({ min: -1_000_00n, max: 1_000_00n })),
        (a, b) => {
          expect(sumCents([...a, ...b])).toBe(sumCents(a) + sumCents(b));
        },
      ),
    );
  });
});
