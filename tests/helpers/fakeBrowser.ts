import type { GisOAuth2, GisTokenResponse } from "../../platform/auth.js";
import { json, type FakeRequest } from "./fakeGoogle.js";

/**
 * Fakes for the browser platform: Google Identity Services, a Drive
 * appDataFolder, and sessionStorage. All values are synthetic.
 */

export type GisAnswer =
  | { token: GisTokenResponse }
  | { error: string } // error_callback type, e.g. popup_failed_to_open
  | "hang"; // never answers (silent renewal blocked without a pop-up)

/** `answer` also gets the token client's scope string (`req.scope`), like the scopes Google is asked for. */
export function fakeGis(answer: (req: { prompt?: string; login_hint?: string; scope: string }) => GisAnswer) {
  const requests: { prompt?: string; login_hint?: string }[] = [];
  const revoked: string[] = [];
  const configs: Parameters<GisOAuth2["initTokenClient"]>[0][] = [];
  let inits = 0;
  const oauth2: GisOAuth2 = {
    initTokenClient(cfg) {
      inits++;
      configs.push(cfg);
      return {
        requestAccessToken(overrides = {}) {
          requests.push(overrides);
          const a = answer({ ...overrides, scope: cfg.scope });
          if (a === "hang") return;
          // GIS answers asynchronously (after the pop-up closes).
          setTimeout(() => ("error" in a ? cfg.error_callback?.({ type: a.error }) : cfg.callback(a.token)), 0);
        },
      };
    },
    revoke(token, done) {
      revoked.push(token);
      done?.();
    },
  };
  return { oauth2, requests, revoked, configs, inits: () => inits };
}

let tokenSeq = 0;
/** Answer like Google with include_granted_scopes=false: only the requested scopes the user granted. */
export const grantRequested = (granted: string[]) => (req: { scope: string }) =>
  tokenAnswer(req.scope.split(" ").filter((s) => granted.includes(s)));

/** A synthetic GIS token answer with the given scopes. */
export const tokenAnswer = (scopes: string[], expiresIn = 3599): GisAnswer => ({
  token: { access_token: `ya29.synthetic-${++tokenSeq}`, expires_in: expiresIn, scope: scopes.join(" ") },
});

export function memoryStorage(): Pick<Storage, "getItem" | "setItem" | "removeItem"> & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

/**
 * An in-memory Drive appDataFolder behind fakeFetch routes. Returns the route
 * installer plus the stored files so tests can inspect or seed them.
 */
export function fakeDrive() {
  const files = new Map<string, { name: string; parents: string[]; content: string; modifiedTime: string }>();
  let seq = 0;
  let mode: "ok" | "noScope" | "down" = "ok";

  const denied = () =>
    mode === "noScope"
      ? json({ error: { code: 403, message: "Request had insufficient authentication scopes.", errors: [{ reason: "insufficientPermissions" }] } }, 403)
      : mode === "down"
        ? json({ error: { code: 503, message: "Backend Error" } }, 503)
        : null;

  const routes = {
    list(req: FakeRequest) {
      const d = denied();
      if (d) return d;
      const name = /name = '([^']+)'/.exec(req.url.searchParams.get("q") ?? "")?.[1];
      const hits = [...files.entries()]
        .filter(([, f]) => f.name === name && f.parents.includes("appDataFolder") && req.url.searchParams.get("spaces") === "appDataFolder")
        .sort((a, b) => b[1].modifiedTime.localeCompare(a[1].modifiedTime))
        .map(([id, f]) => ({ id, modifiedTime: f.modifiedTime }));
      return json({ files: hits });
    },
    get(req: FakeRequest) {
      const d = denied();
      if (d) return d;
      const id = decodeURIComponent(req.url.pathname.split("/").pop()!);
      const f = files.get(id);
      if (!f || req.url.searchParams.get("alt") !== "media") return json({ error: { code: 404, message: "File not found" } }, 404);
      return new Response(f.content, { status: 200, headers: { "content-type": "application/json" } });
    },
    create(req: FakeRequest) {
      const d = denied();
      if (d) return d;
      const boundary = /boundary=([^;]+)/.exec(req.headers["content-type"] ?? "")?.[1];
      if (!boundary || typeof req.body !== "string") return json({ error: { message: "bad multipart" } }, 400);
      const parts = req.body.split(`--${boundary}`).slice(1, -1).map((p) => p.split("\r\n\r\n").slice(1).join("\r\n\r\n").replace(/\r\n$/, ""));
      const meta = JSON.parse(parts[0]!) as { name: string; parents: string[] };
      const id = `file${++seq}`;
      files.set(id, { name: meta.name, parents: meta.parents, content: parts[1]!, modifiedTime: new Date(Date.UTC(2026, 0, 1, 0, 0, seq)).toISOString() });
      return json({ id });
    },
    update(req: FakeRequest) {
      const d = denied();
      if (d) return d;
      const id = decodeURIComponent(req.url.pathname.split("/").pop()!);
      const f = files.get(id);
      if (!f) return json({ error: { code: 404, message: "File not found" } }, 404);
      f.content = typeof req.body === "string" ? req.body : JSON.stringify(req.body);
      f.modifiedTime = new Date(Date.UTC(2026, 0, 1, 0, 0, ++seq)).toISOString();
      return json({ id });
    },
  };

  return {
    files,
    setMode(m: typeof mode) {
      mode = m;
    },
    /** Register the Drive routes on a fakeFetch() instance. */
    install<T extends { on(method: string, match: RegExp, handler: (r: FakeRequest) => Response | Promise<Response>): T }>(f: T): T {
      return f
        .on("GET", /^https:\/\/www\.googleapis\.com\/drive\/v3\/files$/, routes.list)
        .on("GET", /^https:\/\/www\.googleapis\.com\/drive\/v3\/files\/[^/]+$/, routes.get)
        .on("POST", /^https:\/\/www\.googleapis\.com\/upload\/drive\/v3\/files$/, routes.create)
        .on("PATCH", /^https:\/\/www\.googleapis\.com\/upload\/drive\/v3\/files\/[^/]+$/, routes.update);
    },
    /** The parsed settings document, if any. */
    doc(): { entries: Record<string, { value: unknown; updatedAt: number }> } | null {
      const f = [...files.values()].find((x) => x.name === "settings.json");
      return f ? JSON.parse(f.content) : null;
    },
    seed(doc: unknown) {
      files.set(`file${++seq}`, { name: "settings.json", parents: ["appDataFolder"], content: JSON.stringify(doc), modifiedTime: new Date(Date.UTC(2026, 0, 1, 0, 0, seq)).toISOString() });
    },
  };
}
