import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vitest";
import { ReauthRequiredError } from "../../core/errors.js";
import { configurePlatform } from "../../core/platform.js";
import { createEntry, listPendingWrites, processPendingWrites } from "../../core/food.js";
import { getGoals, updateGoals } from "../../core/goals.js";
import { buildSummary } from "../../core/summary.js";
import { createGisAuth, type GisAuth } from "../../platform/auth.js";
import { browserScopes, createBrowserPlatform, startRetryLoop } from "../../platform/browserPlatform.js";
import { createIdbCache } from "../../platform/cache.js";
import { DRIVE_APPDATA_SCOPE, createDriveAppData } from "../../platform/drive.js";
import { openDb } from "../../platform/idb.js";
import { backoffMs, createIdbPending } from "../../platform/queue.js";
import { createSyncedSettings } from "../../platform/settings.js";
import { fullScope, HEALTH_SCOPES } from "../../shared/scopes.js";
import { done, fakeFetch, json } from "../helpers/fakeGoogle.js";
import { fakeDrive, fakeGis, memoryStorage, tokenAnswer, type GisAnswer } from "../helpers/fakeBrowser.js";
import { ALL_SCOPES, rollupDay } from "../helpers/fixtures.js";

const CLIENT_ID = "123456789012-testclientid.apps.googleusercontent.com";
const EMAIL_A = "person.a@example.com";
const EMAIL_B = "person.b@example.com";
const USERINFO = /^https:\/\/www\.googleapis\.com\/oauth2\/v3\/userinfo$/;

let clock: number;
const now = () => clock;
const freshDb = () => openDb(new IDBFactory());
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
async function until(cond: () => boolean | Promise<boolean>, what: string) {
  for (let i = 0; i < 200; i++) {
    if (await cond()) return;
    await tick(5);
  }
  throw new Error(`timed out waiting for ${what}`);
}

beforeEach(() => {
  clock = Date.UTC(2026, 10, 7, 12, 0, 0);
});

// ── Purity ───────────────────────────────────────────────────────────────────
describe("platform/ is browser code", () => {
  it("imports nothing from server/ or Node built-ins and never reads process.env", () => {
    const dir = join(import.meta.dirname, "../../platform");
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".ts"))) {
      const src = readFileSync(join(dir, f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      const specs = [...src.matchAll(/\bfrom\s*["']([^"']+)["']|\bimport\(\s*["']([^"']+)["']\s*\)/g)].map((m) => m[1] ?? m[2]!);
      for (const spec of specs) {
        expect(spec, `${f} imports ${spec}`).not.toMatch(/^(node:|\.\.\/server\/)/);
        expect(spec, `${f} imports ${spec}`).toMatch(/^\.{1,2}\//);
      }
      expect(src, `${f} reads process.env`).not.toMatch(/process\.env/);
    }
  });
});

