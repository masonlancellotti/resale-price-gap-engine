import type { EmailMessage } from "./mail.js";

export interface ParsedItem {
  readonly externalId: string;
  readonly url: string;
  readonly title: string;
  readonly priceUsd: string;
  readonly location?: string;
}

export interface EmailParser {
  readonly sourceCode: string;
  matches(msg: EmailMessage): boolean;
  parse(msg: EmailMessage): ParsedItem[];
  /** A known-good fixture for the scheduled canary self-test (plan §10.1). */
  readonly sample: EmailMessage;
}

function strip(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#\d+;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeUrl(url: string): string {
  return url.replace(/&amp;/g, "&");
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * A tolerant link+price extractor. Real alert-email templates vary and drift; this pulls anchors to
 * the source's domain, an id, a title, and the nearest dollar amount. The per-source `sample` is the
 * canary that flags when a template changes (plan §10.1) — parsers quarantine, they don't crash.
 */
function makeParser(config: {
  sourceCode: string;
  domain: string;
  idRegex: RegExp;
  sample: EmailMessage;
}): EmailParser {
  const { sourceCode, domain, idRegex, sample } = config;
  // Lookahead for the trailing price context so it is NOT consumed — otherwise the tail could
  // swallow the next listing's anchor and we'd silently drop items.
  const anchorRe = new RegExp(
    `<a[^>]+href="(https?://[^"]*${escapeRe(domain)}[^"]*)"[^>]*>([\\s\\S]*?)</a>(?=([\\s\\S]{0,180}))`,
    "gi",
  );
  return {
    sourceCode,
    sample,
    matches(msg: EmailMessage): boolean {
      const hay = `${msg.from} ${msg.subject} ${msg.html ?? ""} ${msg.text ?? ""}`;
      return new RegExp(escapeRe(domain), "i").test(hay);
    },
    parse(msg: EmailMessage): ParsedItem[] {
      const html = msg.html ?? msg.text ?? "";
      const items: ParsedItem[] = [];
      const seen = new Set<string>();
      anchorRe.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = anchorRe.exec(html)) !== null) {
        const url = decodeUrl(m[1]!);
        const idMatch = idRegex.exec(url);
        if (!idMatch || !idMatch[1]) continue;
        const id = idMatch[1];
        if (seen.has(id)) continue;
        seen.add(id);
        const inner = strip(m[2]!);
        if (!inner) continue;
        const context = `${inner} ${strip(m[3]!)}`;
        const priceMatch = /\$\s?([\d,]+(?:\.\d{2})?)/.exec(context);
        const title = inner.replace(/\s*[-–—]\s*\$[\d,].*$/, "").trim() || inner;
        items.push({
          externalId: id,
          url,
          title,
          priceUsd: priceMatch ? priceMatch[1]!.replace(/,/g, "") : "0",
        });
      }
      return items;
    },
  };
}

const CL_SAMPLE: EmailMessage = {
  id: "cl-1",
  from: "no-reply@craigslist.org",
  subject: "New results for your saved search",
  receivedAt: "2026-07-04T10:00:00Z",
  html: `<a href="https://sfbay.craigslist.org/sby/vgm/d/game/7712345678.html">Sealed Zelda TOTK - $45</a>`,
};

export const craigslistParser = makeParser({
  sourceCode: "craigslist",
  domain: "craigslist.org",
  idRegex: /\/(\d{6,})\.html/,
  sample: CL_SAMPLE,
});

const MERCARI_SAMPLE: EmailMessage = {
  id: "mc-1",
  from: "no-reply@mercari.com",
  subject: "New listings match your search",
  receivedAt: "2026-07-04T10:00:00Z",
  html: `<a href="https://www.mercari.com/us/item/m12345678/">Nintendo 3DS bundle</a> <span>$60</span>`,
};

export const mercariParser = makeParser({
  sourceCode: "mercari",
  domain: "mercari.com",
  idRegex: /item\/([A-Za-z0-9]+)/,
  sample: MERCARI_SAMPLE,
});

const OFFERUP_SAMPLE: EmailMessage = {
  id: "ou-1",
  from: "notifications@offerup.com",
  subject: "New items near you",
  receivedAt: "2026-07-04T10:00:00Z",
  html: `<a href="https://offerup.com/item/detail/abc123def/">DeWalt drill - $70</a>`,
};

export const offerupParser = makeParser({
  sourceCode: "offerup",
  domain: "offerup.com",
  idRegex: /item\/detail\/([A-Za-z0-9-]+)/,
  sample: OFFERUP_SAMPLE,
});

const FB_SAMPLE: EmailMessage = {
  id: "fb-1",
  from: "notification@facebookmail.com",
  subject: "New items in Marketplace",
  receivedAt: "2026-07-04T10:00:00Z",
  html: `<a href="https://www.facebook.com/marketplace/item/1234567890/">PS5 console - $300</a>`,
};

export const facebookParser = makeParser({
  sourceCode: "fb_mkt",
  domain: "facebook.com",
  idRegex: /marketplace\/item\/(\d+)/,
  sample: FB_SAMPLE,
});

export const ALL_EMAIL_PARSERS = [craigslistParser, mercariParser, offerupParser, facebookParser];
