/**
 * Deterministic PRNG for the simulation. `mulberry32` is the same tiny generator the demo seeder
 * uses; wrapping it here with the samplers the market model needs keeps every draw reproducible, so
 * a given seed reconstructs an identical run bit-for-bit.
 */
export class Rng {
  #a: number;

  constructor(seed: number) {
    this.#a = seed | 0;
  }

  /** Uniform in [0, 1). */
  next(): number {
    this.#a = (this.#a + 0x6d2b79f5) | 0;
    let t = Math.imul(this.#a ^ (this.#a >>> 15), 1 | this.#a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Uniform in [lo, hi). */
  uniform(lo: number, hi: number): number {
    return lo + (hi - lo) * this.next();
  }

  /** Integer in [lo, hi] inclusive. */
  int(lo: number, hi: number): number {
    return lo + Math.floor(this.next() * (hi - lo + 1));
  }

  /** Standard normal via Box–Muller (uses two uniforms; returns one variate). */
  normal(): number {
    const u1 = Math.max(1e-12, this.next());
    const u2 = this.next();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  }

  /** Lognormal with the given median and shape σ: median · exp(σ·Z). */
  lognormal(median: number, sigma: number): number {
    return median * Math.exp(sigma * this.normal());
  }

  /** true with probability p. */
  chance(p: number): boolean {
    return this.next() < p;
  }

  /** Geometric time-to-event with per-trial hazard h (≥ 1), capped. */
  geometric(hazard: number, cap: number): number {
    const u = Math.max(1e-12, this.next());
    const n = Math.ceil(Math.log(u) / Math.log(1 - hazard));
    return Math.min(cap, Math.max(1, n));
  }

  /** Pick an index by weight (weights need not be normalized). */
  weightedIndex(weights: readonly number[]): number {
    const total = weights.reduce((s, w) => s + w, 0);
    let target = this.next() * total;
    for (let i = 0; i < weights.length; i++) {
      target -= weights[i]!;
      if (target < 0) return i;
    }
    return weights.length - 1;
  }
}
