import type { Product } from "@flip-desk/core";

/**
 * Local text embeddings (plan §7.2 F1). Production uses SigLIP/bge in the Python sidecar; this
 * deterministic hashing embedder is a stand-in with the same interface — same-meaning text lands
 * near same-meaning text — so the funnel's cheap-match stage is testable with zero model deps.
 */
export interface Embedder {
  readonly dim: number;
  embed(text: string): number[];
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Hashed bag-of-words → L2-normalized vector. Cosine similarity tracks token overlap. */
export class HashingEmbedder implements Embedder {
  constructor(readonly dim = 64) {}

  embed(text: string): number[] {
    const v = new Array<number>(this.dim).fill(0);
    for (const tok of tokenize(text)) {
      const idx = fnv1a(tok) % this.dim;
      v[idx] = (v[idx] ?? 0) + 1;
    }
    const norm = Math.hypot(...v) || 1;
    return v.map((x) => x / norm);
  }
}

export function cosine(a: readonly number[], b: readonly number[]): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i]! * b[i]!;
  return dot; // inputs are unit vectors
}

export interface IndexHit {
  readonly product: Product;
  readonly score: number;
}

/** In-memory nearest-neighbour product index (plan §7.2 F1; production: pgvector HNSW). */
export class ProductIndex {
  #entries: Array<{ product: Product; vec: number[] }> = [];

  constructor(
    private readonly embedder: Embedder,
    products: ReadonlyArray<{ product: Product; text: string }> = [],
  ) {
    for (const p of products) this.add(p.product, p.text);
  }

  add(product: Product, text: string): void {
    this.#entries.push({ product, vec: this.embedder.embed(text) });
  }

  topK(vec: readonly number[], k = 2): IndexHit[] {
    return this.#entries
      .map((e) => ({ product: e.product, score: cosine(vec, e.vec) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, k);
  }

  get size(): number {
    return this.#entries.length;
  }
}
