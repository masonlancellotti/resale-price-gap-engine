import type { ConditionBand, Product } from "@flip-desk/core";
import type { CropSpec } from "./photos.js";

/**
 * Per-platform content rules (plan §8.7): eBay wants keyword-stuffed 80-char titles; Mercari/Poshmark
 * want brand-first casual. Every platform is HONEST on condition — returns cost more than clicks, so
 * we never upsell past the verified band. Copy is generated from our structured attributes, so no
 * seller text is ever echoed (no injection surface — plan §12.5).
 */
export type TitleStyle = "keyword" | "brand_first";

export interface PlatformProfile {
  readonly platform: string;
  readonly titleMax: number;
  readonly style: TitleStyle;
  readonly crop: CropSpec;
}

export const PLATFORM_PROFILES: Readonly<Record<string, PlatformProfile>> = {
  ebay: { platform: "ebay", titleMax: 80, style: "keyword", crop: { aspect: "1:1", minEdgePx: 1600 } },
  mercari: { platform: "mercari", titleMax: 80, style: "brand_first", crop: { aspect: "1:1", minEdgePx: 1080 } },
  poshmark: { platform: "poshmark", titleMax: 80, style: "brand_first", crop: { aspect: "1:1", minEdgePx: 1080 } },
};

export function profileFor(platform: string): PlatformProfile {
  return (
    PLATFORM_PROFILES[platform] ?? {
      platform,
      titleMax: 80,
      style: "keyword",
      crop: { aspect: "1:1", minEdgePx: 1080 },
    }
  );
}

const CONDITION_PHRASE: Record<ConditionBand, string> = {
  new: "New (Sealed)",
  like_new: "Like New",
  good: "Good Condition",
  fair: "Fair - Used",
  parts: "For Parts / Not Working",
};

export function conditionPhrase(band: ConditionBand): string {
  return CONDITION_PHRASE[band];
}

function words(...parts: Array<string | undefined>): string[] {
  return parts.flatMap((p) => (p ? p.trim().split(/\s+/) : []));
}

/** De-dupe tokens (case-insensitively) preserving order, then join under a hard char budget. */
function packTitle(tokens: string[], max: number): string {
  const seen = new Set<string>();
  const kept: string[] = [];
  let len = 0;
  for (const tok of tokens) {
    const lc = tok.toLowerCase();
    if (seen.has(lc)) continue;
    const add = (kept.length ? 1 : 0) + tok.length;
    if (len + add > max) break;
    kept.push(tok);
    seen.add(lc);
    len += add;
  }
  return kept.join(" ");
}

export function buildTitle(product: Product, band: ConditionBand, profile: PlatformProfile): string {
  const phrase = conditionPhrase(band);
  const tokens =
    profile.style === "brand_first"
      ? words(product.brand, product.title, product.model, phrase)
      : words(product.brand, product.model, product.title, phrase, "Tested", "Authentic");
  return packTitle(tokens, profile.titleMax);
}

export function buildSpecifics(product: Product, band: ConditionBand): Record<string, unknown> {
  const specifics: Record<string, unknown> = { Condition: conditionPhrase(band) };
  if (product.brand) specifics["Brand"] = product.brand;
  if (product.model) specifics["Model"] = product.model;
  for (const [k, v] of Object.entries(product.variant)) specifics[k] = v;
  const upc = product.identifiers?.["upc"];
  if (typeof upc === "string") specifics["UPC"] = upc;
  return specifics;
}

export function buildDescription(
  product: Product,
  band: ConditionBand,
  opts: { defects?: readonly string[]; handlingDays?: number } = {},
): string {
  const lines = [
    `${[product.brand, product.model, product.title].filter(Boolean).join(" ")}`,
    "",
    `Condition: ${conditionPhrase(band)}.`,
  ];
  if (opts.defects && opts.defects.length > 0) {
    lines.push("Noted flaws (priced accordingly):");
    for (const d of opts.defects) lines.push(`- ${d}`);
  }
  lines.push(
    "",
    "All photos are of the actual item you will receive.",
    `Ships within ${opts.handlingDays ?? 1} business day(s), carefully packed.`,
  );
  return lines.join("\n");
}
