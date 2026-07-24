import type { Comp, CompProvider, CompQuery } from "@flip-desk/core";

export interface RouteResult {
  readonly comps: Comp[];
  /** Providers that actually contributed comps — recorded on the valuation as provenance (§4.1). */
  readonly providers: string[];
  /** Providers that errored (quarantined for this query, others unaffected — plan §3.3). */
  readonly failed: string[];
}

/**
 * Per-category comp routing (plan §4.1). Fans out to every provider that supports the product's
 * category, tolerates individual provider failures (blast-radius isolation), and reports provenance.
 */
export class CompRouter {
  constructor(private readonly providers: readonly CompProvider[]) {}

  async fetch(query: CompQuery): Promise<RouteResult> {
    const applicable = this.providers.filter((p) => p.supports(query.product.categoryId));
    const settled = await Promise.all(
      applicable.map(async (p) => {
        try {
          return { name: p.name, comps: await p.fetchComps(query), ok: true };
        } catch {
          return { name: p.name, comps: [] as Comp[], ok: false };
        }
      }),
    );
    const comps = settled.flatMap((r) => r.comps);
    const providers = [...new Set(settled.filter((r) => r.ok && r.comps.length > 0).map((r) => r.name))];
    const failed = settled.filter((r) => !r.ok).map((r) => r.name);
    return { comps, providers, failed };
  }
}
