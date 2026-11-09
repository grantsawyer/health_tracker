import { ReauthRequiredError } from "../core/errors.js";

/**
 * Sign-in with Google Identity Services (GIS) token model: no client secret,
 * no refresh token (docs/browser-migration-plan.md §3).
 *
 * - `signIn()` must be called from a click handler: it calls GIS synchronously
 *   so the consent pop-up isn't blocked. Call `load()` at startup so GIS is
 *   ready by the time the user clicks.
 * - Access tokens last about an hour. `getAccessToken()` returns the current one
 *   while it has over a minute left, otherwise tries one silent renewal
 *   (`prompt: ''`). If the browser blocks that or the user must choose again,
 *   it throws ReauthRequiredError and the UI shows "Sign in" (about one click
 *   per browsing session).
 * - The token lives in memory and sessionStorage (so a reload within the hour
 *   doesn't ask again), never in localStorage.
 */

export const GIS_SCRIPT_URL = "https://accounts.google.com/gsi/client";
const USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo";
const EXPIRY_MARGIN_MS = 60_000;

// ── The slice of the GIS API we use ──────────────────────────────────────────
export interface GisTokenResponse {
  access_token?: string;
  expires_in?: number | string;
  scope?: string;
  error?: string;
  error_description?: string;
}
export interface GisTokenClient {
  requestAccessToken(overrides?: { prompt?: string; login_hint?: string }): void;
}
export interface GisOAuth2 {
  initTokenClient(config: {
    client_id: string;
    scope: string;
    callback: (r: GisTokenResponse) => void;
    error_callback?: (e: { type: string; message?: string }) => void;
  }): GisTokenClient;
  revoke(token: string, done?: () => void): void;
}

/** Load https://accounts.google.com/gsi/client once and return google.accounts.oauth2. */
export function loadGisScript(doc: Document = document): Promise<GisOAuth2> {
  type W = { google?: { accounts?: { oauth2?: GisOAuth2 } } };
  const ready = () => (globalThis as W).google?.accounts?.oauth2;
  const existing = ready();
  if (existing) return Promise.resolve(existing);
  return new Promise((resolve, reject) => {
    const s = doc.createElement("script");
    s.src = GIS_SCRIPT_URL;
    s.async = true;
    s.onload = () => {
      const g = ready();
      if (g) resolve(g);
      else reject(new Error("Google sign-in loaded but isn't available"));
    };
    s.onerror = () => reject(new Error("Couldn't load Google sign-in. Check your connection or content blockers."));
    doc.head.appendChild(s);
  });
}

// ── Session ──────────────────────────────────────────────────────────────────
export interface Session {
  accessToken: string;
  expiresAt: number;
  /** Scopes actually granted (users may untick some on the consent screen). */
  scopes: string[];
  email?: string;
}
export type PublicSession = Omit<Session, "accessToken">;

export interface AuthDeps {
  clientId: string;
  /** Full scope URLs plus "openid" / "email". */
  scopes: string[];
  /** Resolves GIS (tests pass a fake; the app passes loadGisScript). */
  gis: () => Promise<GisOAuth2>;
  fetch?: typeof fetch;
  /** sessionStorage in the app; null disables persistence (tests may pass a memory Storage). */
  storage?: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null;
  now?: () => number;
  /** How long a silent renewal may take before giving up. */
  silentTimeoutMs?: number;
}

export interface GisAuth {
  load(): Promise<void>;
  /** Interactive sign-in; call from a click handler. Resolves with the session, rejects if declined. */
  signIn(): Promise<PublicSession>;
  getAccessToken(): Promise<string>;
  invalidateAccessToken(): Promise<void>;
  session(): PublicSession | null;
  hasScope(scope: string): boolean;
  /** The signed-in email, kept after the token expires so the next renewal can hint the same account. */
  email(): string | undefined;
  signOut(): Promise<void>;
  onChange(listener: (s: PublicSession | null) => void): () => void;
}

const storageKey = (clientId: string) => `health-tracker:session:${clientId}`;

