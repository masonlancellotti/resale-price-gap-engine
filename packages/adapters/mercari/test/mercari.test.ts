import { describe, expect, test } from "vitest";
import type { PublishInput } from "@flip-desk/core";
import { FakeTransport, jsonResponse } from "@flip-desk/net";
import { MercariPublisher, StaticMercariToken } from "../src/index.js";

const tokens = new StaticMercariToken("MERC-TOKEN");
function draft(over: Partial<PublishInput> = {}): PublishInput {
  return {
    platform: "mercari",
    title: "Sony PlayStation 3 Slim 160GB Like New",
    description: "Condition: Like New.",
    priceCents: 12_000n,
    specifics: { Condition: "Like New", Brand: "Sony" },
    photoKeys: ["proc/1x1/a.jpg"],
    idempotencyKey: "list:FD-2026-00001:mercari",
    ...over,
  };
}

describe("MercariPublisher", () => {
  test("publishes with brand-first copy, honest condition, dedup key", async () => {
    const t = new FakeTransport().on("/v1/listings", jsonResponse(201, { id: "m-778899" }));
    const res = await new MercariPublisher(t, tokens).publish(draft());
    expect(res.externalId).toBe("m-778899");
    expect(res.url).toContain("m-778899");
    const body = JSON.parse(t.calls[0]!.body!);
    expect(body.price).toBe(120); // whole dollars, no float
    expect(body.condition).toBe("like_new");
    expect(body.referenceKey).toBe("list:FD-2026-00001:mercari");
    expect(t.calls[0]?.headers?.["authorization"]).toBe("Bearer MERC-TOKEN");
  });

  test("end() delists on a sale elsewhere", async () => {
    const t = new FakeTransport().on("/v1/listings/", jsonResponse(200, {}));
    await new MercariPublisher(t, tokens).end("m-778899");
    expect(t.calls[0]?.method).toBe("DELETE");
    expect(t.calls[0]?.url).toContain("/v1/listings/m-778899");
  });

  test("surfaces API errors instead of swallowing them", async () => {
    const t = new FakeTransport().on("/v1/listings", jsonResponse(422, { message: "invalid" }));
    await expect(new MercariPublisher(t, tokens).publish(draft())).rejects.toThrow(/HTTP 422/);
  });
});
