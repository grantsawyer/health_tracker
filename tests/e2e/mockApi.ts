import type { Page, Route } from "@playwright/test";
import type { FavoriteFood, FoodLogEntry, LibraryFood, OffProduct, PendingFoodWrite } from "../../shared/food";

/**
 * In-browser mock of the local server's API. Holds a little state (the day's
 * entries, favorites, pending writes) and records every request so tests can
 * assert on request bodies. Any unmocked /api or /auth call fails the test.
 */
export const today = () => new Date().toLocaleDateString("en-CA");
const OZ = "users/me/dataTypes/food-measurement-unit/dataPoints/226";
const GRAM = "users/me/dataTypes/food-measurement-unit/dataPoints/147";

export const RICE: LibraryFood = {
  name: "users/me/dataTypes/food/dataPoints/42",
  displayName: "Rice",
  defaultServing: { unit: OZ, label: "oz", amount: 1 },
  servings: [{ unit: GRAM, label: "gram", plural: "grams", multiplier: 0.0352739619 }, { unit: OZ, label: "oz", plural: "oz", multiplier: 1 }],
  kcal: 40, proteinG: 1, carbsG: 9, fatG: 0,
};

export const YOGURT: OffProduct = {
  code: "0894700010137", name: "Greek Yogurt", brand: "Chobani", servingSize: "1 serving (150 g)", servingGrams: 150,
  per100g: { kcal: 73, proteinG: 8, carbsG: 10.7, fatG: 0 },
  perServing: { kcal: 110, proteinG: 12, carbsG: 16, fatG: 0 },
};

export interface MockState {
  goals: Record<string, number | null>;
  layout: { today: string[]; week: string[] };
  entries: FoodLogEntry[];
  favorites: FavoriteFood[];
  pending: PendingFoodWrite[];
  /** When true, the next create is "queued" as if Google were down. */
  googleDown: boolean;
  requests: { method: string; path: string; body: any }[];
  unmocked: string[];
}

let seq = 100;

