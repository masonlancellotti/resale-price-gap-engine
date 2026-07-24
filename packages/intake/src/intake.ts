import type { ConditionBand, RiskFlag } from "@flip-desk/core";
import type { Cents } from "@flip-desk/money";
import { checklistFor, shotListFor } from "./checklists.js";
import { type BlacklistChecker, type BlacklistStatus, imeiValid } from "./serials.js";

export interface IntakeInput {
  readonly purchaseId?: number;
  readonly productId?: number;
  readonly categorySlug: string;
  readonly costBasisCents: Cents;
  readonly testResults?: Readonly<Record<string, boolean>>;
  readonly serials?: { readonly imei?: string; readonly serial?: string };
  readonly photos?: readonly string[];
  readonly binHint?: string;
}

export interface IntakeResult {
  readonly sku: string;
  readonly status: "testing" | "photographed" | "blocked";
  readonly conditionVerified?: ConditionBand;
  readonly testResults: Readonly<Record<string, boolean>>;
  readonly serials: { imei?: string; serial?: string; imeiValid?: boolean; blacklist?: BlacklistStatus };
  readonly bin: string;
  readonly photoKeys: readonly string[];
  readonly costBasisCents: Cents;
  readonly riskFlags: readonly RiskFlag[];
  readonly blocked: boolean;
  readonly blockReason?: string;
  readonly missingChecks: readonly string[];
  readonly missingPhotos: readonly string[];
}

export interface IntakeOptions {
  readonly blacklist?: BlacklistChecker;
  readonly skuPrefix?: string;
  readonly now?: () => Date;
}

/**
 * Guided receiving (plan §8 Intake). Runs the category test checklist, verifies serials/IMEI
 * (stolen-goods hard-block on a blacklist hit), enforces the photo shot-list, assigns a bin/SKU, and
 * emits the inventory record with a verified condition band + risk flags. The human does the hands;
 * this does the bookkeeping and the safety gates.
 */
export class Intake {
  #seq = 0;
  #binSeq = 0;

  constructor(private readonly opts: IntakeOptions = {}) {}

  async receive(input: IntakeInput): Promise<IntakeResult> {
    const checklist = checklistFor(input.categorySlug);
    const shots = shotListFor(input.categorySlug);
    const results = input.testResults ?? {};
    const riskFlags = new Set<RiskFlag>();

    const missingChecks = checklist.filter((i) => i.required && results[i.key] === undefined).map((i) => i.key);
    if (missingChecks.length > 0) riskFlags.add("untested");

    // Verified condition from test outcomes.
    const reqFuncFail = checklist.some((i) => i.required && i.severity === "functional" && results[i.key] === false);
    const otherFuncFail = checklist.some((i) => !i.required && i.severity === "functional" && results[i.key] === false);
    const cosmeticFail = checklist.some((i) => i.severity === "cosmetic" && results[i.key] === false);
    const allTrue = missingChecks.length === 0 && checklist.every((i) => results[i.key] === true);

    let condition: ConditionBand;
    if (reqFuncFail) condition = "parts";
    else if (otherFuncFail) condition = "fair";
    else if (cosmeticFail) condition = "good";
    else if (allTrue) condition = "like_new";
    else condition = "good";

    // Serial / IMEI verification.
    const serials: IntakeResult["serials"] = {};
    let blocked = false;
    let blockReason: string | undefined;
    if (input.serials?.serial) serials.serial = input.serials.serial;
    if (input.serials?.imei) {
      const imei = input.serials.imei;
      serials.imei = imei;
      const valid = imeiValid(imei);
      serials.imeiValid = valid;
      if (!valid) riskFlags.add("stolen_risk"); // filed/fake IMEI — route to manual
      if (this.opts.blacklist) {
        const status = await this.opts.blacklist.check(imei);
        serials.blacklist = status;
        if (status === "blacklisted") {
          riskFlags.add("stolen_risk");
          blocked = true;
          blockReason = "imei_blacklisted";
        }
      }
    }

    const photoKeys = input.photos ?? [];
    const missingPhotos = photoKeys.length >= shots.length ? [] : shots.slice(photoKeys.length);

    const bin = input.binHint ?? this.#nextBin();
    const sku = this.#nextSku();

    const status: IntakeResult["status"] = blocked
      ? "blocked"
      : missingChecks.length > 0 || missingPhotos.length > 0
        ? "testing"
        : "photographed";

    return {
      sku,
      status,
      ...(blocked ? {} : { conditionVerified: condition }),
      testResults: { ...results },
      serials,
      bin,
      photoKeys,
      costBasisCents: input.costBasisCents,
      riskFlags: [...riskFlags],
      blocked,
      ...(blockReason ? { blockReason } : {}),
      missingChecks,
      missingPhotos,
    };
  }

  #nextSku(): string {
    const prefix = this.opts.skuPrefix ?? "FD";
    const year = (this.opts.now ? this.opts.now() : new Date()).getFullYear();
    this.#seq += 1;
    return `${prefix}-${year}-${String(this.#seq).padStart(5, "0")}`;
  }

  #nextBin(): string {
    this.#binSeq += 1;
    return `A-${String(this.#binSeq).padStart(2, "0")}`;
  }
}
