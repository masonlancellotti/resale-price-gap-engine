import { type Cents, formatCents } from "@flip-desk/money";

/**
 * Outsourced-labor handoff (plan §16 Phase 5, §2 the 45-min/flip constraint). Labor caps throughput,
 * so at scale a helper packs and ships. This generates the pick/pack sheet: where the item is, how to
 * pack it, which pre-paid label to slap on, and what NOT to do — with zero access to money or the
 * system (a printable sheet is the whole interface). Keeps the human loop cheap and idiot-proof.
 */
export interface HandoffOrder {
  readonly sku: string;
  readonly title: string;
  readonly bin: string;
  readonly platform: string;
  readonly trackingNumber: string;
  readonly carrier: string;
  readonly labelUrl: string;
  readonly weightOz: number;
  readonly saleGrossCents: Cents;
  readonly packNotes?: readonly string[];
}

export interface PackSlip {
  readonly sku: string;
  readonly lines: readonly string[];
  readonly text: string;
}

export function packSlip(order: HandoffOrder): PackSlip {
  const lines = [
    `PICK  ▸ Bin ${order.bin} — ${order.title}`,
    `SKU   ▸ ${order.sku}`,
    `PACK  ▸ ${order.weightOz} oz. ${(order.packNotes ?? ["Bubble-wrap; snug box; no rattling."]).join(" ")}`,
    `LABEL ▸ ${order.carrier} — print ${order.labelUrl} (tracking ${order.trackingNumber})`,
    `SHIP  ▸ Drop at ${order.carrier}. Photograph the packed box + label before sealing.`,
    `DON'T ▸ Do not open other bins, do not alter the label, do not contact the buyer.`,
  ];
  return { sku: order.sku, lines, text: `PACK SLIP — ${order.platform.toUpperCase()} sale (${formatCents(order.saleGrossCents)})\n` + lines.join("\n") };
}

/** A batch pick route: SKUs ordered by bin so the helper walks the shelves once. */
export function pickRoute(orders: readonly HandoffOrder[]): PackSlip[] {
  return [...orders].sort((a, b) => a.bin.localeCompare(b.bin)).map(packSlip);
}
