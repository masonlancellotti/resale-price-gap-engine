/**
 * HTTP transport seam (plan §5.3). Every adapter/provider talks to the outside world through this
 * interface, so the whole system is testable offline with {@link FakeTransport} and swappable
 * between fetch, a proxy, or a recorded-fixture player without touching callers.
 */
export type HttpMethod = "GET" | "POST" | "PUT" | "DELETE" | "PATCH";

export interface HttpRequest {
  readonly method: HttpMethod;
  readonly url: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string;
  readonly signal?: AbortSignal;
}

export interface HttpResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

export interface Transport {
  request(req: HttpRequest): Promise<HttpResponse>;
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly url: string,
    readonly body: string,
  ) {
    super(`HTTP ${status} for ${url}`);
    this.name = "HttpError";
  }
}

/** Parse a JSON body or throw an {@link HttpError} carrying the raw text for debugging. */
export function parseJson<T = unknown>(res: HttpResponse, url: string): T {
  try {
    return JSON.parse(res.body) as T;
  } catch {
    throw new HttpError(res.status, url, res.body);
  }
}

// Minimal structural type for the global fetch, so we don't need the DOM lib.
type FetchLike = (
  url: string,
  init: { method: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal },
) => Promise<{ status: number; headers: { forEach(cb: (value: string, key: string) => void): void }; text(): Promise<string> }>;

/** Production transport over the Node global `fetch`. Not exercised in the offline test suite. */
export class FetchTransport implements Transport {
  constructor(private readonly fetchFn: FetchLike = (globalThis as { fetch: FetchLike }).fetch) {}

  async request(req: HttpRequest): Promise<HttpResponse> {
    const res = await this.fetchFn(req.url, {
      method: req.method,
      ...(req.headers ? { headers: { ...req.headers } } : {}),
      ...(req.body !== undefined ? { body: req.body } : {}),
      ...(req.signal ? { signal: req.signal } : {}),
    });
    const headers: Record<string, string> = {};
    res.headers.forEach((value, key) => {
      headers[key] = value;
    });
    return { status: res.status, headers, body: await res.text() };
  }
}

// ---- test transport ----------------------------------------------------------------------------

export type RouteHandler = (req: HttpRequest) => HttpResponse | Promise<HttpResponse>;
export type RouteMatcher = string | RegExp | ((req: HttpRequest) => boolean);

/** Build a JSON {@link HttpResponse}. */
export function jsonResponse(status: number, obj: unknown, headers: Record<string, string> = {}): HttpResponse {
  return {
    status,
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(obj),
  };
}

/** A route-table transport for tests — no network, deterministic, records every call. */
export class FakeTransport implements Transport {
  readonly calls: HttpRequest[] = [];
  #routes: Array<{ match: (req: HttpRequest) => boolean; handler: RouteHandler }> = [];

  on(matcher: RouteMatcher, handlerOrResponse: RouteHandler | HttpResponse): this {
    const match =
      typeof matcher === "function"
        ? matcher
        : matcher instanceof RegExp
          ? (req: HttpRequest) => matcher.test(req.url)
          : (req: HttpRequest) => req.url.includes(matcher);
    const handler: RouteHandler =
      typeof handlerOrResponse === "function" ? handlerOrResponse : () => handlerOrResponse;
    this.#routes.push({ match, handler });
    return this;
  }

  async request(req: HttpRequest): Promise<HttpResponse> {
    this.calls.push(req);
    for (const r of this.#routes) {
      if (r.match(req)) return r.handler(req);
    }
    throw new Error(`FakeTransport: no route matched ${req.method} ${req.url}`);
  }
}
