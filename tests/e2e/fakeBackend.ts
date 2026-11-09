import type { Page, Route } from "@playwright/test";
import type { FoodLogEntry, LibraryFood, OffProduct } from "../../shared/food";

/**
 * In-browser fakes for everything the serverless app talks to: Google's
 * sign-in script (GIS), userinfo, the Google Health API, the Drive
 * appDataFolder, and Open Food Facts. A little state (nutrition-log points,
 * the Drive settings file) makes the flows real: what the app writes, it reads
 * back. Every request is recorded; anything unexpected fails the test.
 *
 * All values are synthetic.
 */

export const CLIENT_ID = "123456789012-e2etestclient.apps.googleusercontent.com";
export const EMAIL = "tester@example.com";
export const today = () => new Date().toLocaleDateString("en-CA");
const HEALTH_SCOPES = ["activity_and_fitness.readonly", "sleep.readonly", "nutrition.readonly", "nutrition.writeonly", "health_metrics_and_measurements.readonly", "profile.readonly"]
  .map((s) => `https://www.googleapis.com/auth/googlehealth.${s}`);
export const ALL_SCOPES = ["openid", "email", ...HEALTH_SCOPES, "https://www.googleapis.com/auth/drive.appdata"];

const OZ = "users/me/dataTypes/food-measurement-unit/dataPoints/226";
const GRAM = "users/me/dataTypes/food-measurement-unit/dataPoints/147";

export const RICE: LibraryFood = {
  name: "users/me/dataTypes/food/dataPoints/42",
  displayName: "Rice",
  defaultServing: { unit: OZ, label: "oz", amount: 1 },
  servings: [{ unit: GRAM, label: "gram", plural: "grams", multiplier: 0.0352739619 }, { unit: OZ, label: "oz", plural: "oz", multiplier: 1 }],
  kcal: 40, proteinG: 1, carbsG: 9, fatG: 0,
};
const ricePoint = (access: "PRIVATE" | "PUBLIC" = "PRIVATE", id = "42", name = "Rice") => ({
  name: `users/1234567890/dataTypes/food/dataPoints/${id}`,
  food: {
    displayName: name,
    accessLevel: `FOOD_ACCESS_LEVEL_${access}`,
    energyAvg: { kcal: 40 },
    nutrients: [{ nutrient: "PROTEIN", quantity: { grams: 1 } }],
    totalCarbohydrate: { grams: 9 },
    totalFat: { grams: 0 },
    defaultServing: { amount: 1, foodMeasurementUnit: OZ, foodMeasurementUnitDisplayName: "oz", foodMeasurementUnitDisplayNamePlural: "oz", multiplier: 1 },
    servings: [
      { amount: 1, foodMeasurementUnit: GRAM, foodMeasurementUnitDisplayName: "gram", foodMeasurementUnitDisplayNamePlural: "grams", multiplier: 0.0352739619 },
      { amount: 1, foodMeasurementUnit: OZ, foodMeasurementUnitDisplayName: "oz", foodMeasurementUnitDisplayNamePlural: "oz", multiplier: 1 },
    ],
  },
});

/** The product as Open Food Facts returns it (normalized by core into an OffProduct). */
export const YOGURT: OffProduct = {
  code: "0894700010137", name: "Greek Yogurt", brand: "Chobani", servingSize: "1 serving (150 g)", servingGrams: 150,
  per100g: { kcal: 73, proteinG: 8, carbsG: 10.7, fatG: 0 },
  perServing: { kcal: 110, proteinG: 12, carbsG: 16, fatG: 0 },
};
const yogurtRaw = (withServing: boolean) => ({
  code: YOGURT.code, product_name: YOGURT.name, brands: YOGURT.brand,
  ...(withServing ? { serving_size: YOGURT.servingSize, serving_quantity: YOGURT.servingGrams } : {}),
  nutriments: {
    "energy-kcal_100g": 73, proteins_100g: 8, carbohydrates_100g: 10.7, fat_100g: 0,
    ...(withServing ? { "energy-kcal_serving": 110, proteins_serving: 12, carbohydrates_serving: 16, fat_serving: 0 } : {}),
  },
});

const DEFAULT_GOALS = { steps: 10000, activeZoneMinutes: 22, floors: 10, caloriesBurned: 2000, caloriesEaten: 2000, carbsG: 275, fatG: 78, proteinG: 50, exerciseDaysPerWeek: 5, sleepMinutes: null };
const DEFAULT_LAYOUT = { today: ["heartRate", "sleep", "caloriesEaten"], week: ["steps", "sleep"] };