// ── Sign-in ──────────────────────────────────────────────────────────────────
describe("GIS sign-in", () => {
  const scopes = browserScopes();
  const granted = [...scopes];

  function setup(answer: (req: { prompt?: string; login_hint?: string }) => GisAnswer, storage = memoryStorage()) {
    const gis = fakeGis(answer);
    const auth = createGisAuth({ clientId: CLIENT_ID, scopes, gis: async () => gis.oauth2, storage, now, silentTimeoutMs: 30 });
    return { gis, auth, storage };
  }

  it("throws ReauthRequiredError before anyone has signed in, without opening a pop-up", async () => {
    const { auth, gis } = setup(() => tokenAnswer(granted));
    await auth.load();
    await expect(auth.getAccessToken()).rejects.toBeInstanceOf(ReauthRequiredError);
    expect(gis.requests).toEqual([]);
  });

  it("refuses to sign in until GIS has loaded (a later await would lose the click's pop-up permission)", async () => {
    const { auth } = setup(() => tokenAnswer(granted));
    await expect(auth.signIn()).rejects.toThrow(/still loading/);
  });

  it("signs in from a click: requests synchronously, records granted scopes and the email", async () => {
    fakeFetch().on("GET", USERINFO, (req) => {
      expect(req.headers.authorization).toMatch(/^Bearer ya29\.synthetic-/);
      return json({ email: EMAIL_A, email_verified: true });
    });
    const { auth, gis } = setup(() => tokenAnswer(granted));
    await auth.load();
    const pending = auth.signIn();
    expect(gis.requests).toHaveLength(1); // still inside the click handler
    expect(gis.requests[0]!.prompt).toBeUndefined(); // GIS decides: account chooser + consent the first time
    const s = await pending;
    expect(s.email).toBe(EMAIL_A);
    expect(auth.hasScope(DRIVE_APPDATA_SCOPE)).toBe(true);
    expect(auth.hasScope(fullScope("nutrition.writeonly"))).toBe(true);
    expect(await auth.getAccessToken()).toMatch(/^ya29\.synthetic-/);
  });

  it("reports a partial grant so features can show as unavailable", async () => {
    fakeFetch().on("GET", USERINFO, () => json({ email: EMAIL_A }));
    const partial = ["openid", "email", fullScope("sleep.readonly")];
    const { auth } = setup(() => tokenAnswer(partial));
    await auth.load();
    await auth.signIn();
    expect(auth.hasScope(fullScope("sleep.readonly"))).toBe(true);
    expect(auth.hasScope(fullScope("nutrition.writeonly"))).toBe(false);
    expect(auth.hasScope(DRIVE_APPDATA_SCOPE)).toBe(false);
  });

  it("rejects when the user declines consent", async () => {
    const { auth } = setup(() => ({ token: { error: "access_denied", error_description: "The user denied access" } }));
    await auth.load();
    await expect(auth.signIn()).rejects.toThrow(/denied/);
    expect(auth.session()).toBeNull();
  });

  it("reuses the token until a minute before expiry, then renews silently for the same account", async () => {
    fakeFetch().on("GET", USERINFO, () => json({ email: EMAIL_A }));
    const { auth, gis } = setup(() => tokenAnswer(granted));
    await auth.load();
    await auth.signIn();
    const first = await auth.getAccessToken();
    clock += 58 * 60_000;
    expect(await auth.getAccessToken()).toBe(first);
    expect(gis.requests).toHaveLength(1);
    clock += 60_000; // 59 min: under a minute left
    const second = await auth.getAccessToken();
    expect(second).not.toBe(first);
    expect(gis.requests[1]).toEqual({ prompt: "", login_hint: EMAIL_A });
  });

  it("shares one silent renewal between concurrent callers", async () => {
    fakeFetch().on("GET", USERINFO, () => json({ email: EMAIL_A }));
    const { auth, gis } = setup(() => tokenAnswer(granted));
    await auth.load();
    await auth.signIn();
    await auth.invalidateAccessToken(); // what core does after a 401
    const [a, b, c] = await Promise.all([auth.getAccessToken(), auth.getAccessToken(), auth.getAccessToken()]);
    expect(new Set([a, b, c]).size).toBe(1);
    expect(gis.requests).toHaveLength(2);
  });

  it("turns a blocked or hanging silent renewal into ReauthRequiredError but keeps the account hint", async () => {
    fakeFetch().on("GET", USERINFO, () => json({ email: EMAIL_A }));
    let next: GisAnswer = tokenAnswer(granted);
    const { auth } = setup(() => next);
    await auth.load();
    await auth.signIn();

    next = { error: "popup_failed_to_open" };
    clock += 60 * 60_000;
    await expect(auth.getAccessToken()).rejects.toBeInstanceOf(ReauthRequiredError);
    expect(auth.session()).toBeNull();
    expect(auth.email()).toBe(EMAIL_A);

    next = "hang";
    await expect(auth.getAccessToken()).rejects.toThrow(/needs a click/);
  });

  it("survives a reload within the hour via sessionStorage, and only keeps the email after expiry", async () => {
    fakeFetch().on("GET", USERINFO, () => json({ email: EMAIL_A }));
    const storage = memoryStorage();
    const first = setup(() => tokenAnswer(granted), storage);
    await first.auth.load();
    await first.auth.signIn();
    const token = await first.auth.getAccessToken();
    expect([...storage.map.keys()]).toEqual([`health-tracker:session:${CLIENT_ID}`]);

    const reloaded = setup(() => tokenAnswer(granted), storage);
    expect(await reloaded.auth.getAccessToken()).toBe(token); // no GIS needed
    expect(reloaded.gis.inits()).toBe(0);

    clock += 2 * 60 * 60_000;
    const later = setup(() => tokenAnswer(granted), storage);
    expect(later.auth.session()).toBeNull();
    expect(later.auth.email()).toBe(EMAIL_A);
    await later.auth.getAccessToken(); // silent renewal with the remembered account
    expect(later.gis.requests[0]).toEqual({ prompt: "", login_hint: EMAIL_A });
  });

  it("signs out: revokes the token and forgets the session and account hint", async () => {
    fakeFetch().on("GET", USERINFO, () => json({ email: EMAIL_A }));
    const { auth, gis, storage } = setup(() => tokenAnswer(granted));
    await auth.load();
    await auth.signIn();
    const token = await auth.getAccessToken();
    const seen: unknown[] = [];
    auth.onChange((s) => seen.push(s));
    await auth.signOut();
    expect(gis.revoked).toEqual([token]);
    expect(storage.map.size).toBe(0);
    expect(auth.email()).toBeUndefined();
    expect(seen).toEqual([null]);
    await expect(auth.getAccessToken()).rejects.toBeInstanceOf(ReauthRequiredError);
  });

  it("asks for every Google Health scope plus openid, email and Drive app data", () => {
    expect(browserScopes()).toEqual(["openid", "email", ...HEALTH_SCOPES.map((s) => fullScope(s.key)), DRIVE_APPDATA_SCOPE]);
    expect(browserScopes(false)).not.toContain(DRIVE_APPDATA_SCOPE);
  });
});

