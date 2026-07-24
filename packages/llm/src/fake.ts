import { z } from "zod";
import {
  approxTokens,
  type LlmClient,
  type LlmRequest,
  type LlmResponse,
  renderSystem,
  renderUserPrompt,
} from "./client.js";
import { estimateCostUsd, type PriceTable } from "./cost.js";

/** A handler maps a request to model output — a string, or an object serialized to JSON. */
export type FakeHandler = (req: LlmRequest) => string | object;

/**
 * Deterministic offline LLM. It computes realistic token/cost usage from prompt/response lengths so
 * budget and cost-accounting paths are exercised without any network or API key.
 */
export class FakeLlm implements LlmClient {
  readonly calls: LlmRequest[] = [];

  constructor(
    private readonly handler: FakeHandler,
    private readonly prices?: PriceTable,
  ) {}

  async complete(req: LlmRequest): Promise<LlmResponse> {
    this.calls.push(req);
    const out = this.handler(req);
    const text = typeof out === "string" ? out : JSON.stringify(out);
    const promptText = renderSystem(req) + "\n" + renderUserPrompt(req);
    const tokensIn = approxTokens(promptText);
    const tokensOut = approxTokens(text);
    const costUsd = this.prices
      ? estimateCostUsd(req.model, tokensIn, tokensOut, this.prices)
      : estimateCostUsd(req.model, tokensIn, tokensOut);
    return { text, model: req.model, tokensIn, tokensOut, costUsd };
  }
}

export class LlmSchemaError extends Error {
  constructor(
    readonly raw: string,
    readonly issues: z.ZodIssue[] | string,
  ) {
    super(`LLM output failed schema validation: ${typeof issues === "string" ? issues : issues.map((i) => i.message).join("; ")}`);
    this.name = "LlmSchemaError";
  }
}

/**
 * Schema-forced structured extraction (plan §7.2, §12.5). The model's free text is parsed and
 * validated against a zod schema; a failure is a typed error, never a value that flows onward. This
 * is the boundary that stops prompt injection from turning into structured lies downstream.
 */
export async function extract<S extends z.ZodTypeAny>(
  client: LlmClient,
  schema: S,
  req: LlmRequest,
): Promise<{ value: z.infer<S>; usage: LlmResponse }> {
  const res = await client.complete({
    ...req,
    instruction: `${req.instruction}\n\nRespond with ONLY a single JSON object matching the required schema. No prose.`,
  });
  let parsed: unknown;
  try {
    parsed = JSON.parse(res.text);
  } catch {
    throw new LlmSchemaError(res.text, "not valid JSON");
  }
  const result = schema.safeParse(parsed);
  if (!result.success) throw new LlmSchemaError(res.text, result.error.issues);
  return { value: result.data, usage: res };
}
