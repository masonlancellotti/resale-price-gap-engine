/** Per-category test checklists and photo shot-lists (plan §7-intake, §8). */
export type CheckSeverity = "functional" | "cosmetic";

export interface ChecklistItem {
  readonly key: string;
  readonly label: string;
  readonly required: boolean;
  readonly severity: CheckSeverity;
}

/** Category slug → test checklist. Games/consoles is Phase 1's vertical; others seed later verticals. */
export const CATEGORY_CHECKLISTS: Readonly<Record<string, readonly ChecklistItem[]>> = {
  games: [
    { key: "disc_reads", label: "Disc/cart loads and runs", required: true, severity: "functional" },
    { key: "no_deep_scratches", label: "No disc-killing scratches", required: false, severity: "cosmetic" },
    { key: "case_and_art", label: "Case + art present", required: false, severity: "cosmetic" },
  ],
  console: [
    { key: "powers_on", label: "Powers on", required: true, severity: "functional" },
    { key: "hdmi_output", label: "Video output works", required: true, severity: "functional" },
    { key: "ports_and_reader", label: "Ports + disc reader work", required: false, severity: "functional" },
    { key: "no_cracks", label: "No cracks/heavy wear", required: false, severity: "cosmetic" },
  ],
  phone: [
    { key: "powers_on", label: "Powers on", required: true, severity: "functional" },
    { key: "imei_clean", label: "IMEI clean (not blacklisted)", required: true, severity: "functional" },
    { key: "screen_ok", label: "Screen has no cracks/burn-in", required: true, severity: "cosmetic" },
    { key: "battery_health", label: "Battery health acceptable", required: false, severity: "functional" },
  ],
};

export const DEFAULT_CHECKLIST: readonly ChecklistItem[] = [
  { key: "powers_on_or_functions", label: "Functions as described", required: true, severity: "functional" },
  { key: "cosmetics_ok", label: "Cosmetics match grade", required: false, severity: "cosmetic" },
];

export const CATEGORY_SHOTLISTS: Readonly<Record<string, readonly string[]>> = {
  games: ["front", "back", "disc/cart", "any defects"],
  console: ["front", "back", "ports", "serial plate", "powered-on screen", "any defects"],
  phone: ["front on", "back", "IMEI screen", "corners", "screen defects"],
};

export const DEFAULT_SHOTLIST: readonly string[] = ["front", "back", "label/serial", "defects"];

export function checklistFor(categorySlug: string): readonly ChecklistItem[] {
  return CATEGORY_CHECKLISTS[categorySlug] ?? DEFAULT_CHECKLIST;
}

export function shotListFor(categorySlug: string): readonly string[] {
  return CATEGORY_SHOTLISTS[categorySlug] ?? DEFAULT_SHOTLIST;
}