export function createGisAuth(deps: AuthDeps): GisAuth {
  const now = deps.now ?? Date.now;
  const doFetch = deps.fetch ?? ((...a: Parameters<typeof fetch>) => globalThis.fetch(...a));
  const storage = deps.storage === undefined ? (typeof sessionStorage === "undefined" ? null : sessionStorage) : deps.storage;
  const silentTimeoutMs = deps.silentTimeoutMs ?? 8000;
  const listeners = new Set<(s: PublicSession | null) => void>();

  let gis: GisOAuth2 | null = null;
  let client: GisTokenClient | null = null;
  const restored = restore();
  let session: Session | null = restored.session;
  /** Kept after the token expires (also across reloads) so a silent renewal can target the same account. */
  let lastEmail = restored.email;
  /** The request GIS will answer next (GIS has one callback per token client). */
  let waiting: { resolve: (r: GisTokenResponse) => void; reject: (e: Error) => void } | null = null;
  let silent: Promise<string> | null = null;

  function restore(): { session: Session | null; email?: string } {
    try {
      const raw = storage?.getItem(storageKey(deps.clientId));
      if (!raw) return { session: null };
      const s = JSON.parse(raw) as Partial<Session>;
      const valid = !!s.accessToken && typeof s.expiresAt === "number" && s.expiresAt - now() > EXPIRY_MARGIN_MS;
      return { session: valid ? (s as Session) : null, email: s.email };
    } catch {
      return { session: null };
    }
  }
  function persist() {
    try {
      // An expired session is kept as an account hint (email only, no token).
      if (session && session.expiresAt > 0) storage?.setItem(storageKey(deps.clientId), JSON.stringify(session));
      else if (lastEmail) storage?.setItem(storageKey(deps.clientId), JSON.stringify({ email: lastEmail }));
      else storage?.removeItem(storageKey(deps.clientId));
    } catch {
      /* storage blocked (private mode): memory only */
    }
  }
  const publicSession = (): PublicSession | null => (session ? { expiresAt: session.expiresAt, scopes: session.scopes, email: session.email } : null);
  const emit = () => {
    const s = publicSession();
    for (const l of listeners) l(s);
  };

  async function load() {
    if (client) return;
    gis = await deps.gis();
    client = gis.initTokenClient({
      client_id: deps.clientId,
      scope: deps.scopes.join(" "),
      callback: (r) => {
        const w = waiting;
        waiting = null;
        if (r.error || !r.access_token) w?.reject(new ReauthRequiredError(r.error_description || r.error || "Google didn't return a token"));
        else w?.resolve(r);
      },
      error_callback: (e) => {
        const w = waiting;
        waiting = null;
        // popup_closed / popup_failed_to_open / unknown
        w?.reject(new ReauthRequiredError(e.type === "popup_closed" ? "Sign-in was closed before it finished" : e.message || e.type));
      },
    });
  }

  /** Ask GIS for a token. Synchronous up to requestAccessToken so it stays inside a click's user activation. */
  function request(prompt: string | undefined): Promise<GisTokenResponse> {
    if (!client) return Promise.reject(new Error("Google sign-in is still loading. Try again in a moment."));
    const c = client;
    return new Promise<GisTokenResponse>((resolve, reject) => {
      waiting?.reject(new ReauthRequiredError("Superseded by a newer sign-in request"));
      waiting = { resolve, reject };
      const overrides: { prompt?: string; login_hint?: string } = {};
      if (prompt !== undefined) overrides.prompt = prompt;
      if (lastEmail) overrides.login_hint = lastEmail;
      c.requestAccessToken(overrides);
    });
  }

  async function accept(r: GisTokenResponse): Promise<Session> {
    const scopes = (r.scope ?? "").split(/\s+/).filter(Boolean);
    const next: Session = {
      accessToken: r.access_token!,
      expiresAt: now() + Number(r.expires_in ?? 3600) * 1000,
      scopes,
      email: lastEmail,
    };
    if (scopes.includes("email") || scopes.some((s) => s.endsWith("/userinfo.email"))) {
      try {
        const res = await doFetch(USERINFO_URL, { headers: { Authorization: `Bearer ${next.accessToken}` } });
        if (res.ok) next.email = ((await res.json()) as { email?: string }).email ?? next.email;
      } catch {
        /* "Signed in as" is cosmetic; keep going without it */
      }
    }
    // A different account than before: never carry the previous email over.
    if (lastEmail && next.email && next.email !== lastEmail) lastEmail = undefined;
    session = next;
    lastEmail = next.email;
    persist();
    emit();
    return next;
  }

  const api: GisAuth = {
    load,
    signIn() {
      return request(undefined).then(accept).then(() => publicSession()!);
    },
    async getAccessToken() {
      if (session && session.expiresAt - now() > EXPIRY_MARGIN_MS) return session.accessToken;
      if (!session && !lastEmail) throw new ReauthRequiredError("Not signed in");
      silent ??= (async () => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          await load();
          const timeout = new Promise<never>((_, reject) => {
            timer = setTimeout(() => {
              waiting = null; // a late GIS answer to this request is ignored
              reject(new ReauthRequiredError("Google sign-in needs a click to continue"));
            }, silentTimeoutMs);
          });
          return (await accept(await Promise.race([request(""), timeout]))).accessToken;
        } catch (err) {
          session = null;
          persist();
          emit();
          throw err instanceof ReauthRequiredError ? err : new ReauthRequiredError((err as Error).message);
        } finally {
          clearTimeout(timer);
          silent = null;
        }
      })();
      return silent;
    },
    async invalidateAccessToken() {
      if (session) {
        session = { ...session, expiresAt: 0 };
        persist();
      }
    },
    session: publicSession,
    hasScope: (scope) => !!session?.scopes.includes(scope),
    email: () => session?.email ?? lastEmail,
    async signOut() {
      const token = session?.accessToken;
      session = null;
      lastEmail = undefined;
      persist();
      emit();
      if (token && gis) await new Promise<void>((resolve) => gis!.revoke(token, () => resolve()));
    },
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return api;
}
