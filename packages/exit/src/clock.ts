/**
 * A clock the saga can wait against. `now()` is virtual milliseconds; `delay(ms)` suspends until the
 * clock advances. The {@link VirtualClock} lets tests prove timing properties (delist p99 < 60s,
 * plan §10.4) deterministically — no real wall-clock, no flakiness.
 */
export interface Clock {
  now(): number;
  delay(ms: number): Promise<void>;
}

/** Production clock — real time. */
export class SystemClock implements Clock {
  now(): number {
    return Date.now();
  }
  delay(ms: number): Promise<void> {
    return new Promise((res) => setTimeout(res, ms));
  }
}

interface Pending {
  at: number;
  resolve: () => void;
}

/**
 * Deterministic virtual clock. Concurrent `delay()` calls sit on one timeline; `drain()` advances to
 * the next due time, releases everything due then, and repeats until the queue empties. `now()` after
 * `drain()` is exactly the critical-path completion time of whatever async work was awaiting it.
 */
export class VirtualClock implements Clock {
  #t = 0;
  #queue: Pending[] = [];

  now(): number {
    return this.#t;
  }

  delay(ms: number): Promise<void> {
    return new Promise<void>((resolve) => {
      this.#queue.push({ at: this.#t + Math.max(0, ms), resolve });
    });
  }

  /** Flush all currently-scheduled microtasks (one macrotask hop drains them). setImmediate isn't
   *  subject to the timer clamping that makes setTimeout(0) ~15ms on Windows. */
  #flush(): Promise<void> {
    return new Promise<void>((res) => {
      if (typeof setImmediate === "function") setImmediate(res);
      else setTimeout(res, 0);
    });
  }

  async drain(): Promise<void> {
    await this.#flush();
    while (this.#queue.length > 0) {
      const nextAt = this.#queue.reduce((m, p) => (p.at < m ? p.at : m), Infinity);
      const due = this.#queue.filter((p) => p.at === nextAt);
      this.#queue = this.#queue.filter((p) => p.at !== nextAt);
      this.#t = Math.max(this.#t, nextAt);
      for (const p of due) p.resolve();
      await this.#flush();
    }
  }
}
