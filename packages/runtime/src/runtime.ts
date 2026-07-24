import { AnthropicLlm, FakeLlm, type FakeHandler, type LlmClient } from "@flip-desk/llm";
import { FakeTransport, FetchTransport, type Transport } from "@flip-desk/net";
import { KillSwitch, Sentinel } from "@flip-desk/policy";
import { InMemoryStore, type Store } from "@flip-desk/store";
import type { RuntimeConfig } from "./config.js";

/**
 * The composition root (plan §5.3). ONE place assembles the whole desk from seams, choosing Fake or
 * live per {@link RuntimeConfig}. Everything downstream (engine, api, UI) depends on these interfaces,
 * never on a concrete transport/LLM/DB — so going live is a config change here, not a code change
 * everywhere.
 */
export interface RuntimeMode {
  readonly http: "live" | "fake";
  readonly llm: "live" | "fake";
  readonly store: "memory";
}

export interface Runtime {
  readonly transport: Transport;
  readonly llm: LlmClient;
  readonly store: Store;
  readonly killSwitch: KillSwitch;
  readonly sentinel: Sentinel;
  readonly mode: RuntimeMode;
}

export interface RuntimeOverrides {
  /** Deterministic handler for the FakeLlm when no API key is configured (demo/tests). */
  readonly fakeLlmHandler?: FakeHandler;
  readonly transport?: Transport;
  readonly store?: Store;
}

export function buildRuntime(config: RuntimeConfig, overrides: RuntimeOverrides = {}): Runtime {
  const transport = overrides.transport ?? (config.liveHttp ? new FetchTransport() : new FakeTransport());
  const llm: LlmClient = config.anthropicApiKey
    ? new AnthropicLlm(transport, { apiKey: config.anthropicApiKey })
    : new FakeLlm(overrides.fakeLlmHandler ?? (() => ""));
  const store = overrides.store ?? new InMemoryStore();
  const killSwitch = new KillSwitch();
  const sentinel = new Sentinel({ killSwitch, policy: config.policy });

  return {
    transport,
    llm,
    store,
    killSwitch,
    sentinel,
    mode: {
      http: config.liveHttp ? "live" : "fake",
      llm: config.anthropicApiKey ? "live" : "fake",
      store: "memory",
    },
  };
}