/** A seed entry, in the UI's terms; stored as a Google nutrition-log data point. */
export type SeedEntry = Pick<FoodLogEntry, "id" | "timeLocal" | "mealType" | "displayName" | "kcal" | "proteinG" | "carbsG" | "fatG" | "editable">;

export interface FakeOptions {
  goals?: Record<string, number | null>;
  layout?: { today: string[]; week: string[] };
  favorites?: { id: string; label: string; template: unknown; createdAt: number }[];
  entries?: SeedEntry[];
  /** Start signed in (default), signed out (client ID saved, no session), or with no client ID at all. */
  start?: "signedIn" | "signedOut" | "notConfigured";
  /** Scopes the user grants on the fake consent screens (each token gets only what it asked for). */
  scopes?: string[];
  /** Synthetic main sleep for each of the last N nights (stage timelines that vary night to night). */
  sleepNights?: number;
  /** With start "signedIn": whether this tab already connected Drive (default: yes, if drive.appdata is granted). */
  driveConnected?: boolean;
}

export interface FakeRequest {
  method: string;
  url: URL;
  body: any;
}

type Point = Record<string, any> & { name: string };

const offsetSecs = (timeLocal: string) => -new Date(`${timeLocal}:00`).getTimezoneOffset() * 60;
/** Local wall-clock time of a point, as the app computes it. */
const civilOf = (p: Point) => {
  const i = p.nutritionLog.interval;
  return new Date(Date.parse(i.startTime) + Number(String(i.startUtcOffset).replace(/s$/, "")) * 1000).toISOString().slice(0, 16);
};

