import { parseJson, type Transport } from "@flip-desk/net";

/**
 * eBay application OAuth (client-credentials) token manager (plan §4.3). Caches the app token and
 * refreshes on expiry; a refresh failure surfaces as an error the Sentinel treats as an
 * account-health signal ("tokens are the system's oxygen", plan §10.1). Clock is injectable.
 */
export interface EbayOAuthOptions {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly baseUrl?: string;
  readonly scope?: string;
  readonly now?: () => number;
}

export class EbayOAuth {
  #token: { value: string; expiresAt: number } | undefined;

  constructor(
    private readonly transport: Transport,
    private readonly opts: EbayOAuthOptions,
  ) {}

  async token(): Promise<string> {
    const now = this.opts.now ? this.opts.now() : Date.now();
    if (this.#token && this.#token.expiresAt > now + 60_000) return this.#token.value;

    const base = this.opts.baseUrl ?? "https://api.ebay.com";
    const scope = this.opts.scope ?? "https://api.ebay.com/oauth/api_scope";
    const basic = Buffer.from(`${this.opts.clientId}:${this.opts.clientSecret}`).toString("base64");
    const url = `${base}/identity/v1/oauth2/token`;
    const res = await this.transport.request({
      method: "POST",
      url,
      headers: { authorization: `Basic ${basic}`, "content-type": "application/x-www-form-urlencoded" },
      body: `grant_type=client_credentials&scope=${encodeURIComponent(scope)}`,
    });
    if (res.status >= 400) throw new Error(`eBay OAuth failed: HTTP ${res.status}`);
    const data = parseJson<{ access_token: string; expires_in: number }>(res, url);
    this.#token = { value: data.access_token, expiresAt: now + data.expires_in * 1000 };
    return this.#token.value;
  }
}
