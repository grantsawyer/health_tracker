import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import "./platform.js"; // registers the server implementation of core/platform
import { APP_ORIGIN, CLIENT_ID_PATTERN, ENV_FILE, PORT, REDIRECT_URI, credentials, isConfigured, saveCredentials } from "./config.js";
import { AccountNotLinkedError, getIdentity } from "../core/healthClient.js";
import { HEALTH_SCOPES, REQUESTED_SCOPES, ReauthRequiredError, buildAuthUrl, fullScope, handleCallback, revoke } from "./oauth.js";
import { clearTokens, loadTokens } from "./tokenStore.js";
import { cacheClear } from "./cache.js";
import { dataRoutes } from "./dataRoutes.js";
import type { SetupInfo, StatusResponse } from "../shared/types.js";

/**
 * The HTTP app (routes + guards), separate from index.ts so tests can call
 * `app.request(...)` without binding a port or starting background timers.
 */
export const app = new Hono();

// ── Local-only guard ─────────────────────────────────────────────────────────
// The server binds to 127.0.0.1, but a web page in your browser could still try
// to reach it. Reject foreign Host headers (DNS rebinding) and cross-origin
// state-changing requests (CSRF).
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"]);
const allowedOrigins = new Set([APP_ORIGIN, APP_ORIGIN.replace("localhost", "127.0.0.1"), `http://localhost:${PORT}`, `http://127.0.0.1:${PORT}`]);

app.use("*", async (c, next) => {
  const host = (c.req.header("host") ?? "").replace(/:\d+$/, "");
  if (!LOCAL_HOSTS.has(host)) return c.text("Forbidden host", 403);

  if (c.req.method !== "GET" && c.req.method !== "HEAD") {
    const origin = c.req.header("origin");
    if (!origin || !allowedOrigins.has(origin)) return c.text("Forbidden origin", 403);
  }
  await next();
});

// ── Auth ─────────────────────────────────────────────────────────────────────
app.get("/auth/login", (c) => {
  if (!isConfigured()) return c.redirect(`${APP_ORIGIN}/?auth_error=not_configured`);
  return c.redirect(buildAuthUrl());
});

app.get("/auth/callback", async (c) => {
  const { code, state, error } = c.req.query();
  if (error) return c.redirect(`${APP_ORIGIN}/?auth_error=${encodeURIComponent(error)}`);
  if (!code || !state) return c.redirect(`${APP_ORIGIN}/?auth_error=missing_code`);
  try {
    await handleCallback(code, state);
    return c.redirect(`${APP_ORIGIN}/`);
  } catch (err) {
    console.error("[auth] callback failed:", err);
    return c.redirect(`${APP_ORIGIN}/?auth_error=${encodeURIComponent((err as Error).message)}`);
  }
});

app.post("/auth/logout", async (c) => {
  const tokens = loadTokens();
  if (tokens) await revoke(tokens.refreshToken);
  clearTokens();
  cacheClear();
  return c.json({ ok: true });
});

// ── Setup (in-app Google Cloud configuration) ────────────────────────────────
app.get("/api/setup", (c) =>
  c.json<SetupInfo>({
    configured: isConfigured(),
    clientIdHint: credentials.clientId ? `…${credentials.clientId.slice(-34)}` : undefined,
    redirectUri: REDIRECT_URI,
    javascriptOrigin: APP_ORIGIN,
    scopes: REQUESTED_SCOPES.filter((s) => s.startsWith("https://")),
    envFile: ENV_FILE,
  }),
);

app.post("/api/setup/credentials", async (c) => {
  const body = (await c.req.json().catch(() => null)) as { clientId?: unknown; clientSecret?: unknown } | null;
  const clientId = typeof body?.clientId === "string" ? body.clientId.trim() : "";
  const clientSecret = typeof body?.clientSecret === "string" ? body.clientSecret.trim() : "";
  if (!CLIENT_ID_PATTERN.test(clientId)) {
    return c.json({ error: "bad_request", message: "That doesn't look like a Client ID. It should end in .apps.googleusercontent.com" }, 400);
  }
  if (clientSecret.length < 10 || /\s/.test(clientSecret)) {
    return c.json({ error: "bad_request", message: "That doesn't look like a Client secret (it usually starts with GOCSPX-)." }, 400);
  }
  // Tokens from a different OAuth client won't refresh; start clean.
  if (clientId !== credentials.clientId) {
    clearTokens();
    cacheClear();
  }
  saveCredentials(clientId, clientSecret);
  console.log(`[setup] saved Google credentials to ${ENV_FILE}`);
  return c.json({ ok: true });
});

// ── API ──────────────────────────────────────────────────────────────────────
app.get("/api/status", async (c) => {
  if (!isConfigured()) {
    return c.json<StatusResponse>({
      state: "not_configured",
      message: "Google credentials haven't been set up yet.",
    });
  }
  const tokens = loadTokens();
  if (!tokens) return c.json<StatusResponse>({ state: "signed_out" });

  const granted = new Set(tokens.scope.split(" "));
  const base: StatusResponse = {
    state: "connected",
    email: tokens.email,
    scopes: HEALTH_SCOPES.map((s) => ({ ...s, granted: granted.has(fullScope(s.key)) })),
    refreshTokenExpiresAt: tokens.refreshTokenExpiresAt ? new Date(tokens.refreshTokenExpiresAt).toISOString() : undefined,
  };

  try {
    const identity = await getIdentity();
    return c.json<StatusResponse>({ ...base, healthUserId: identity.healthUserId });
  } catch (err) {
    if (err instanceof ReauthRequiredError) {
      clearTokens();
      return c.json<StatusResponse>({ state: "reauth_required", email: tokens.email, message: err.message });
    }
    if (err instanceof AccountNotLinkedError) {
      return c.json<StatusResponse>({ ...base, state: "account_not_linked", message: err.message });
    }
    console.error("[status]", err);
    return c.json<StatusResponse>({ ...base, state: "error", message: (err as Error).message });
  }
});

app.route("/api", dataRoutes);

app.all("/api/*", (c) => c.json({ error: "Not found" }, 404));

// ── Built frontend (production) ──────────────────────────────────────────────
if (process.env.NODE_ENV === "production") {
  app.use("/*", serveStatic({ root: "./dist" }));
  app.get("*", serveStatic({ path: "./dist/index.html" }));
}
