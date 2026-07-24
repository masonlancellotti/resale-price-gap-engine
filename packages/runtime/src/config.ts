import type { Policy } from "@flip-desk/policy";

/**
 * Runtime configuration (plan §5.4 conventions, §12 secrets). Everything that decides "Fake vs live"
 * flows from here, read from the environment. Safe defaults = fully offline: no key → FakeLlm, no live
 * flag → FakeTransport, always the in-memory store unless a DB URL is wired in later.
 */
export interface RuntimeConfig {
  readonly anthropicApiKey?: string;
  readonly liveHttp: boolean;
  readonly policy: Policy;
}

export const DEFAULT_POLICY: Policy = {
  purchaseDayCapCents: 20_000n, // $200/day (Appendix B)
  autonomy: {
    ingest: "L4",
    commit_purchase_pickup: "L2",
    commit_purchase_checkout: "L2",
    send_offer_ebay: "L3",
    publish_api: "L3",
    reprice_in_band: "L3",
  },
  tiersEnabled: ["T0", "T2"],
};

export function configFromEnv(env: Record<string, string | undefined>, policy: Policy = DEFAULT_POLICY): RuntimeConfig {
  const key = env["ANTHROPIC_API_KEY"];
  return {
    ...(key ? { anthropicApiKey: key } : {}),
    liveHttp: env["FLIP_LIVE_HTTP"] === "1",
    policy,
  };
}
