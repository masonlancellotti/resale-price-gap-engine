import { describe, expect, test } from "vitest";
import { AnthropicLlm, FakeLlm } from "@flip-desk/llm";
import { FakeTransport, FetchTransport } from "@flip-desk/net";
import { buildRuntime, configFromEnv, DEFAULT_POLICY } from "../src/index.js";

describe("configFromEnv", () => {
  test("empty env → fully offline defaults", () => {
    const c = configFromEnv({});
    expect(c.anthropicApiKey).toBeUndefined();
    expect(c.liveHttp).toBe(false);
    expect(c.policy.tiersEnabled).toEqual(["T0", "T2"]);
  });

  test("env flags flip to live", () => {
    const c = configFromEnv({ ANTHROPIC_API_KEY: "sk-x", FLIP_LIVE_HTTP: "1" });
    expect(c.anthropicApiKey).toBe("sk-x");
    expect(c.liveHttp).toBe(true);
  });
});

describe("buildRuntime — seam selection", () => {
  test("default config wires all Fakes", () => {
    const rt = buildRuntime(configFromEnv({}));
    expect(rt.transport).toBeInstanceOf(FakeTransport);
    expect(rt.llm).toBeInstanceOf(FakeLlm);
    expect(rt.mode).toEqual({ http: "fake", llm: "fake", store: "memory" });
  });

  test("an API key + live flag wires the live transport and Anthropic client", () => {
    const rt = buildRuntime(configFromEnv({ ANTHROPIC_API_KEY: "sk-x", FLIP_LIVE_HTTP: "1" }));
    expect(rt.transport).toBeInstanceOf(FetchTransport);
    expect(rt.llm).toBeInstanceOf(AnthropicLlm);
    expect(rt.mode).toEqual({ http: "live", llm: "live", store: "memory" });
  });

  test("the Sentinel is wired to the kill switch", () => {
    const rt = buildRuntime({ liveHttp: false, policy: DEFAULT_POLICY });
    expect(rt.sentinel.check({ gate: "ingest", tier: "T0", scope: {} }).type).toBe("allow");
    rt.killSwitch.trip({ kind: "global" });
    expect(rt.sentinel.check({ gate: "ingest", tier: "T0", scope: {} })).toEqual({ type: "deny", reason: "kill_switch" });
  });
});