// ── IndexedDB cache ──────────────────────────────────────────────────────────
describe("IndexedDB cache", () => {
  it("honors TTL, invalidates one type, and keeps users apart", async () => {
    const db = await freshDb();
    let user = EMAIL_A;
    const cache = createIdbCache(db, () => user, now);
    await cache.put("rollup:steps:2026-11-01", "steps", { days: [1, 2] }, 5 * 60_000);
    await cache.put("rollup:sleep:2026-11-01", "sleep", { nights: 3 }, 24 * 60 * 60_000);
    expect(await cache.get("rollup:steps:2026-11-01")).toEqual({ value: { days: [1, 2] }, fetchedAt: clock });

    user = EMAIL_B;
    expect(await cache.get("rollup:steps:2026-11-01")).toBeNull();
    await cache.put("rollup:steps:2026-11-01", "steps", { days: [9] }, 5 * 60_000);
    await cache.invalidateType("steps"); // B's steps only
    user = EMAIL_A;
    expect(await cache.get("rollup:steps:2026-11-01")).not.toBeNull();

    await cache.invalidateType("steps");
    expect(await cache.get("rollup:steps:2026-11-01")).toBeNull();
    expect(await cache.get("rollup:sleep:2026-11-01")).not.toBeNull();

    clock += 25 * 60 * 60_000;
    expect(await cache.get("rollup:sleep:2026-11-01")).toBeNull();
    expect(await cache.pruneExpired()).toBe(1);
  });

  it("clear() only removes the signed-in user's entries", async () => {
    const db = await freshDb();
    let user = EMAIL_A;
    const cache = createIdbCache(db, () => user, now);
    await cache.put("k", "steps", 1, 60_000);
    user = EMAIL_B;
    await cache.put("k", "steps", 2, 60_000);
    await cache.clear();
    expect(await cache.get("k")).toBeNull();
    user = EMAIL_A;
    expect((await cache.get<number>("k"))?.value).toBe(1);
  });
});

