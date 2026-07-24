import { describe, expect, test } from "vitest";
import type { PublishInput } from "@flip-desk/core";
import { FakeTransport, jsonResponse } from "@flip-desk/net";
import { amountToCents, centsToAmount, EbaySellPublisher, StaticTokenProvider } from "../src/index.js";

const tokens = new StaticTokenProvider("USER-TOKEN");

function draft(over: Partial<PublishInput> = {}): PublishInput {
  return {
    platform: "ebay",
    title: "Sony PlayStation 3 Slim Good",
    description: "Condition: Good Condition.",
    priceCents: 12_000n,
    specifics: { Condition: "Good Condition", Brand: "Sony", Storage: "160GB" },
    photoKeys: ["proc/1x1/a.jpg"],
    idempotencyKey: "list:FD-2026-00001:ebay",
    ...over,
  };
}

describe("amount conversions", () => {
  test("cents ↔ eBay amount string, sign-aware, no float drift", () => {
    expect(centsToAmount(12_000n)).toBe("120.00");
    expect(centsToAmount(12_034n)).toBe("120.34");
    expect(centsToAmount(-250n)).toBe("-2.50");
    expect(amountToCents("120.34")).toBe(12_034n);
    expect(amountToCents("-2.50")).toBe(-250n);
  });
});

describe("EbaySellPublisher.publish", () => {
  test("runs Inventory→Offer→Publish and returns the offerId + listing URL", async () => {
    const t = new FakeTransport()
      .on("/publish", jsonResponse(200, { listingId: "1122334455" }))
      .on("/inventory_item/", jsonResponse(204, {}))
      .on("/offer", jsonResponse(201, { offerId: "OFFER-9" }));

    const res = await new EbaySellPublisher(t, tokens, { merchantLocationKey: "WH1" }).publish(draft());
    expect(res.externalId).toBe("OFFER-9");
    expect(res.url).toBe("https://www.ebay.com/itm/1122334455");

    // inventory PUT keyed on our stable SKU (the idempotency key)
    const put = t.calls.find((c) => c.method === "PUT");
    expect(put?.url).toContain(encodeURIComponent("list:FD-2026-00001:ebay"));
    expect(put?.headers?.["authorization"]).toBe("Bearer USER-TOKEN");
    const putBody = JSON.parse(put!.body!);
    expect(putBody.condition).toBe("USED_GOOD");
    expect(putBody.product.aspects.Brand).toEqual(["Sony"]);

    // offer price serialized without float
    const offer = t.calls.find((c) => c.method === "POST" && c.url.endsWith("/offer"));
    expect(JSON.parse(offer!.body!).pricingSummary.price.value).toBe("120.00");
  });

  test("end() withdraws the offer", async () => {
    const t = new FakeTransport().on("/withdraw", jsonResponse(200, {}));
    await new EbaySellPublisher(t, tokens).end("OFFER-9");
    expect(t.calls[0]?.url).toContain("/offer/OFFER-9/withdraw");
    expect(t.calls[0]?.method).toBe("POST");
  });

  test("a 4xx surfaces as an HttpError (never silently swallowed)", async () => {
    const t = new FakeTransport().on("/inventory_item/", jsonResponse(400, { errors: [{ message: "bad sku" }] }));
    await expect(new EbaySellPublisher(t, tokens).publish(draft())).rejects.toThrow(/HTTP 400/);
  });
});

describe("EbaySellPublisher.finances", () => {
  test("maps transactions to signed cents for ledger reconciliation", async () => {
    const t = new FakeTransport().on("/finances/v1/transaction", jsonResponse(200, {
      transactions: [
        { transactionType: "SALE", amount: { value: "120.00" } },
        { transactionType: "NON_SALE_CHARGE", amount: { value: "-16.62" }, feeType: "FINAL_VALUE_FEE" },
      ],
    }));
    const txns = await new EbaySellPublisher(t, tokens).finances();
    expect(txns[0]?.amountCents).toBe(12_000n);
    expect(txns[1]?.amountCents).toBe(-1_662n);
    expect(txns[1]?.feeType).toBe("FINAL_VALUE_FEE");
  });
});