export async function fakeBackend(page: Page, opts: FakeOptions = {}) {
  let seq = 100;
  const requests: FakeRequest[] = [];
  const unmocked: string[] = [];
  const points = new Map<string, Point>();
  const settingsFile = {
    id: "settings-file-1",
    content: JSON.stringify({
      format: "health-tracker-settings",
      version: 1,
      entries: {
        goals: { value: opts.goals ?? DEFAULT_GOALS, updatedAt: 1 },
        todayLayout: { value: { v: 2, ...(opts.layout ?? DEFAULT_LAYOUT) }, updatedAt: 1 },
        ...(opts.favorites ? { favorites: { value: opts.favorites, updatedAt: 1 } } : {}),
      },
    }),
  };
  const state = { googleDown: false, driveWrites: 0 };

  const ours = { recordingMethod: "UNKNOWN", application: { googleWebClientId: CLIENT_ID }, platform: "GOOGLE_WEB_API" };
  for (const e of opts.entries ?? []) {
    const start = new Date(`${e.timeLocal}:00`);
    const off = `${offsetSecs(e.timeLocal)}s`;
    points.set(e.id, {
      name: e.id.replace("users/me/", "users/1234567890/"),
      dataSource: e.editable ? ours : { recordingMethod: "MANUAL", platform: "FITBIT" },
      nutritionLog: {
        interval: { startTime: start.toISOString(), startUtcOffset: off, endTime: new Date(start.getTime() + 60_000).toISOString(), endUtcOffset: off },
        mealType: e.mealType, foodDisplayName: e.displayName,
        ...(e.kcal !== undefined ? { energy: { kcal: e.kcal } } : {}),
        ...(e.carbsG !== undefined ? { totalCarbohydrate: { grams: e.carbsG } } : {}),
        ...(e.fatG !== undefined ? { totalFat: { grams: e.fatG } } : {}),
        ...(e.proteinG !== undefined ? { nutrients: [{ nutrient: "PROTEIN", quantity: { grams: e.proteinG } }] } : {}),
      },
    });
  }

  // ── Synthetic sleep: one main night per date, ending that morning ────────
  const sleepPoints: Point[] = [];
  for (let i = 0; i < (opts.sleepNights ?? 0); i++) {
    const end = new Date();
    end.setDate(end.getDate() - i);
    const wake = end.toLocaleDateString("en-CA");
    const bed = new Date(`${wake}T00:00:00`);
    bed.setMinutes(bed.getMinutes() - 60 + (i % 3) * 10);
    const spans: [string, number][] = [
      ["AWAKE", 5 + (i % 4)], ["LIGHT", 15 + (i % 5) * 3], ["DEEP", 50 + (i % 6) * 5], ["LIGHT", 60], ["REM", 30], ["AWAKE", 2 + (i % 2)],
      ["LIGHT", 40], ["AWAKE", 6 + (i % 3) * 4], ["DEEP", 30], ["REM", 40], ["LIGHT", 50], ["AWAKE", 3],
    ];
    let t = bed.getTime();
    const off = `${-bed.getTimezoneOffset() * 60}s`;
    const stages = spans.map(([type, min]) => ({ type, startTime: new Date(t).toISOString(), endTime: new Date((t += min * 60_000)).toISOString() }));
    const total = (type: string) => spans.filter(([s]) => s === type).reduce((a, [, m]) => a + m, 0);
    const inBed = spans.reduce((a, [, m]) => a + m, 0);
    sleepPoints.push({
      name: `users/1234567890/dataTypes/sleep/dataPoints/s${i}`,
      sleep: {
        interval: { startTime: stages[0]!.startTime, startUtcOffset: off, endTime: stages.at(-1)!.endTime, endUtcOffset: off },
        type: "STAGES",
        metadata: { mainSleep: true },
        summary: {
          minutesInSleepPeriod: String(inBed), minutesAsleep: String(inBed - total("AWAKE")), minutesAwake: String(total("AWAKE")),
          stagesSummary: ["DEEP", "LIGHT", "REM", "AWAKE"].map((type) => ({ type, minutes: String(total(type)), count: "1" })),
        },
        stages,
      },
      wakeDate: wake,
    });
  }

  // ── Browser state before the app loads ────────────────────────────────────
  const startMode = opts.start ?? "signedIn";
  const scopes = opts.scopes ?? ALL_SCOPES;
  const DRIVE = "https://www.googleapis.com/auth/drive.appdata";
  const healthScopes = scopes.filter((s) => s !== DRIVE);
  const driveConnected = opts.driveConnected ?? scopes.includes(DRIVE);
  await page.addInitScript(({ clientId, email, healthScopes, driveConnected, DRIVE, startMode }) => {
    if (startMode === "notConfigured") return;
    localStorage.setItem("health-tracker:client-id", clientId);
    // Only seed the sessions on the first load; later reloads keep whatever the app stored (e.g. after sign-out).
    if (startMode === "signedIn" && !sessionStorage.getItem("e2e:seeded")) {
      sessionStorage.setItem("e2e:seeded", "1");
      const expiresAt = Date.now() + 3600_000;
      sessionStorage.setItem(`health-tracker:session:${clientId}`, JSON.stringify({ accessToken: "ya29.e2e-seeded", expiresAt, scopes: healthScopes, email }));
      if (driveConnected) {
        sessionStorage.setItem(`health-tracker:drive:${clientId}`, JSON.stringify({ accessToken: "ya29.e2e-drive-seeded", expiresAt, scopes: [DRIVE], email }));
      }
    }
  }, { clientId: CLIENT_ID, email: EMAIL, healthScopes, driveConnected, DRIVE, startMode });

  const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "GET, POST, PATCH, DELETE, OPTIONS" };
  const send = (route: Route, body: unknown, status = 200) =>
    route.fulfill({ status, headers: { ...cors, "content-type": "application/json" }, body: typeof body === "string" ? body : JSON.stringify(body) });
  const done = (route: Route, response: unknown) => send(route, { done: true, response });
  const fail = (route: Route, req: FakeRequest) => {
    unmocked.push(`${req.method} ${req.url.origin}${req.url.pathname}`);
    return send(route, { error: { code: 599, message: `Unmocked ${req.method} ${req.url.href}` } }, 599);
  };

  const record = (route: Route): FakeRequest | null => {
    const r = route.request();
    const method = r.method();
    if (method === "OPTIONS") {
      void route.fulfill({ status: 204, headers: cors });
      return null;
    }
    let body: any = r.postData() ?? undefined;
    try {
      body = body ? JSON.parse(body) : undefined;
    } catch {
      /* multipart or text */
    }
    const req = { method, url: new URL(r.url()), body };
    requests.push(req);
    return req;
  };

  // ── Google Identity Services: a fake token client ─────────────────────────
  await page.route("https://accounts.google.com/gsi/client", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/javascript",
      body: `window.google = { accounts: { oauth2: {
        initTokenClient(cfg) { return { requestAccessToken() {
          // Like Google with include_granted_scopes=false: only the requested scopes that the user grants.
          const granted = ${JSON.stringify(scopes)};
          const scope = cfg.scope.split(" ").filter((s) => granted.includes(s)).join(" ");
          setTimeout(() => cfg.callback({ access_token: "ya29.e2e-" + Math.random().toString(36).slice(2), expires_in: 3599, scope }), 0);
        } }; },
        revoke(token, done) { window.__revoked = (window.__revoked || []).concat(token); if (done) done(); }
      } } };`,
    }),
  );

  // ── userinfo + Drive appDataFolder ────────────────────────────────────────
  /** Google Health rejects tokens that carry other scopes; the fake tracks which token is which. */
  const driveTokens = new Set(["Bearer ya29.e2e-drive-seeded"]);
  await page.route(/^https:\/\/www\.googleapis\.com\//, (route) => {
    const req = record(route);
    if (!req) return;
    const p = req.url.pathname;
    if (p.startsWith("/drive/") || p.startsWith("/upload/")) driveTokens.add(route.request().headers()["authorization"] ?? "");
    if (p === "/oauth2/v3/userinfo") return send(route, { email: EMAIL, email_verified: true });
    if (p === "/drive/v3/files" && req.method === "GET") return send(route, { files: [{ id: settingsFile.id, modifiedTime: new Date().toISOString() }] });
    if (p === `/drive/v3/files/${settingsFile.id}` && req.url.searchParams.get("alt") === "media") return send(route, settingsFile.content);
    if (p === `/upload/drive/v3/files/${settingsFile.id}` && req.method === "PATCH") {
      settingsFile.content = typeof req.body === "string" ? req.body : JSON.stringify(req.body);
      state.driveWrites++;
      return send(route, { id: settingsFile.id });
    }
    return fail(route, req);
  });

  // ── Google Health API ─────────────────────────────────────────────────────
  const rollupValue = (type: string): Record<string, unknown> | null => {
    if (type === "steps") return { steps: { countSum: "4000" } };
    if (type === "total-calories") return { totalCalories: { kcalSum: 2000 } };
    if (type === "nutrition-log") return { nutritionLog: { energy: { kcalSum: 1500 }, totalCarbohydrate: { gramsSum: 150 }, totalFat: { gramsSum: 50 }, nutrients: [{ nutrient: "PROTEIN", quantity: { gramsSum: 80 } }] } };
    return null;
  };
  const civil = (d: string) => {
    const [year, month, day] = d.split("-").map(Number);
    return { date: { year, month, day }, time: {} };
  };
  const nextDay = (d: string) => {
    const x = new Date(`${d}T12:00:00`);
    x.setDate(x.getDate() + 1);
    return x.toLocaleDateString("en-CA");
  };
  const ymd = (c: { year: number; month: number; day: number }) => `${c.year}-${String(c.month).padStart(2, "0")}-${String(c.day).padStart(2, "0")}`;

  const asResponse = (p: Point) => ({ ...p, name: p.name });
  const storeCreate = (body: any): Point => {
    const id = `users/me/dataTypes/nutrition-log/dataPoints/${seq++}`;
    const n = { ...body.nutritionLog };
    if (n.food) {
      // Google computes nutrition for food-based logs and labels the serving.
      n.energy = { kcal: Math.round(40 * n.serving.amount) };
      n.foodDisplayName = "Rice";
      n.serving = { ...n.serving, foodMeasurementUnitDisplayName: "oz" };
    }
    const point = { name: id.replace("users/me/", "users/1234567890/"), dataSource: ours, nutritionLog: n };
    points.set(id, point);
    return point;
  };

  await page.route(/^https:\/\/health\.googleapis\.com\//, (route) => {
    const req = record(route);
    if (!req) return;
    if (driveTokens.has(route.request().headers()["authorization"] ?? "")) {
      return send(route, { error: { code: 403, message: "Request contains disallowed OAuth scope(s).", status: "PERMISSION_DENIED" } }, 403);
    }
    const path = req.url.pathname.replace(/^\/v4\//, "");
    if (path === "users/me/identity") return send(route, { name: "users/me/identity", healthUserId: "1234567890" });

    const rollup = /^users\/me\/dataTypes\/([a-z-]+)\/dataPoints:dailyRollUp$/.exec(path);
    if (rollup && req.method === "POST") {
      const v = rollupValue(rollup[1]!);
      const days = [];
      if (v) for (let d = ymd(req.body.range.start.date); d < ymd(req.body.range.end.date); d = nextDay(d)) days.push({ civilStartTime: civil(d), civilEndTime: civil(nextDay(d)), ...v });
      return send(route, { rollupDataPoints: days });
    }

    if (path === "users/me/dataTypes/nutrition-log/dataPoints" && req.method === "POST") {
      if (state.googleDown) return send(route, { error: { code: 503, message: "The service is currently unavailable.", status: "UNAVAILABLE" } }, 503);
      return done(route, asResponse(storeCreate(req.body)));
    }
    if (path === "users/me/dataTypes/nutrition-log/dataPoints:batchDelete" && req.method === "POST") {
      for (const n of req.body.names as string[]) points.delete(n);
      return done(route, {});
    }
    const one = /^(users\/me\/dataTypes\/(nutrition-log|food)\/dataPoints\/[^/]+)$/.exec(path);
    if (one && req.method === "GET") {
      if (one[2] === "food") return one[1] === RICE.name ? send(route, ricePoint()) : send(route, { error: { code: 404, message: "Not found" } }, 404);
      const p = points.get(one[1]!);
      return p ? send(route, p) : send(route, { error: { code: 404, message: "Not found" } }, 404);
    }
    if (one && req.method === "PATCH") {
      const p = points.get(one[1]!);
      if (!p) return send(route, { error: { code: 404, message: "Not found" } }, 404);
      p.nutritionLog = { ...req.body.nutritionLog };
      return done(route, p);
    }

    const list = /^users\/me\/dataTypes\/([a-z-]+)\/dataPoints$/.exec(path);
    if (list && req.method === "GET") {
      const type = list[1]!;
      if (type === "nutrition-log") {
        const filter = req.url.searchParams.get("filter") ?? "";
        const from = /civil_start_time >= "([^"]+)"/.exec(filter)?.[1] ?? "";
        const to = /civil_start_time < "([^"]+)"/.exec(filter)?.[1] ?? "9999";
        return send(route, { dataPoints: [...points.values()].filter((p) => civilOf(p) >= from && civilOf(p) < to) });
      }
      // My foods: private foods first; a public food ends the private section.
      if (type === "food") return send(route, { dataPoints: [ricePoint("PRIVATE"), ricePoint("PUBLIC", "9001", "Public rice")] });
      if (type === "sleep") {
        const filter = req.url.searchParams.get("filter") ?? "";
        const from = /civil_end_time >= "([^"]+)"/.exec(filter)?.[1] ?? "";
        const to = /civil_end_time < "([^"]+)"/.exec(filter)?.[1] ?? "9999";
        return send(route, { dataPoints: sleepPoints.filter((p) => p.wakeDate >= from && p.wakeDate < to).map(({ wakeDate: _w, ...p }) => p) });
      }
      if (["exercise", "daily-resting-heart-rate"].includes(type)) return send(route, { dataPoints: [] });
    }
    return fail(route, req);
  });

  // ── Open Food Facts ───────────────────────────────────────────────────────
  await page.route(/^https:\/\/world\.openfoodfacts\.org\//, (route) => {
    const req = record(route);
    if (!req) return;
    if (req.url.pathname === "/cgi/search.pl") return send(route, { count: 1, page: 1, page_size: 25, products: [yogurtRaw(false)] });
    if (req.url.pathname === `/api/v2/product/${YOGURT.code}.json`) return send(route, { status: 1, product: yogurtRaw(true) });
    return fail(route, req);
  });

  const driveDoc = () => JSON.parse(settingsFile.content) as { entries: Record<string, { value: any }> };
  const fake = {
    requests,
    unmocked,
    /** Make nutrition-log creates fail with 503 (Google unavailable). */
    set googleDown(v: boolean) { state.googleDown = v; },
    get driveWrites() { return state.driveWrites; },
    /** Settings as stored in Drive (what another browser would see). */
    get goals() { return driveDoc().entries.goals?.value; },
    get layout() {
      const l = driveDoc().entries.todayLayout?.value;
      return l && { today: l.today, week: l.week };
    },
    get favorites(): { template: any }[] { return driveDoc().entries.favorites?.value ?? []; },
    /** Bodies of nutrition-log creates sent to Google. */
    creates: () => requests.filter((r) => r.method === "POST" && /\/nutrition-log\/dataPoints$/.test(r.url.pathname)).map((r) => r.body.nutritionLog),
    /** Local wall-clock start of a nutrition log body. */
    localStart: (n: { interval: { startTime: string; startUtcOffset: string } }) => civilOf({ name: "", nutritionLog: n }),
    points,
  };
  (page as unknown as { __fake: typeof fake }).__fake = fake;
  return fake;
}

export type Fake = Awaited<ReturnType<typeof fakeBackend>>;
