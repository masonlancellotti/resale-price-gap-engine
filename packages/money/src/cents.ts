/**
 * Money is integer cents, always, as `bigint`. Floats never touch currency (plan §2.3 P4).
 *
 * `Cents` is a plain `bigint` alias rather than a branded type on purpose: bigint arithmetic
 * (`+ - *`) stays ergonomic, and the type system already prevents the one mistake that matters —
 * a `number` (which could be fractional) can never be assigned to a `bigint`. Construct cents only
 * through the helpers here; never `Number(...)` your way into currency.
 */
export type Cents = bigint;

export const ZERO_CENTS: Cents = 0n;

/** A whole number of cents (e.g. `centsFromInt(14200)` === $142.00). Rejects non-integers. */
export function centsFromInt(n: number): Cents {
  if (!Number.isInteger(n)) {
    throw new RangeError(`centsFromInt expects an integer count of cents, got ${n}`);
  }
  return BigInt(n);
}

/**
 * Parse a human dollar string to exact cents with NO floating point. Accepts an optional leading
 * `$`, an optional sign, at most two fractional digits, and thousands separators **only when they
 * are correctly placed** (every group after the first is exactly three digits). More than two
 * decimals, or a stray/misplaced comma, is an error — never a silent round or a stripped digit.
 * (`"12,34"` is rejected, not read as `$1,234`.)
 *
 *   dollarsToCents("142")       -> 14200n
 *   dollarsToCents("$1,234.5")  -> 123450n
 *   dollarsToCents("-0.09")     -> -9n
 */
export function dollarsToCents(input: string): Cents {
  const stripped = input.trim().replace(/[$\s]/g, "");
  const sign = stripped.startsWith("-") ? -1n : 1n;
  const body = stripped.startsWith("-") ? stripped.slice(1) : stripped;
  // whole part is either grouped (1,234,567) or ungrouped (1234567); optional ≤2-digit fraction.
  if (!/^(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?$/.test(body)) {
    throw new RangeError(`dollarsToCents: not an exact money string: ${JSON.stringify(input)}`);
  }
  const dot = body.indexOf(".");
  const wholePart = dot === -1 ? body : body.slice(0, dot);
  const fracPart = dot === -1 ? "" : body.slice(dot + 1);
  const whole = BigInt(wholePart.replace(/,/g, ""));
  const frac = fracPart.padEnd(2, "0"); // "" -> "00", "5" -> "50"
  return sign * (whole * 100n + BigInt(frac));
}

/** Format cents as a signed dollar string, e.g. `formatCents(-1961n)` -> "-$19.61". */
export function formatCents(c: Cents): string {
  const neg = c < 0n;
  const abs = neg ? -c : c;
  const dollars = abs / 100n;
  const rem = abs % 100n;
  return `${neg ? "-" : ""}$${dollars.toString()}.${rem.toString().padStart(2, "0")}`;
}

export function absCents(c: Cents): Cents {
  return c < 0n ? -c : c;
}

/** Sum with an explicit accumulator so an empty list is `0n`, not `undefined`. */
export function sumCents(values: readonly Cents[]): Cents {
  let acc = 0n;
  for (const v of values) acc += v;
  return acc;
}
