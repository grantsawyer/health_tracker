import { statSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { app } from "../../server/app.js";
import { ENV_FILE } from "../../server/config.js";
import { clearTokens, loadTokens } from "../../server/tokenStore.js";
import { fakeFetch, json } from "../helpers/fakeGoogle.js";
import { nutritionLog, signIn } from "../helpers/fixtures.js";

const ORIGIN = "http://localhost:5173";
const get = (path: string, host = "localhost:8787") => app.request(path, { headers: { host } });
const post = (path: string, body: unknown, origin: string | null = ORIGIN) =>
  app.request(path, {
    method: "POST",
    headers: { host: "localhost:8787", "content-type": "application/json", ...(origin ? { origin } : {}) },
    body: JSON.stringify(body),
  });

describe("local-only guard", () => {
  it("rejects foreign Host headers (DNS rebinding)", async () => {
    const res = await get("/api/status", "evil.example:8787");
    expect(res.status).toBe(403);
    expect(await res.text()).toBe("Forbidden host");
  });
  it("accepts localhost and 127.0.0.1", async () => {
    expect((await get("/api/setup", "localhost:8787")).status).toBe(200);
    expect((await get("/api/setup", "127.0.0.1:5173")).status).toBe(200);
  });
  it.each([
    ["no Origin", null],
    ["a foreign Origin", "https://evil.example"],
    ["a lookalike Origin", "http://localhost.evil.example"],
  ])("rejects state-changing requests with %s (CSRF)", async (_label, origin) => {
    const res = await post("/auth/logout", {}, origin);
    expect(res.status).toBe(403);
  });
  it("allows same-origin state-changing requests", async () => {
    fakeFetch().on("POST", /oauth2\.googleapis\.com\/revoke$/, () => new Response(""));
    expect((await post("/auth/logout", {}, ORIGIN)).status).toBe(200);
    expect((await post("/auth/logout", {}, "http://127.0.0.1:8787")).status).toBe(200);
  });
});

describe("/api/status", () => {
  it("signed_out without tokens", async () => {
    clearTokens();
    expect(await (await get("/api/status")).json()).toEqual({ state: "signed_out" });
  });

  it("connected, with granted scopes and the health user id", async () => {
    signIn();
    fakeFetch().on("GET", /\/users\/me\/identity$/, () => json({ name: "users/me/identity", healthUserId: "42" }));
    const s = await (await get("/api/status")).json();
    expect(s).toMatchObject({ state: "connected", email: "tester@example.com", healthUserId: "42" });
    expect(s.scopes.every((x: { granted: boolean }) => x.granted)).toBe(true);
  });

  it("account_not_linked when Google says so", async () => {
    signIn();
    fakeFetch().on("GET", /\/identity$/, () => json({ error: { details: [{ reason: "ACCOUNT_NOT_LINKED" }] } }, 400));
    expect((await (await get("/api/status")).json()).state).toBe("account_not_linked");
  });

  it("reauth_required when the refresh token is rejected, and the dead tokens are cleared", async () => {
    signIn();
    fakeFetch()
      .on("GET", /\/identity$/, () => new Response("", { status: 401 }))
      .on("POST", /\/token$/, () => json({ error: "invalid_grant" }, 400));
    expect((await (await get("/api/status")).json()).state).toBe("reauth_required");
    expect(loadTokens()).toBeNull();
  });
});

describe("API error mapping", () => {
  it("400 for malformed delete names", async () => {
    signIn();
    const res = await post("/api/data/delete", { names: ["../../x"] });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("bad_request");
  });

  it("400 with a readable message for invalid food entries", async () => {
    signIn();
    const res = await post("/api/food/entries", { kind: "quick", displayName: "", kcal: 1, mealType: "LUNCH", timeLocal: "2026-11-07T12:00", utcOffsetSeconds: 0 });
    expect(res.status).toBe(400);
    expect((await res.json()).message).toMatch(/Name is required/);
  });

  it("403 not_editable when deleting another app's entry", async () => {
    signIn();
    fakeFetch().on("GET", /\/nutrition-log\/dataPoints\/5$/, () => json(nutritionLog({ id: "5", start: "2026-11-07T12:00:00Z", name: "Fitbit food", kcal: 1 })));
    const res = await post("/api/food/entries/delete", { id: "users/me/dataTypes/nutrition-log/dataPoints/5" });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("not_editable");
  });

  it("401 reauth_required for data requests without a session", async () => {
    clearTokens();
    const res = await get("/api/data/steps/rollup?start=2026-11-01&end=2026-11-08");
    expect(res.status).toBe(401);
  });

  it("404 for unknown API routes", async () => {
    expect((await get("/api/nope")).status).toBe(404);
  });
});

// Last: this replaces the module's credentials for the rest of the file.
describe("/api/setup/credentials", () => {
  it.each([
    [{ clientId: "not-a-client", clientSecret: "GOCSPX-test-abcdefghij" }, /Client ID/],
    [{ clientId: "123-abc.apps.googleusercontent.com", clientSecret: "short" }, /Client secret/],
    [{ clientId: "123-abc.apps.googleusercontent.com", clientSecret: "has spaces in it" }, /Client secret/],
  ])("rejects %j", async (body, msg) => {
    const res = await post("/api/setup/credentials", body);
    expect(res.status).toBe(400);
    expect((await res.json()).message).toMatch(msg);
  });

  it("saves to an owner-only .env and signs out when the client changes", async () => {
    signIn();
    const res = await post("/api/setup/credentials", { clientId: "999999999999-newclient.apps.googleusercontent.com", clientSecret: "GOCSPX-test-new-secret-1" });
    expect(res.status).toBe(200);
    expect(statSync(ENV_FILE).mode & 0o777).toBe(0o600);
    expect(readFileSync(ENV_FILE, "utf8")).toContain("GOOGLE_CLIENT_ID=999999999999-newclient.apps.googleusercontent.com");
    expect(loadTokens()).toBeNull();
    expect((await (await get("/api/setup")).json()).clientIdHint).toContain("client.apps.googleusercontent.com");
  });
});

describe("settings and queue routes return real values", () => {
  // Regression: these routes once returned a Promise, which serialized as {} instead of the value.
  it("favorite delete and pending discard report ok: true/false", async () => {
    const fav = await (await post("/api/food/favorites", { kind: "quick", displayName: "Soup", kcal: 120 })).json();
    expect(await (await post("/api/food/favorites/delete", { id: fav.id })).json()).toEqual({ ok: true });
    expect(await (await post("/api/food/favorites/delete", { id: fav.id })).json()).toEqual({ ok: false });
    expect(await (await post("/api/food/pending/discard", { id: "no-such-row" })).json()).toEqual({ ok: false });
  });

  it("retry returns the remaining queue as a list", async () => {
    const body = await (await post("/api/food/pending/retry", {})).json();
    expect(body).toEqual({ sent: 0, remaining: 0, pending: [] });
  });
});

describe("/api/setup", () => {
  it("says it's the server backend and gives the redirect URI", async () => {
    const info = await (await get("/api/setup")).json();
    expect(info).toMatchObject({ mode: "server", redirectUri: "http://localhost:8787/auth/callback" });
  });
});
