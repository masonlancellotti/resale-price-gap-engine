import { describe, expect, test } from "vitest";
import type { AdapterContext, RawListing } from "@flip-desk/core";
import {
  ALL_EMAIL_PARSERS,
  craigslistParser,
  EmailAlertAdapter,
  type EmailMessage,
  FakeMailProvider,
  mercariParser,
  normalizeEmail,
  offerupParser,
} from "../src/index.js";

const quietCtx: AdapterContext = { log: () => {} };

const CL_EMAIL: EmailMessage = {
  id: "cl-multi",
  from: "no-reply@craigslist.org",
  subject: "New results for your saved search: video games",
  receivedAt: "2026-07-04T10:00:00Z",
  html: `
    <div><a href="https://sfbay.craigslist.org/sby/vgm/d/zelda/7712345678.html">Sealed Zelda TOTK - $45</a></div>
    <div><a href="https://sfbay.craigslist.org/pen/vgm/d/ps5/7712999888.html">PS5 Slim disc - $300</a></div>
  `,
};

const MERCARI_EMAIL: EmailMessage = {
  id: "mc-1",
  from: "no-reply@mercari.com",
  subject: "New listings",
  receivedAt: "2026-07-04T10:00:00Z",
  html: `<a href="https://www.mercari.com/us/item/m12345678/">Nintendo 3DS bundle</a> <span>$60</span>`,
};

describe("email parsers", () => {
  test("Craigslist parses multiple listings (lookahead doesn't drop items)", () => {
    const items = craigslistParser.parse(CL_EMAIL);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ externalId: "7712345678", title: "Sealed Zelda TOTK", priceUsd: "45" });
    expect(items[1]).toMatchObject({ externalId: "7712999888", title: "PS5 Slim disc", priceUsd: "300" });
  });

  test("Mercari pulls the price from adjacent context", () => {
    const items = mercariParser.parse(MERCARI_EMAIL);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ externalId: "m12345678", title: "Nintendo 3DS bundle", priceUsd: "60" });
  });

  test("matches() only fires for the right source", () => {
    expect(craigslistParser.matches(CL_EMAIL)).toBe(true);
    expect(mercariParser.matches(CL_EMAIL)).toBe(false);
    expect(offerupParser.matches(MERCARI_EMAIL)).toBe(false);
  });

  test("all parsers pass their canary self-test", () => {
    for (const p of ALL_EMAIL_PARSERS) {
      expect(p.parse(p.sample).length).toBeGreaterThan(0);
    }
  });

  test("an email with no matching links yields nothing (no crash)", () => {
    const junk: EmailMessage = { id: "x", from: "spam@x.com", subject: "hi", receivedAt: "2026-07-04T00:00:00Z", html: "<p>no links here</p>" };
    expect(craigslistParser.parse(junk)).toEqual([]);
  });
});

describe("EmailAlertAdapter", () => {
  test("streams raw listings from alert emails", async () => {
    const adapter = new EmailAlertAdapter(new FakeMailProvider([CL_EMAIL]), craigslistParser, { now: () => 0 });
    const raws: RawListing[] = [];
    for await (const r of adapter.poll(quietCtx)) raws.push(r);

    expect(raws.map((r) => r.externalId)).toEqual(["7712345678", "7712999888"]);
    expect(raws[0]!.sourceCode).toBe("craigslist");
    expect(raws[0]!.channel).toBe("email_alert");

    const listing = normalizeEmail(raws[0]!);
    expect(listing.title).toBe("Sealed Zelda TOTK");
    expect(listing.priceCents).toBe(4_500n);
    expect(listing.url).toContain("craigslist.org");
  });

  test("selfTest passes; abort stops the stream", async () => {
    const adapter = new EmailAlertAdapter(new FakeMailProvider([CL_EMAIL]), craigslistParser);
    expect(await adapter.selfTest()).toBe(true);

    const controller = new AbortController();
    controller.abort();
    const raws: RawListing[] = [];
    for await (const r of adapter.poll({ signal: controller.signal, log: () => {} })) raws.push(r);
    expect(raws).toHaveLength(0);
  });
});
