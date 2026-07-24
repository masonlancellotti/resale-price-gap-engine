import { describe, expect, test } from "vitest";
import type { AdapterContext, RawListing } from "@flip-desk/core";
import { FakeTransport, jsonResponse } from "@flip-desk/net";
import { EbayBrowseAdapter, EbayOAuth, normalizeEbay } from "../src/index.js";

const quietCtx: AdapterContext = { log: () => {} };

const ITEM_1 = {
  itemId: "v1|111|0",
  title: "Sony PS5 Slim Disc Console",
  price: { value: "420.00", currency: "USD" },
  itemWebUrl: "https://www.ebay.com/itm/111",
  condition: "Used",
  seller: { username: "seller_one", feedbackPercentage: "99.2" },
  itemLocation: { postalCode: "32601" },
};
const ITEM_2 = {
  itemId: "v1|222|0",
  title: "PS5 DualSense Controller",
  price: { value: "45.00", currency: "USD" },
};
const MALFORMED = { itemId: "v1|bad|0" }; // no title/price

function oauthRoute() {
  return jsonResponse(200, { access_token: "TOKEN-1", expires_in: 7200 });
}

describe("EbayOAuth", () => {
  test("caches the app token and refreshes only after expiry", async () => {
    let t = 0;
    const transport = new FakeTransport().on("/oauth2/token", oauthRoute());
    const oauth = new EbayOAuth(transport, { clientId: "c", clientSecret: "s", now: () => t });

    const tokenCalls = () => transport.calls.filter((c) => c.url.includes("/oauth2/token")).length;
    expect(await oauth.token()).toBe("TOKEN-1");
    expect(await oauth.token()).toBe("TOKEN-1"); // cached
    expect(tokenCalls()).toBe(1);

    t += 7200 * 1000; // token expired
    await oauth.token();
    expect(tokenCalls()).toBe(2);
  });

  test("throws on OAuth failure (account-health signal)", async () => {
    const transport = new FakeTransport().on("/oauth2/token", jsonResponse(401, { error: "invalid_client" }));
    const oauth = new EbayOAuth(transport, { clientId: "c", clientSecret: "bad" });
    await expect(oauth.token()).rejects.toThrow(/OAuth failed/);
  });
});

describe("EbayBrowseAdapter", () => {
  function makeAdapter() {
    const transport = new FakeTransport()
      .on("/oauth2/token", oauthRoute())
      .on("/item_summary/search", jsonResponse(200, { itemSummaries: [ITEM_1, MALFORMED, ITEM_2], total: 3 }));
    const oauth = new EbayOAuth(transport, { clientId: "c", clientSecret: "s" });
    return { transport, adapter: new EbayBrowseAdapter(transport, oauth, { queries: ["ps5"], now: () => 0 }) };
  }

  test("streams raw listings, skipping malformed items", async () => {
    const { adapter } = makeAdapter();
    const raws: RawListing[] = [];
    for await (const r of adapter.poll(quietCtx)) raws.push(r);

    expect(raws.map((r) => r.externalId)).toEqual(["v1|111|0", "v1|222|0"]); // malformed skipped
    expect(raws[0]!.sourceCode).toBe("ebay");
    expect(raws[0]!.url).toBe("https://www.ebay.com/itm/111");
    expect(raws[0]!.channel).toBe("api");
  });

  test("sends the bearer token on the search request", async () => {
    const { transport, adapter } = makeAdapter();
    for await (const _ of adapter.poll(quietCtx)) void _;
    const search = transport.calls.find((c) => c.url.includes("/item_summary/search"));
    expect(search?.headers?.["authorization"]).toBe("Bearer TOKEN-1");
  });

  test("an aborted signal stops the stream (P7)", async () => {
    const { adapter } = makeAdapter();
    const controller = new AbortController();
    controller.abort();
    const raws: RawListing[] = [];
    for await (const r of adapter.poll({ signal: controller.signal, log: () => {} })) raws.push(r);
    expect(raws).toHaveLength(0);
  });

  test("normalizeEbay maps a raw item to a canonical listing", async () => {
    const { adapter } = makeAdapter();
    let raw: RawListing | undefined;
    for await (const r of adapter.poll(quietCtx)) {
      raw = r;
      break;
    }
    const listing = normalizeEbay(raw!);
    expect(listing.title).toBe("Sony PS5 Slim Disc Console");
    expect(listing.priceCents).toBe(42000n); // $420.00 exact
    expect(listing.conditionClaimed).toBe("Used");
    expect(listing.attrs["seller"]).toBe("seller_one");
  });
});