export async function mockApi(page: Page, init: Partial<MockState> = {}): Promise<MockState> {
  const state: MockState = { goals: { steps: 10000, activeZoneMinutes: 22, floors: 10, caloriesBurned: 2000, caloriesEaten: 2000, carbsG: 275, fatG: 78, proteinG: 50, exerciseDaysPerWeek: 5, sleepMinutes: null }, layout: { today: ["heartRate", "sleep", "caloriesEaten"], week: ["steps", "sleep"] }, entries: [], favorites: [], pending: [], googleDown: false, requests: [], unmocked: [], ...init };
  const ok = (route: Route, body: unknown, status = 200) =>
    route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

  const fromNew = (e: any, id = `users/me/dataTypes/nutrition-log/dataPoints/${seq++}`): FoodLogEntry =>
    e.kind === "food"
      ? { id, timeLocal: e.timeLocal, mealType: e.mealType, displayName: RICE.displayName, food: e.food, serving: { amount: e.amount, unit: e.unit, label: "oz" }, kcal: Math.round(40 * e.amount), editable: true, source: "Health Tracker" }
      : { id, timeLocal: e.timeLocal, mealType: e.mealType, displayName: e.displayName, kcal: e.kcal, proteinG: e.proteinG, carbsG: e.carbsG, fatG: e.fatG, editable: true, source: "Health Tracker" };

  await page.route(/\/(api|auth)\//, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname;
    const method = req.method();
    let body: any;
    try {
      body = req.postData() ? JSON.parse(req.postData()!) : undefined;
    } catch {
      body = req.postData();
    }
    state.requests.push({ method, path, body });

    if (path === "/api/layout" && method === "GET") return ok(route, state.layout);
    if (path === "/api/layout" && method === "POST") { state.layout = body; return ok(route, state.layout); }
    if (path === "/api/layout/reset") { state.layout = { today: ["heartRate", "sleep", "caloriesEaten"], week: ["steps", "sleep"] }; return ok(route, state.layout); }
    if (path === "/api/goals" && method === "GET") return ok(route, state.goals);
    if (path === "/api/goals" && method === "POST") { state.goals = { ...state.goals, ...body }; return ok(route, state.goals); }
    if (path === "/api/status") return ok(route, { state: "connected", email: "tester@example.com", healthUserId: "1", scopes: [] });
    if (path === "/api/summary") {
      const days = [];
      for (let d = new Date(`${url.searchParams.get("start")}T12:00:00`); d.toLocaleDateString("en-CA") < url.searchParams.get("end")!; d.setDate(d.getDate() + 1)) {
        days.push({ date: d.toLocaleDateString("en-CA"), steps: 4000, caloriesOut: 2000, nutrition: { kcal: 1500, proteinG: 80, carbsG: 150, fatG: 50 } });
      }
      return ok(route, { start: url.searchParams.get("start"), end: url.searchParams.get("end"), days, sleep: [], exercise: [], errors: {}, fetchedAt: new Date().toISOString(), cached: false });
    }
    if (path === "/api/food/day") {
      const date = url.searchParams.get("date")!;
      const entries = state.entries.filter((e) => e.timeLocal.startsWith(date));
      const sum = (k: "kcal" | "proteinG" | "carbsG" | "fatG") => entries.reduce((t, e) => t + (e[k] ?? 0), 0);
      return ok(route, { date, entries, totals: { kcal: sum("kcal"), proteinG: sum("proteinG"), carbsG: sum("carbsG"), fatG: sum("fatG") } });
    }
    if (path === "/api/food/recents") return ok(route, [{ kind: "quick", displayName: "Hummus", kcal: 70, proteinG: 2, carbsG: 4, fatG: 5, lastLogged: `${today()}T08:00` }]);
    if (path === "/api/food/library") return ok(route, [RICE]);
    if (path === "/api/food/item") return ok(route, RICE);
    if (path === "/api/food/favorites" && method === "GET") return ok(route, state.favorites);
    if (path === "/api/food/favorites" && method === "POST") {
      const fav = { id: `fav-${seq++}`, template: body };
      state.favorites.push(fav);
      return ok(route, fav);
    }
    if (path === "/api/food/favorites/delete") {
      state.favorites = state.favorites.filter((f) => f.id !== body.id);
      return ok(route, { ok: true });
    }
    if (path === "/api/food/pending") return ok(route, state.pending);
    if (path === "/api/food/pending/discard") {
      state.pending = state.pending.filter((p) => p.id !== body.id);
      return ok(route, { ok: true });
    }
    if (path === "/api/food/entries" && method === "POST") {
      if (state.googleDown) {
        const p: PendingFoodWrite = { id: `pending-${seq++}`, label: body.displayName ?? "Food", timeLocal: body.timeLocal, attempts: 1, lastError: "Google Health API 503", failed: false, nextAttemptAt: new Date(Date.now() + 60_000).toISOString() };
        state.pending.push(p);
        return ok(route, { status: "queued", pending: p });
      }
      const entry = fromNew(body);
      state.entries.push(entry);
      return ok(route, { status: "saved", entry });
    }
    if (path === "/api/food/entries/update") {
      const i = state.entries.findIndex((e) => e.id === body.id);
      const replaced = fromNew(body.entry, body.entry.kind === "quick" ? undefined : body.id);
      state.entries.splice(i, 1, replaced);
      return ok(route, replaced);
    }
    if (path === "/api/food/entries/delete") {
      state.entries = state.entries.filter((e) => e.id !== body.id);
      return ok(route, { ok: true });
    }
    if (path === "/api/off/search") return ok(route, [{ ...YOGURT, servingSize: undefined, servingGrams: undefined, perServing: undefined }]);
    if (path === "/api/off/product") return ok(route, { product: YOGURT });

    state.unmocked.push(`${method} ${path}`);
    return ok(route, { error: "unmocked", message: `Unmocked ${method} ${path}` }, 599);
  });
  return state;
}
