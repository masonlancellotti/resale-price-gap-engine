import type { AdapterContext, NormalizedListing, RawListing, SourceAdapter } from "@flip-desk/core";
import { ListingStore, type UpsertResult } from "./store.js";

/** Source-specific canonicalization. Each adapter ships one (plan §5.3 #2, the normalizer). */
export interface Normalizer {
  readonly sourceCode: string;
  normalize(raw: RawListing): NormalizedListing;
}

export interface IngestStats {
  seen: number;
  created: number;
  deduped: number;
  updated: number;
  failed: number;
}

export class NoNormalizerError extends Error {
  constructor(sourceCode: string) {
    super(`no normalizer registered for source '${sourceCode}'`);
    this.name = "NoNormalizerError";
  }
}

/**
 * The ingest path: adapter → normalize → dedupe → store (plan §5.2). Idempotent by content hash; an
 * untrusted payload that fails its schema is *quarantined* (counted as failed, logged) rather than
 * crashing the run — one poisoned listing never stalls the pipeline (plan §10.1).
 */
export class IngestPipeline {
  #normalizers = new Map<string, Normalizer>();

  constructor(private readonly store: ListingStore) {}

  register(normalizer: Normalizer): this {
    this.#normalizers.set(normalizer.sourceCode, normalizer);
    return this;
  }

  ingest(raw: RawListing): UpsertResult {
    const normalizer = this.#normalizers.get(raw.sourceCode);
    if (!normalizer) throw new NoNormalizerError(raw.sourceCode);
    return this.store.upsert(normalizer.normalize(raw));
  }

  async runAdapter(adapter: SourceAdapter, ctx: AdapterContext): Promise<IngestStats> {
    const stats: IngestStats = { seen: 0, created: 0, deduped: 0, updated: 0, failed: 0 };
    for await (const raw of adapter.poll(ctx)) {
      if (ctx.signal?.aborted) break; // P7: cooperative stop when the kill switch aborts us
      stats.seen++;
      try {
        const result = this.ingest(raw);
        if (result.created) stats.created++;
        else if (result.updated) stats.updated++;
        else stats.deduped++;
      } catch (err) {
        stats.failed++;
        ctx.log(`ingest quarantined ${raw.externalId}: ${(err as Error).message}`);
      }
    }
    return stats;
  }
}
