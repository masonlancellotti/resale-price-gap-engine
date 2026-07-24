import { describe, expect, test } from "vitest";
import { KillSwitch, type Policy, RISK_TEXT, Sentinel, type SignedRiskAcceptance, signedTiers } from "@flip-desk/policy";
import { withRetry } from "@flip-desk/net";

/**
 * P7 — "stop, don't sneak" (COMPLIANCE.md, plan §3.4). Even a fully-enabled, signed T4 module, when a
 * platform blocks it, must HALT and alert — never rotate identities, never retry to look human, never
 * evade. This chaos test proves the invariant end to end: a block trips the kill switch, the module
 * stops on the first block (no evasive retry), and every subsequent action for that scope is denied.
 */
class BlockedError extends Error {
  readonly retryable = false; // a block is FATAL — never retried (plan §10.2)
  constructor(readonly source: string) {
    super(`blocked by ${source}`);
  }
}

/** A T4 poller that gets blocked partway through — the scenario we design AGAINST, not for. */
class BlockedT4Source {
  polls = 0;
  async *poll(): AsyncGenerator<string> {
    this.polls++;
    yield "listing-1";
    yield "listing-2";
    throw new BlockedError("fb_mkt");
  }
}

const T4_POLICY: Policy = {
  purchaseDayCapCents: 20_000n,
  autonomy: { poll: "L4" },
  tiersEnabled: ["T0", "T2", "T4"],
  signedOptIns: signedTiers([
    { tier: "T4", operator: "mason", acceptedAt: "2026-08-01T00:00:00Z", riskAcknowledged: RISK_TEXT["T4"]! },
  ] satisfies SignedRiskAcceptance[]),
};

describe("P7 halt-don't-sneak chaos test (T4)", () => {
  test("a block halts the module, trips the kill switch, and denies everything after — no evasion", async () => {
    const ks = new KillSwitch();
    const source = new BlockedT4Source();
    const seen: string[] = [];
    let halted = false;
    let haltedSource = "";

    // The P7 supervisor: consume until a block, then STOP and trip the switch. No retry, no rotation.
    try {
      for await (const item of source.poll()) seen.push(item);
    } catch (err) {
      if (err instanceof BlockedError) {
        ks.trip({ kind: "source", code: err.source });
        halted = true;
        haltedSource = err.source;
      } else throw err;
    }

    expect(seen).toEqual(["listing-1", "listing-2"]); // got what we got before the block
    expect(halted).toBe(true);
    expect(haltedSource).toBe("fb_mkt");
    expect(source.polls).toBe(1); // exactly one pass — the module did NOT re-poll to evade

    // Even though T4 is enabled AND the ceremony is signed, the kill switch beats everything.
    const sentinel = new Sentinel({ killSwitch: ks, policy: T4_POLICY });
    expect(sentinel.check({ gate: "poll", tier: "T4", scope: { source: "fb_mkt" } })).toEqual({
      type: "deny",
      reason: "kill_switch",
    });
    // Unrelated sources are unaffected (blast-radius contained to the blocked source).
    expect(sentinel.check({ gate: "poll", tier: "T4", scope: { source: "offerup" } }).type).not.toBe("deny");
  });

  test("a fatal block is never retried (withRetry respects retryable=false)", async () => {
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls++;
          throw new BlockedError("fb_mkt");
        },
        { classify: (e) => ((e as BlockedError).retryable === false ? "fatal" : "transient"), maxAttempts: 5, baseDelayMs: 0 },
      ),
    ).rejects.toBeInstanceOf(BlockedError);
    expect(calls).toBe(1); // fatal → single attempt, no sneaky retries
  });
});
