/** User-scoped access token for the eBay Sell APIs (plan §4.3). Real impl refreshes an OAuth grant. */
export interface AccessTokenProvider {
  getToken(): Promise<string>;
}

export class StaticTokenProvider implements AccessTokenProvider {
  constructor(private readonly token: string) {}
  async getToken(): Promise<string> {
    return this.token;
  }
}
