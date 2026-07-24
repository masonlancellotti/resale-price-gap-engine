import { HttpError, parseJson, type Transport } from "@flip-desk/net";
import { type LlmClient, type LlmRequest, type LlmResponse, MODEL_IDS, renderSystem, renderUserPrompt } from "./client.js";
import { APPROX_PRICES, estimateCostUsd, type PriceTable } from "./cost.js";

/**
 * Live Anthropic client (plan §7.8, §5.2). The real implementation behind the {@link LlmClient} seam:
 * it POSTs to /v1/messages over the shared {@link Transport} (so retries/rate-limits/circuit-breaking
 * from @flip-desk/net apply), keeps our untrusted-data fencing (system guard + fenced user prompt),
 * and records real token usage → cost. The {@link import("./fake.js").FakeLlm} stays the default in
 * tests; this is only wired in when an API key is present (see @flip-desk/runtime).
 */
export interface AnthropicConfig {
  readonly apiKey: string;
  readonly baseUrl?: string;
  readonly version?: string;
  readonly defaultMaxTokens?: number;
  readonly prices?: PriceTable;
}

interface MessagesResponse {
  readonly content?: ReadonlyArray<{ readonly type: string; readonly text?: string }>;
  readonly usage?: { readonly input_tokens?: number; readonly output_tokens?: number };
  readonly model?: string;
  readonly stop_reason?: string;
}

export class AnthropicLlm implements LlmClient {
  constructor(
    private readonly transport: Transport,
    private readonly cfg: AnthropicConfig,
  ) {}

  async complete(req: LlmRequest): Promise<LlmResponse> {
    const url = `${this.cfg.baseUrl ?? "https://api.anthropic.com"}/v1/messages`;
    const body = JSON.stringify({
      model: MODEL_IDS[req.model],
      max_tokens: req.maxTokens ?? this.cfg.defaultMaxTokens ?? 1024,
      system: renderSystem(req),
      messages: [{ role: "user", content: renderUserPrompt(req) }],
    });
    const res = await this.transport.request({
      method: "POST",
      url,
      headers: {
        "x-api-key": this.cfg.apiKey,
        "anthropic-version": this.cfg.version ?? "2023-06-01",
        "content-type": "application/json",
      },
      body,
    });
    if (res.status >= 400) throw new HttpError(res.status, url, res.body);

    const data = parseJson<MessagesResponse>(res, url);
    const text = (data.content ?? [])
      .filter((c) => c.type === "text")
      .map((c) => c.text ?? "")
      .join("");
    const tokensIn = data.usage?.input_tokens ?? 0;
    const tokensOut = data.usage?.output_tokens ?? 0;
    return {
      text,
      model: req.model,
      tokensIn,
      tokensOut,
      costUsd: estimateCostUsd(req.model, tokensIn, tokensOut, this.cfg.prices ?? APPROX_PRICES),
    };
  }
}