// ── IndexedDB retry queue ────────────────────────────────────────────────────
describe("IndexedDB retry queue", () => {
  it("matches the server's rules: first retry after a minute, backoff 1→60 min, permanent failures stop", async () => {
    const db = await freshDb();
    const q = createIdbPending(db, () => EMAIL_A, now);
    const id = await q.enqueue({ displayName: "Soup" }, "2026-11-07T12:00:00.123Z", "Soup", "Google returned 503");
    expect(await q.due()).toEqual([]);
    clock += 60_000;
    const [row] = await q.due<{ displayName: string }>();
    expect(row).toMatchObject({ id, entry: { displayName: "Soup" }, attempts: 1, failed: false, startTime: "2026-11-07T12:00:00.123Z" });
    expect(row).not.toHaveProperty("user");

    await q.markAttempt(id, "503 again", false, 2);
    expect((await q.list<unknown>())[0]!.nextAttemptAt).toBe(clock + 2 * 60_000);
    expect([1, 2, 3, 7, 8, 20].map(backoffMs)).toEqual([1, 2, 4, 60, 60, 60].map((m) => m * 60_000));

    await q.markAttempt(id, "400 bad request", true, 3);
    clock += 24 * 60 * 60_000;
    expect(await q.due()).toEqual([]);
    await q.makeDueNow(false);
    expect(await q.due()).toEqual([]); // failed rows stay failed
    await q.makeDueNow(true);
    expect(await q.due()).toHaveLength(1);
  });

  it("returns due rows oldest first, at most 20, and only the signed-in user's", async () => {
    const db = await freshDb();
    let user = EMAIL_A;
    const q = createIdbPending(db, () => user, now);
    for (let i = 0; i < 22; i++) {
      clock += 1;
      await q.enqueue({ n: i }, `t${i}`, `entry ${i}`, "offline");
    }
    user = EMAIL_B;
    await q.enqueue({ n: 99 }, "tb", "other account", "offline");
    clock += 10 * 60_000;
    expect((await q.due()).map((r) => r.label)).toEqual(["other account"]);
    user = EMAIL_A;
    const due = await q.due<{ n: number }>();
    expect(due).toHaveLength(20);
    expect(due.map((r) => r.entry.n)).toEqual([...Array(20).keys()]);
  });

  it("scoped remove can't delete another user's row; the retry loop's unscoped remove can", async () => {
    const db = await freshDb();
    let user = EMAIL_A;
    const q = createIdbPending(db, () => user, now);
    const id = await q.enqueue({}, "t", "A's entry", "offline");
    user = EMAIL_B;
    expect(await q.remove(id, true)).toBe(false);
    expect(await q.remove(id, false)).toBe(true);
    user = EMAIL_A;
    expect(await q.list()).toEqual([]);
  });
});

