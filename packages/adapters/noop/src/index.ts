import {
  type AdapterContext,
  contentHash,
  type NormalizedListing,
  parseUntrusted,
  type RawListing,
  type SourceAdapter,
  z,
} from "@flip-desk/core";
import { dollarsToCents } from "@flip-desk/money";

/**
 * A no-op source adapter (plan §16 Phase 0 gate: "one no-op adapter flows raw→listing"). It emits a
 * fixed set of fixtures instead of touching any real platform, so the whole ingest path — poll →
 * normalize → dedupe → store — can be exercised end-to-end with zero external dependencies and zero
 * compliance surface. Real adapters (eBay Browse, Gmail alert-parser, …) implement the same
 * {@link SourceAdapter} contract.
 */

const SOURCE_CODE = "noop";

/** The adapter-specific payload shape. It is untrusted (plan §12.5) and only enters via this schema. */
const NoopPayload = z.object({
  title: z.string().min(1),
  priceUsd: z.string(),
  url: z.string().url().optional(),
  description: z.string().optional(),
  conditionClaimed: z.string().optional(),
  postedAt: z.string().optional(),
  attrs: z.record(z.unknown()).optional(),
});
export type NoopPayload = z.infer<typeof NoopPayload>;

export const NOOP_FIXTURES: readonly RawListing[] = [
  {
    sourceCode: SOURCE_CODE,
    externalId: "noop-1",
    channel: "api",
    url: "https://example.test/listing/noop-1",
    fetchedAt: "2026-07-04T12:00:00.000Z",
    payload: {
      title: "DeWalt DCD996 20V Hammer Drill Kit",
      priceUsd: "60.00",
      conditionClaimed: "used - good",
      description: "moving, must go",
      postedAt: "2026-07-04T09:30:00.000Z",
      attrs: { brand: "DeWalt", model: "DCD996" },
    } satisfies NoopPayload,
  },
  {
    sourceCode: SOURCE_CODE,
    externalId: "noop-2",
    channel: "api",
    url: "https://example.test/listing/noop-2",
    fetchedAt: "2026-07-04T12:00:00.000Z",
    payload: {
      title: "Sony WH-1000XM4 Headphones",
      priceUsd: "120.00",
      conditionClaimed: "like new",
      attrs: { brand: "Sony", model: "WH-1000XM4" },
    } satisfies NoopPayload,
  },
  {
    sourceCode: SOURCE_CODE,
    externalId: "noop-3",
    channel: "api",
    fetchedAt: "2026-07-04T12:00:00.000Z",
    payload: {
      title: "PlayStation 5 Slim Disc CFI-2000",
      priceUsd: "300.00",
      attrs: { brand: "Sony", model: "PS5 Slim", variant: { model_no: "CFI-2000" } },
    } satisfies NoopPayload,
  },
];

export class NoopAdapter implements SourceAdapter {
  readonly code = SOURCE_CODE;
  readonly tier = "T0" as const;
  readonly channel = "api" as const;

  constructor(private readonly fixtures: readonly RawListing[] = NOOP_FIXTURES) {}

  async *poll(ctx: AdapterContext): AsyncIterable<RawListing> {
    for (const fixture of this.fixtures) {
      if (ctx.signal?.aborted) return; // cooperative stop — the kill switch aborts this signal (P7)
      ctx.log(`noop yield ${fixture.externalId}`);
      yield fixture;
    }
  }

  async selfTest(): Promise<boolean> {
    const first = this.fixtures[0];
    if (!first) return false;
    normalizeNoop(first);
    return true;
  }
}

/** Turn a noop {@link RawListing} into a canonical {@link NormalizedListing}. */
export function normalizeNoop(raw: RawListing): NormalizedListing {
  const p = parseUntrusted(NoopPayload, raw.payload, `noop:${raw.externalId}`);
  const url = raw.url ?? p.url;
  return {
    sourceCode: raw.sourceCode,
    externalId: raw.externalId,
    title: p.title,
    priceCents: dollarsToCents(p.priceUsd),
    attrs: p.attrs ?? {},
    contentHash: contentHash(raw.payload),
    ...(url !== undefined ? { url } : {}),
    ...(p.description !== undefined ? { description: p.description } : {}),
    ...(p.conditionClaimed !== undefined ? { conditionClaimed: p.conditionClaimed } : {}),
    ...(p.postedAt !== undefined ? { postedAt: p.postedAt } : {}),
  };
}

/** Convenience: a {@link Normalizer}-shaped object for registration in the pipeline. */
export const noopNormalizer = {
  sourceCode: SOURCE_CODE,
  normalize: normalizeNoop,
};
