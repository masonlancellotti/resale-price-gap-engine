/**
 * Serial/IMEI verification (plan §3.2, §8 Intake). Stolen-goods screening is a first-class pipeline
 * step: a Luhn-valid IMEI that comes back blacklisted hard-blocks the item; an invalid IMEI is a red
 * flag for manual review. The blacklist check is a seam (CheckMEND / carrier checkers in production).
 */
export function luhnValid(num: string): boolean {
  if (!/^\d+$/.test(num)) return false;
  let sum = 0;
  let alt = false;
  for (let i = num.length - 1; i >= 0; i--) {
    let d = num.charCodeAt(i) - 48;
    if (alt) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    alt = !alt;
  }
  return sum % 10 === 0;
}

/** A 15-digit, Luhn-valid IMEI. */
export function imeiValid(imei: string): boolean {
  return /^\d{15}$/.test(imei) && luhnValid(imei);
}

export type BlacklistStatus = "clean" | "blacklisted" | "unknown";

export interface BlacklistChecker {
  check(imei: string): Promise<BlacklistStatus>;
}

/** Test double: statuses supplied up front. */
export class FakeBlacklistChecker implements BlacklistChecker {
  constructor(private readonly statuses: Readonly<Record<string, BlacklistStatus>> = {}) {}
  async check(imei: string): Promise<BlacklistStatus> {
    return this.statuses[imei] ?? "unknown";
  }
}
