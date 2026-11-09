import { createHash, randomBytes } from "node:crypto";
import { REDIRECT_URI, credentials } from "./config.js";
import { loadTokens, saveTokens, type StoredTokens } from "./tokenStore.js";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";

export { HEALTH_SCOPES, REQUESTED_SCOPES, fullScope } from "../shared/scopes.js";
import { REQUESTED_SCOPES } from "../shared/scopes.js";

/** Refresh this long before actual expiry to avoid racing it. */
const EXPIRY_SKEW_MS = 60_000;

export { ReauthRequiredError } from "../core/errors.js";
import { ReauthRequiredError } from "../core/errors.js";

// ── PKCE + state ──────────────────────────────────────────────────────────────
// Single-user local app: pending logins are kept in memory, keyed by `state`.

const pending = new Map<string, { verifier: string; createdAt: number }>();
const PENDING_TTL_MS = 10 * 60_000;

const b64url = (buf: Buffer) => buf.toString("base64url");

export function buildAuthUrl(): string {
  const now = Date.now();
  for (const [k, v] of pending) if (now - v.createdAt > PENDING_TTL_MS) pending.delete(k);

  const state = b64url(randomBytes(24));
  const verifier = b64url(randomBytes(48));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  pending.set(state, { verifier, createdAt: now });

  const params = new URLSearchParams({
    client_id: credentials.clientId,
    redirect_uri: REDIRECT_URI,
    response_type: "code",
    scope: REQUESTED_SCOPES.join(" "),
    access_type: "offline",
    // Always re-show consent so Google issues a refresh token and the full scope set.
    prompt: "consent",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
    // Deliberately NOT setting include_granted_scopes: reported to cause token
    // problems for accounts that previously consented to legacy Google Fit scopes.
  });
  return `${AUTH_URL}?${params}`;
}

interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  refresh_token_expires_in?: number;
  scope: string;
  id_token?: string;
  token_type: string;
}

async function postToken(body: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: credentials.clientId, client_secret: credentials.clientSecret, ...body }),
  });
  const json = (await res.json().catch(() => ({}))) as Partial<TokenResponse> & { error?: string; error_description?: string };
  if (!res.ok) {
    if (json.error === "invalid_grant") throw new ReauthRequiredError(json.error_description);
    throw new Error(`Token endpoint ${res.status}: ${json.error ?? ""} ${json.error_description ?? ""}`.trim());
  }
  return json as TokenResponse;
}

/** Email from the id_token. It came straight from Google's token endpoint over TLS, so no signature check. */
function emailFromIdToken(idToken?: string): string | undefined {
  const payload = idToken?.split(".")[1];
  if (!payload) return undefined;
  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")).email;
  } catch {
    return undefined;
  }
}

export async function handleCallback(code: string, state: string): Promise<StoredTokens> {
  const entry = pending.get(state);
  pending.delete(state);
  if (!entry || Date.now() - entry.createdAt > PENDING_TTL_MS) {
    throw new Error("Sign-in link expired or was not started from this app. Try again.");
  }
  const t = await postToken({
    grant_type: "authorization_code",
    code,
    redirect_uri: REDIRECT_URI,
    code_verifier: entry.verifier,
  });
  if (!t.refresh_token) throw new Error("Google did not return a refresh token. Try signing in again.");
  const now = Date.now();
  const tokens: StoredTokens = {
    accessToken: t.access_token,
    accessTokenExpiresAt: now + t.expires_in * 1000,
    refreshToken: t.refresh_token,
    refreshTokenExpiresAt: t.refresh_token_expires_in ? now + t.refresh_token_expires_in * 1000 : undefined,
    scope: t.scope,
    email: emailFromIdToken(t.id_token),
  };
  saveTokens(tokens);
  return tokens;
}

let refreshInFlight: Promise<StoredTokens> | null = null;

/** A valid access token, refreshing on demand. Throws ReauthRequiredError if there's no usable session. */
export async function getAccessToken(): Promise<string> {
  const tokens = loadTokens();
  if (!tokens) throw new ReauthRequiredError("Not signed in");
  if (Date.now() < tokens.accessTokenExpiresAt - EXPIRY_SKEW_MS) return tokens.accessToken;

  // Coalesce concurrent refreshes (dashboards fire several requests at once).
  refreshInFlight ??= (async () => {
    try {
      const t = await postToken({ grant_type: "refresh_token", refresh_token: tokens.refreshToken });
      const now = Date.now();
      const next: StoredTokens = {
        ...tokens,
        accessToken: t.access_token,
        accessTokenExpiresAt: now + t.expires_in * 1000,
        // Google normally keeps the same refresh token, but honour a rotated one.
        refreshToken: t.refresh_token ?? tokens.refreshToken,
        refreshTokenExpiresAt: t.refresh_token_expires_in ? now + t.refresh_token_expires_in * 1000 : tokens.refreshTokenExpiresAt,
        scope: t.scope ?? tokens.scope,
      };
      saveTokens(next);
      return next;
    } finally {
      refreshInFlight = null;
    }
  })();
  return (await refreshInFlight).accessToken;
}

/** Best-effort revoke at Google; local tokens are cleared by the caller regardless. */
export async function revoke(refreshToken: string): Promise<void> {
  try {
    await fetch(REVOKE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: refreshToken }),
    });
  } catch (err) {
    console.warn("[oauth] revoke failed (ignored):", (err as Error).message);
  }
}