// ── Drive-synced settings ────────────────────────────────────────────────────
describe("settings synced to Drive appData", () => {
  async function setup(opts: { drive?: boolean; user?: () => string } = {}) {
    const db = await freshDb();
    const drive = fakeDrive();
    const tokens = { invalidated: 0 };
    const client = createDriveAppData({
      getAccessToken: async () => "ya29.synthetic-drive",
      invalidateAccessToken: async () => void tokens.invalidated++,
    });
    const settings = createSyncedSettings({ db, userKey: opts.user ?? (() => EMAIL_A), drive: opts.drive === false ? null : client, now, autoSyncMs: 0 });
    return { db, drive, settings, tokens };
  }

  it("local-only mode never touches the network", async () => {
    fakeFetch(); // any request would throw
    const { settings } = await setup({ drive: false });
    await settings.put("goals", { steps: 9000 });
    expect(await settings.get("goals")).toEqual({ steps: 9000 });
    expect(await settings.sync()).toEqual({ state: "local", reason: "Settings sync is off" });
  });

  it("first sync creates one hidden settings.json in appDataFolder", async () => {
    const { drive, settings } = await setup();
    const f = drive.install(fakeFetch());
    await settings.put("goals", { steps: 9000 });
    await settings.put("layout", { today: ["stepsRing"] });
    expect(await settings.unsyncedKeys()).toEqual(["goals", "layout"]);
    expect(await settings.sync()).toMatchObject({ state: "synced", pulled: 0, pushed: 2 });
    const create = f.to(/\/upload\/drive\/v3\/files$/, "POST")[0]!;
    expect(create.url.searchParams.get("uploadType")).toBe("multipart");
    expect(create.headers.authorization).toBe("Bearer ya29.synthetic-drive");
    expect([...drive.files.values()][0]).toMatchObject({ name: "settings.json", parents: ["appDataFolder"] });
    expect(drive.doc()!.entries.goals).toEqual({ value: { steps: 9000 }, updatedAt: clock });
    expect(await settings.unsyncedKeys()).toEqual([]);

    // Nothing changed: the next sync reads but doesn't upload.
    expect(await settings.sync()).toMatchObject({ state: "synced", pulled: 0, pushed: 0 });
    expect(f.to(/\/upload\//)).toHaveLength(1);
  });

  it("merges key by key: newer Drive values come down, newer local values go up", async () => {
    const { drive, settings } = await setup();
    drive.seed({
      format: "health-tracker-settings",
      version: 1,
      entries: {
        goals: { value: { steps: 11000 }, updatedAt: clock + 5_000 }, // changed on another device, later
        layout: { value: { today: ["sleep"] }, updatedAt: clock - 5_000 }, // older than ours
        favorites: { value: [{ id: "f1" }], updatedAt: clock - 9_000 }, // only on Drive
      },
    });
    const f = drive.install(fakeFetch());
    await settings.put("goals", { steps: 9000 });
    await settings.put("layout", { today: ["stepsRing"] });
    expect(await settings.sync()).toMatchObject({ state: "synced", pulled: 2, pushed: 1 });
    expect(await settings.get("goals")).toEqual({ steps: 11000 });
    expect(await settings.get("favorites")).toEqual([{ id: "f1" }]);
    expect(await settings.get("layout")).toEqual({ today: ["stepsRing"] });
    expect(f.to(/\/upload\/drive\/v3\/files\/file\d+$/, "PATCH")).toHaveLength(1);
    expect(drive.doc()!.entries.layout!.value).toEqual({ today: ["stepsRing"] });
    expect(drive.doc()!.entries.goals!.value).toEqual({ steps: 11000 });
  });

  it("keeps working locally when Drive is declined, then uploads once it's allowed", async () => {
    const { drive, settings } = await setup();
    drive.install(fakeFetch());
    drive.setMode("noScope");
    await settings.put("goals", { steps: 7000 });
    expect(await settings.sync()).toMatchObject({ state: "unavailable" });
    expect(await settings.get("goals")).toEqual({ steps: 7000 });
    expect(await settings.unsyncedKeys()).toEqual(["goals"]);

    drive.setMode("down");
    expect(await settings.sync()).toMatchObject({ state: "error" });

    drive.setMode("ok");
    expect(await settings.sync()).toMatchObject({ state: "synced", pushed: 1 });
    expect(drive.doc()!.entries.goals!.value).toEqual({ steps: 7000 });
  });

  it("retries once with a fresh token after a 401", async () => {
    const { drive, settings, tokens } = await setup();
    const f = fakeFetch().on("GET", /\/drive\/v3\/files$/, () => json({ error: { code: 401, message: "Invalid Credentials" } }, 401), 1);
    drive.install(f);
    await settings.put("goals", { steps: 7000 });
    expect(await settings.sync()).toMatchObject({ state: "synced" });
    expect(tokens.invalidated).toBe(1);
  });

  it("keeps each account's settings apart in the same browser", async () => {
    let user = EMAIL_A;
    const { settings } = await setup({ drive: false, user: () => user });
    await settings.put("goals", { steps: 12000 });
    user = EMAIL_B;
    expect(await settings.get("goals")).toBeUndefined();
    expect(await settings.exportAll()).toEqual({});
  });

  it("exports and imports every setting; imported values win the next sync", async () => {
    const { drive, settings } = await setup();
    drive.seed({ format: "health-tracker-settings", version: 1, entries: { goals: { value: { steps: 5000 }, updatedAt: clock - 1 } } });
    drive.install(fakeFetch());
    await settings.importAll({ goals: { steps: 10000 }, layout: { today: [] } });
    expect(await settings.exportAll()).toEqual({ goals: { steps: 10000 }, layout: { today: [] } });
    await settings.sync();
    expect(drive.doc()!.entries.goals!.value).toEqual({ steps: 10000 });
  });

  it("syncs automatically shortly after a change", async () => {
    const db = await freshDb();
    const drive = fakeDrive();
    drive.install(fakeFetch());
    const settings = createSyncedSettings({
      db, userKey: () => EMAIL_A, now, autoSyncMs: 5,
      drive: createDriveAppData({ getAccessToken: async () => "ya29.synthetic", invalidateAccessToken: async () => {} }),
    });
    await settings.put("goals", { steps: 8000 });
    await until(() => settings.status().state === "synced", "automatic sync");
    expect(drive.doc()!.entries.goals!.value).toEqual({ steps: 8000 });
  });
});

// ── The composed browser platform running core/ ──────────────────────────────
describe("core/ on the browser platform", () => {
  async function signedIn(granted: string[] = [...ALL_SCOPES, DRIVE_APPDATA_SCOPE]) {
    const db = await freshDb();
    const gis = fakeGis(() => tokenAnswer(granted));
    const auth: GisAuth = createGisAuth({ clientId: CLIENT_ID, scopes: browserScopes(), gis: async () => gis.oauth2, storage: memoryStorage(), now });
    const bp = createBrowserPlatform({ clientId: CLIENT_ID, auth, db, version: "0.2.0", now, autoSyncMs: 0, log: { info() {}, warn() {} } });
    configurePlatform(bp.platform);
    fakeFetch().on("GET", USERINFO, () => json({ email: EMAIL_A }));
    await auth.load();
    await auth.signIn();
    return { bp, auth, gis, db };
  }

  it("stores records under the signed-in email and identifies itself to Open Food Facts without contact details", async () => {
    const { bp } = await signedIn();
    expect(bp.userKey()).toBe(EMAIL_A);
    expect(bp.platform.offUserAgent).toBe("HealthTracker/0.2.0");
    expect(bp.platform.clientId()).toBe(CLIENT_ID);
  });

  it("queues a failed food write in IndexedDB and sends it on retry with the GIS token", async () => {
    await signedIn();
    fakeFetch().on("POST", /\/nutrition-log\/dataPoints$/, () => json({ error: { message: "down" } }, 503));
    const r = await createEntry({ kind: "quick", displayName: "Soup", kcal: 120, mealType: "LUNCH", timeLocal: "2026-11-07T12:00", utcOffsetSeconds: 0 });
    expect(r.status).toBe("queued");
    expect(await listPendingWrites()).toHaveLength(1);

    clock += 60_000;
    const g = fakeFetch()
      .on("GET", /\/nutrition-log\/dataPoints$/, () => json({ dataPoints: [] }))
      .on("POST", /\/nutrition-log\/dataPoints$/, () => done({ name: "users/1/dataTypes/nutrition-log/dataPoints/9" }));
    expect((await processPendingWrites()).sent).toBe(1);
    expect(g.to(/\/nutrition-log\/dataPoints$/, "POST")[0]!.headers.authorization).toMatch(/^Bearer ya29\.synthetic-/);
    expect(await listPendingWrites()).toEqual([]);
  });

  it("serves a repeated summary from the IndexedDB cache", async () => {
    await signedIn();
    const g = fakeFetch()
      .on("POST", /\/steps\/dataPoints:dailyRollUp$/, () => json({ rollupDataPoints: [rollupDay("2026-11-06", "steps", { countSum: "4321" })] }))
      .on("POST", /:dailyRollUp$/, () => json({ rollupDataPoints: [] }))
      .on("GET", /\/dataPoints$/, () => json({ dataPoints: [] }));
    const s = await buildSummary("2026-11-06", "2026-11-07", false, new Set(ALL_SCOPES));
    expect(s.days[0]!.steps).toBe(4321);
    const calls = g.calls.length;
    await buildSummary("2026-11-06", "2026-11-07", false, new Set(ALL_SCOPES));
    expect(g.calls.length).toBe(calls);
  });

  it("goals saved through core reach Drive after sign-in sync", async () => {
    const { bp } = await signedIn();
    const drive = fakeDrive();
    drive.install(fakeFetch());
    await updateGoals({ steps: 12000 });
    await bp.afterSignIn();
    expect(drive.doc()!.entries.goals!.value).toMatchObject({ steps: 12000 });
    expect((await getGoals()).steps).toBe(12000);
  });

  it("reports settings sync as unavailable without calling Drive when the scope wasn't granted", async () => {
    const { bp } = await signedIn([...ALL_SCOPES]);
    fakeFetch(); // a Drive call would throw
    await updateGoals({ steps: 6000 });
    await bp.afterSignIn();
    expect(bp.settings.status()).toMatchObject({ state: "unavailable" });
    expect((await getGoals()).steps).toBe(6000);
  });

  /** The signed-in user's rows, read directly (after sign-out the platform resolves records to "local"). */
  const rowsFor = (db: IDBDatabase, user: string) => ({
    cache: createIdbCache(db, () => user, now),
    pending: createIdbPending(db, () => user, now),
    settings: createSyncedSettings({ db, userKey: () => user, drive: null, autoSyncMs: 0 }),
  });

  it("sign-out revokes the token and clears cached health data, but keeps queued entries and settings", async () => {
    const { bp, gis, db } = await signedIn();
    await bp.platform.cache.put("k", "steps", 1, 60_000);
    await bp.platform.pending.enqueue({}, "t", "Soup", "offline");
    await bp.platform.settings.put("goals", { steps: 1 });
    await bp.signOut();
    expect(gis.revoked).toHaveLength(1);
    expect(bp.userKey()).toBe("local");
    const a = rowsFor(db, EMAIL_A);
    expect(await a.cache.get("k")).toBeNull();
    expect(await a.pending.list()).toHaveLength(1); // still sent after the next sign-in
    expect(await a.settings.get("goals")).toEqual({ steps: 1 });
  });

  it("forgetting the device also removes the user's queue and local settings copy", async () => {
    const { bp, db } = await signedIn();
    await bp.platform.pending.enqueue({}, "t", "Soup", "offline");
    await bp.platform.settings.put("goals", { steps: 1 });
    const other = rowsFor(db, EMAIL_B);
    await other.pending.enqueue({}, "t", "B's soup", "offline");
    await bp.signOut({ forgetDevice: true });
    const a = rowsFor(db, EMAIL_A);
    expect(await a.pending.list()).toEqual([]);
    expect(await a.settings.get("goals")).toBeUndefined();
    expect(await other.pending.list()).toHaveLength(1); // other accounts untouched
  });

  it("the retry loop runs at start and when the browser comes back online, never overlapping", async () => {
    let runs = 0;
    let release!: () => void;
    const events = new EventTarget();
    const stop = startRetryLoop(
      () => {
        runs++;
        return new Promise<void>((r) => (release = r));
      },
      { intervalMs: 60_000, events },
    );
    expect(runs).toBe(1);
    events.dispatchEvent(new Event("online"));
    expect(runs).toBe(1); // still running: no second pass
    release();
    await tick();
    events.dispatchEvent(new Event("online"));
    expect(runs).toBe(2);
    stop();
    release();
    await tick();
    events.dispatchEvent(new Event("online"));
    expect(runs).toBe(2);
  });

  it("the retry loop swallows not-signed-in errors and reports them", async () => {
    const errors: unknown[] = [];
    const stop = startRetryLoop(async () => { throw new ReauthRequiredError(); }, { events: new EventTarget(), onError: (e) => errors.push(e) });
    await tick();
    stop();
    expect(errors[0]).toBeInstanceOf(ReauthRequiredError);
  });
});
