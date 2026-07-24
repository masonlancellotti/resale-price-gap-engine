import { describe, expect, test, vi } from "vitest";
import {
  CircuitBreaker,
  CircuitOpenError,
  FakeTransport,
  HttpError,
  jsonResponse,
  parseJson,
  TokenBucket,
  withRetry,
} from "../src/index.js";

describe("FakeTransport", () => {
  test("routes by substring and records calls", async () => {
    const t = new FakeTransport().on("/comps", jsonResponse(200, { ok: true }));
    const res = await t.request({ method: "GET", url: "https://api.test/comps?q=ps5" });
    expect(res.status).toBe(200);
    expect(parseJson<{ ok: boolean }>(res, "x").ok).toBe(true);
    expect(t.calls).toHaveLength(1);
  });

  test("throws on unmatched route", async () => {
    const t = new FakeTransport();
    await expect(t.request({ method: "GET", url: "https://api.test/none" })).rejects.toThrow(/no route/);
  });

  test("parseJson throws HttpError on non-JSON", () => {
    expect(() => parseJson({ status: 500, headers: {}, body: "<html>oops" }, "u")).toThrow(HttpError);
  });
});

describe("TokenBucket", () => {
  test("consumes and refills against an injected clock", () => {
    let t = 0;
    const bucket = new TokenBucket(3, 1, () => t); // 3 cap, 1/sec
    expect(bucket.take()).toBe(true);
    expect(bucket.take()).toBe(true);
    expect(bucket.take()).toBe(true);
    expect(bucket.take()).toBe(false); // empty
    t += 2000; // 2 seconds → +2 tokens
    expect(bucket.take()).toBe(true);
    expect(bucket.take()).toBe(true);
    expect(bucket.take()).toBe(false);
  });

  test("throttle shrinks capacity (429 self-throttle)", () => {
    const bucket = new TokenBucket(10, 5).throttle(0.5);
    expect(bucket.capacity).toBe(5);
    expect(bucket.refillPerSec).toBe(2.5);
  });
});

describe("withRetry", () => {
  test("retries transient failures then succeeds; no real sleeping", async () => {
    let n = 0;
    const sleep = vi.fn(async () => {});
    const out = await withRetry(
      async () => {
        n++;
        if (n < 3) throw new Error("ETIMEDOUT");
        return "ok";
      },
      { classify: () => "transient", sleep, rand: () => 0.5, baseDelayMs: 100 },
    );
    expect(out).toBe("ok");
    expect(n).toBe(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  test("fatal errors are not retried (P7: stop, don't sneak)", async () => {
    let n = 0;
    await expect(
      withRetry(
        async () => {
          n++;
          throw new Error("403 banned");
        },
        { classify: () => "fatal", sleep: async () => {} },
      ),
    ).rejects.toThrow("banned");
    expect(n).toBe(1);
  });

  test("gives up after maxAttempts", async () => {
    let n = 0;
    await expect(
      withRetry(
        async () => {
          n++;
          throw new Error("flaky");
        },
        { classify: () => "transient", sleep: async () => {}, maxAttempts: 4 },
      ),
    ).rejects.toThrow("flaky");
    expect(n).toBe(4);
  });
});

describe("CircuitBreaker", () => {
  test("opens after the error rate exceeds threshold, then half-opens after cooldown", async () => {
    let now = 0;
    const cb = new CircuitBreaker({ minCalls: 4, errorThreshold: 0.3, cooldownMs: 1000, now: () => now });
    const fail = () => cb.exec(async () => Promise.reject(new Error("boom")));

    for (let i = 0; i < 4; i++) await fail().catch(() => {});
    // 4/4 errors > 30% → open
    await expect(cb.exec(async () => "x")).rejects.toThrow(CircuitOpenError);

    now += 1000; // cooldown elapsed → half-open probe allowed
    const probe = await cb.exec(async () => "recovered");
    expect(probe).toBe("recovered");
    expect(cb.state).toBe("closed"); // probe succeeded → closed
  });

  test("a failed probe reopens the breaker", async () => {
    let now = 0;
    const cb = new CircuitBreaker({ minCalls: 2, errorThreshold: 0.3, cooldownMs: 500, now: () => now });
    await cb.exec(async () => Promise.reject(new Error("x"))).catch(() => {});
    await cb.exec(async () => Promise.reject(new Error("x"))).catch(() => {});
    expect(cb.state).toBe("open");
    now += 500;
    await cb.exec(async () => Promise.reject(new Error("still down"))).catch(() => {});
    now += 1; // still within next cooldown window
    expect(cb.state).toBe("open");
  });
});
