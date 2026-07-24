/**
 * Rate limiting, retry taxonomy, and circuit breaking (plan §10.1). All time is injectable so the
 * whole thing is deterministic under test — no real sleeping, no wall clock.
 */

export type Clock = () => number;
const realClock: Clock = () => Date.now();

/** Token-bucket rate limiter — one per source, sized to that source's rate budget (plan §5.3). */
export class TokenBucket {
  #tokens: number;
  #last: number;

  constructor(
    readonly capacity: number,
    readonly refillPerSec: number,
    private readonly now: Clock = realClock,
  ) {
    this.#tokens = capacity;
    this.#last = now();
  }

  #refill(): void {
    const t = this.now();
    const elapsedSec = (t - this.#last) / 1000;
    if (elapsedSec > 0) {
      this.#tokens = Math.min(this.capacity, this.#tokens + elapsedSec * this.refillPerSec);
      this.#last = t;
    }
  }

  /** Consume `n` tokens if available; returns false without consuming if not. */
  take(n = 1): boolean {
    this.#refill();
    if (this.#tokens >= n) {
      this.#tokens -= n;
      return true;
    }
    return false;
  }

  /** Shrink capacity (429 response → self-throttle 50% for a while, plan §10.1). */
  throttle(factor: number): TokenBucket {
    return new TokenBucket(Math.max(1, Math.floor(this.capacity * factor)), this.refillPerSec * factor, this.now);
  }

  get available(): number {
    this.#refill();
    return this.#tokens;
  }
}

// ---- retry taxonomy (plan §10.1) ---------------------------------------------------------------

export type RetryClass = "transient" | "rate_limit" | "fatal";
export type Sleep = (ms: number) => Promise<void>;
const realSleep: Sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export interface RetryOptions {
  readonly maxAttempts?: number;
  readonly classify: (err: unknown) => RetryClass;
  readonly baseDelayMs?: number;
  readonly maxDelayMs?: number;
  readonly sleep?: Sleep;
  readonly rand?: () => number;
  readonly onRetry?: (attempt: number, delayMs: number, err: unknown) => void;
}

/** Exponential backoff + jitter; `fatal` (or exhausting attempts) rethrows. Never evades (P7). */
export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions): Promise<T> {
  const max = opts.maxAttempts ?? 5;
  const base = opts.baseDelayMs ?? 200;
  const maxDelay = opts.maxDelayMs ?? 30_000;
  const sleep = opts.sleep ?? realSleep;
  const rand = opts.rand ?? Math.random;

  let attempt = 0;
  for (;;) {
    attempt++;
    try {
      return await fn();
    } catch (err) {
      const cls = opts.classify(err);
      if (cls === "fatal" || attempt >= max) throw err;
      const backoff = Math.min(maxDelay, base * 2 ** (attempt - 1));
      const delay = Math.round(backoff * (0.5 + rand() * 0.5)); // full-ish jitter
      opts.onRetry?.(attempt, delay, err);
      await sleep(delay);
    }
  }
}

// ---- circuit breaker (plan §10.1) --------------------------------------------------------------

export type BreakerState = "closed" | "open" | "half_open";

export interface BreakerOptions {
  readonly windowSize?: number; // rolling number of calls to consider
  readonly errorThreshold?: number; // open when error rate exceeds this (0..1)
  readonly minCalls?: number; // don't trip until we've seen this many
  readonly cooldownMs?: number; // stay open this long before probing
  readonly now?: Clock;
}

export class CircuitOpenError extends Error {
  constructor() {
    super("circuit breaker is open");
    this.name = "CircuitOpenError";
  }
}

/**
 * Per-adapter breaker: >errorThreshold failures over the recent window → open for cooldown → a
 * single half-open probe → close on success, reopen on failure.
 */
export class CircuitBreaker {
  #state: BreakerState = "closed";
  #results: boolean[] = [];
  #openedAt = 0;
  #probing = false;
  private readonly windowSize: number;
  private readonly errorThreshold: number;
  private readonly minCalls: number;
  private readonly cooldownMs: number;
  private readonly now: Clock;

  constructor(opts: BreakerOptions = {}) {
    this.windowSize = opts.windowSize ?? 20;
    this.errorThreshold = opts.errorThreshold ?? 0.3;
    this.minCalls = opts.minCalls ?? 5;
    this.cooldownMs = opts.cooldownMs ?? 15 * 60_000;
    this.now = opts.now ?? realClock;
  }

  get state(): BreakerState {
    if (this.#state === "open" && this.now() - this.#openedAt >= this.cooldownMs) return "half_open";
    return this.#state;
  }

  async exec<T>(fn: () => Promise<T>): Promise<T> {
    const state = this.state;
    if (state === "open") throw new CircuitOpenError();
    if (state === "half_open") {
      if (this.#probing) throw new CircuitOpenError(); // only one probe at a time
      this.#probing = true;
      try {
        const out = await fn();
        this.#close();
        return out;
      } catch (err) {
        this.#trip();
        throw err;
      } finally {
        this.#probing = false;
      }
    }
    // closed
    try {
      const out = await fn();
      this.#record(true);
      return out;
    } catch (err) {
      this.#record(false);
      throw err;
    }
  }

  #record(ok: boolean): void {
    this.#results.push(ok);
    if (this.#results.length > this.windowSize) this.#results.shift();
    if (this.#results.length >= this.minCalls) {
      const errors = this.#results.filter((r) => !r).length;
      if (errors / this.#results.length > this.errorThreshold) this.#trip();
    }
  }

  #trip(): void {
    this.#state = "open";
    this.#openedAt = this.now();
  }

  #close(): void {
    this.#state = "closed";
    this.#results = [];
  }
}
