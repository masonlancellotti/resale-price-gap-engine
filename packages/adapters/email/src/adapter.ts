import type { AdapterContext, RawListing, SourceAdapter } from "@flip-desk/core";
import type { MailProvider, MailQuery } from "./mail.js";
import type { EmailParser } from "./parsers.js";

/**
 * Email alert-parser source adapter (plan §4.2, T2). Reads saved-search alert emails the platform
 * itself sends (Craigslist/Mercari/OfferUp/FB-weak) and turns them into raw listings — the safest,
 * zero-collection-risk sourcing channel. One adapter per source (its `code` follows the parser).
 */
export interface EmailAdapterOptions {
  readonly query?: MailQuery;
  readonly now?: () => number;
}

export class EmailAlertAdapter implements SourceAdapter {
  readonly code: string;
  readonly tier = "T2" as const;
  readonly channel = "email_alert" as const;

  constructor(
    private readonly mail: MailProvider,
    private readonly parser: EmailParser,
    private readonly opts: EmailAdapterOptions = {},
  ) {
    this.code = parser.sourceCode;
  }

  async *poll(ctx: AdapterContext): AsyncIterable<RawListing> {
    const messages = await this.mail.fetch(this.opts.query ?? {});
    const fetchedAt = new Date(this.opts.now ? this.opts.now() : Date.now()).toISOString();
    for (const msg of messages) {
      if (ctx.signal?.aborted) return;
      if (!this.parser.matches(msg)) continue;
      let items;
      try {
        items = this.parser.parse(msg);
      } catch (err) {
        ctx.log(`email parse failed for ${msg.id}: ${(err as Error).message}`);
        continue; // one bad email never stalls the rest
      }
      for (const item of items) {
        if (ctx.signal?.aborted) return;
        yield {
          sourceCode: this.code,
          externalId: item.externalId,
          channel: "email_alert",
          fetchedAt,
          url: item.url,
          payload: {
            title: item.title,
            priceUsd: item.priceUsd,
            url: item.url,
            ...(item.location !== undefined ? { location: item.location } : {}),
          },
        };
      }
    }
  }

  /** Canary: parse the parser's known-good sample; drift → quarantine (plan §10.1). */
  async selfTest(): Promise<boolean> {
    return this.parser.parse(this.parser.sample).length > 0;
  }
}
