/**
 * Outbox / idempotency store (plan §5.4): every external mutation carries a natural key; running it
 * through `once(key, fn)` guarantees exactly-once-effective execution — a retry or a duplicate event
 * replays the cached result instead of re-ending a listing or re-buying a label. In-flight calls with
 * the same key share the same promise so concurrent duplicates collapse to one side effect.
 */
export class Outbox {
  readonly #done = new Map<string, unknown>();
  readonly #inflight = new Map<string, Promise<unknown>>();

  has(key: string): boolean {
    return this.#done.has(key);
  }

  async once<T>(key: string, fn: () => Promise<T>): Promise<T> {
    if (this.#done.has(key)) return this.#done.get(key) as T;
    const existing = this.#inflight.get(key);
    if (existing) return existing as Promise<T>;

    const p = (async () => {
      const result = await fn();
      this.#done.set(key, result);
      this.#inflight.delete(key);
      return result;
    })();
    this.#inflight.set(key, p);
    return p;
  }
}
