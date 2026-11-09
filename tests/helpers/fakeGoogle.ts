/**
 * A strict fake for everything the server fetches (Google Health, Google OAuth,
 * Open Food Facts). Tests register handlers; any request without a handler
 * throws, so a test can't silently reach the real network.
 */
export interface FakeRequest {
  url: URL;
  method: string;
  body: any;
  headers: Record<string, string>;
}
type Handler = (req: FakeRequest) => Response | Promise<Response>;

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** Google's long-running Operation wrapper, already done, as returned by create/patch/batchDelete. */
export const done = (response: unknown) => json({ done: true, response });

export function fakeFetch() {
  const calls: FakeRequest[] = [];
  const routes: { method: string; match: RegExp; handler: Handler; times?: number }[] = [];

  globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const method = (init.method ?? "GET").toUpperCase();
    let body: any = init.body;
    if (typeof body === "string") {
      try {
        body = JSON.parse(body);
      } catch {
        /* form-encoded or text */
      }
    } else if (body instanceof URLSearchParams) {
      body = Object.fromEntries(body);
    }
    const headers = Object.fromEntries(new Headers(init.headers).entries());
    const req: FakeRequest = { url, method, body, headers };
    calls.push(req);
    const full = `${url.origin}${url.pathname}`;
    const route = routes.find((r) => r.method === method && r.match.test(full) && (r.times === undefined || r.times > 0));
    if (!route) throw new Error(`Unexpected request in test: ${method} ${url.href}`);
    if (route.times !== undefined) route.times--;
    return route.handler(req);
  }) as typeof fetch;

  const api = {
    calls,
    /** Register a handler. Later registrations don't override earlier ones; use `times` for sequences. */
    on(method: string, match: RegExp, handler: Handler, times?: number) {
      routes.push({ method, match, handler, times });
      return api;
    },
    /** Calls whose URL path matches. */
    to(match: RegExp, method?: string) {
      return calls.filter((c) => match.test(c.url.pathname) && (!method || c.method === method));
    },
  };
  return api;
}

export const HEALTH = "https://health.googleapis.com/v4/users/me/dataTypes";
