import { Hono, type Context } from "hono";
import { cacheInvalidateType } from "./cache.js";
import { getPoints, getRollup } from "./dataService.js";
import { buildSummary } from "./summary.js";
import { OffError, productByBarcode, searchFoods } from "./openFoodFacts.js";
import { getFavorites, removeFavorite, saveFavorite } from "./favorites.js";
import { FoodInputError, NotEditableError, createEntry, discardPendingWrite, listPendingWrites, retryAllPending, deleteEntry, getDay, getFood, getMyFoods, getRecents, getUnits, parseEntry, updateEntry } from "./food.js";
import {
  AccountNotLinkedError,
  HealthApiError,
  SOURCE_FAMILIES,
  addDays,
  batchDeleteDataPoints,
  createDataPoint,
  isDataPointName,
} from "./googleHealth.js";
import { ReauthRequiredError, fullScope } from "./oauth.js";
import { loadTokens } from "./tokenStore.js";
import { DATA_TYPES, MEAL_TYPES, dataTypeById, type DataTypeInfo } from "../shared/dataTypes.js";

export const dataRoutes = new Hono();

class BadRequest extends Error {}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_RANGE_DAYS = 366;

function grantedScopes(): Set<string> {
  return new Set(loadTokens()?.scope.split(" ") ?? []);
}

function requireType(id: string): DataTypeInfo {
  const info = dataTypeById(id);
  if (!info) throw new BadRequest(`Unknown data type: ${id}`);
  return info;
}

function parseRange(c: Context): { start: string; end: string } {
  const { start, end } = c.req.query();
  if (!start || !end || !ISO_DATE.test(start) || !ISO_DATE.test(end)) {
    throw new BadRequest("start and end are required as YYYY-MM-DD (end exclusive)");
  }
  if (start >= end) throw new BadRequest("start must be before end");
  if (addDays(start, MAX_RANGE_DAYS) < end) throw new BadRequest(`Range is limited to ${MAX_RANGE_DAYS} days`);
  return { start, end };
}

function parseSource(c: Context): string | undefined {
  const s = c.req.query("source");
  if (!s || s === "all") return undefined;
  const family = SOURCE_FAMILIES[s as keyof typeof SOURCE_FAMILIES];
  if (!family) throw new BadRequest(`source must be one of: ${Object.keys(SOURCE_FAMILIES).join(", ")}`);
  return family;
}

/** Map errors to HTTP responses the frontend can act on. */
function errorResponse(c: Context, err: unknown) {
  if (err instanceof BadRequest || err instanceof FoodInputError) return c.json({ error: "bad_request", message: err.message }, 400);
  if (err instanceof NotEditableError) return c.json({ error: "not_editable", message: err.message }, 403);
  if (err instanceof OffError) return c.json({ error: "food_database", message: err.message }, err.status as 400 | 429 | 502 | 503);
  if (err instanceof ReauthRequiredError) return c.json({ error: "reauth_required", message: err.message }, 401);
  if (err instanceof AccountNotLinkedError) return c.json({ error: "account_not_linked", message: err.message }, 409);
  if (err instanceof HealthApiError) {
    console.error("[data]", err.message);
    return c.json({ error: "google_api_error", status: err.status, message: err.message, google: err.body }, 502);
  }
  console.error("[data] unexpected:", err);
  return c.json({ error: "internal", message: (err as Error).message }, 500);
}

// ── Reads ────────────────────────────────────────────────────────────────────

dataRoutes.get("/data-types", (c) => {
  const granted = grantedScopes();
  return c.json(DATA_TYPES.map((t) => ({ ...t, granted: granted.has(fullScope(t.scope)) })));
});

dataRoutes.get("/data/:type/points", async (c) => {
  try {
    const info = requireType(c.req.param("type"));
    const { start, end } = parseRange(c);
    const source = parseSource(c);
    const r = await getPoints(info, { start, end, source, fresh: c.req.query("fresh") === "1" });
    return c.json({ ...r.value, cached: r.cached, fetchedAt: r.fetchedAt });
  } catch (err) {
    return errorResponse(c, err);
  }
});

dataRoutes.get("/data/:type/rollup", async (c) => {
  try {
    const info = requireType(c.req.param("type"));
    if (!info.rollup) throw new BadRequest(`${info.id} does not support daily rollups`);
    const { start, end } = parseRange(c);
    const source = parseSource(c);
    const r = await getRollup(info, { start, end, source, fresh: c.req.query("fresh") === "1" });
    return c.json({ ...r.value, cached: r.cached, fetchedAt: r.fetchedAt });
  } catch (err) {
    return errorResponse(c, err);
  }
});

/** Normalized dashboard data for a date range (see shared/summary.ts). */
dataRoutes.get("/summary", async (c) => {
  try {
    const { start, end } = parseRange(c);
    return c.json(await buildSummary(start, end, c.req.query("fresh") === "1", grantedScopes()));
  } catch (err) {
    return errorResponse(c, err);
  }
});

// ── Food logging (see shared/food.ts for the Google Health constraints) ─────

const fresh = (c: Context) => c.req.query("fresh") === "1";
function requireDate(c: Context, key: string): string {
  const d = c.req.query(key);
  if (!d || !ISO_DATE.test(d)) throw new BadRequest(`${key} is required as YYYY-MM-DD`);
  return d;
}
async function jsonBody(c: Context): Promise<unknown> {
  return c.req.json().catch(() => {
    throw new BadRequest("Request body must be JSON");
  });
}
const route = (fn: (c: Context) => Promise<unknown>) => async (c: Context) => {
  try {
    return c.json(await fn(c));
  } catch (err) {
    return errorResponse(c, err);
  }
};

dataRoutes.get("/food/day", route((c) => getDay(requireDate(c, "date"), fresh(c))));
dataRoutes.get("/food/library", route((c) => getMyFoods(fresh(c))));
dataRoutes.get("/food/recents", route((c) => getRecents(requireDate(c, "today"), fresh(c))));
dataRoutes.get("/food/item", route((c) => getFood(c.req.query("name") ?? "", fresh(c))));
dataRoutes.get("/food/units", route((c) => getUnits(fresh(c))));
dataRoutes.post("/food/entries", route(async (c) => createEntry(parseEntry(await jsonBody(c)))));
dataRoutes.post("/food/entries/update", route(async (c) => {
  const b = (await jsonBody(c)) as { id?: unknown; entry?: unknown };
  if (typeof b?.id !== "string") throw new BadRequest("id is required");
  return updateEntry(b.id, parseEntry(b.entry));
}));
dataRoutes.post("/food/entries/delete", route(async (c) => {
  const b = (await jsonBody(c)) as { id?: unknown };
  if (typeof b?.id !== "string") throw new BadRequest("id is required");
  await deleteEntry(b.id);
  return { ok: true };
}));

// Favorites (local, app.db)
dataRoutes.get("/food/favorites", route(async () => getFavorites()));
dataRoutes.post("/food/favorites", route(async (c) => saveFavorite(await jsonBody(c))));
dataRoutes.post("/food/favorites/delete", route(async (c) => {
  const b = (await jsonBody(c)) as { id?: unknown };
  return { ok: removeFavorite(String(b?.id ?? "")) };
}));

// Retry queue for entries Google couldn't accept yet
dataRoutes.get("/food/pending", route(async () => listPendingWrites()));
dataRoutes.post("/food/pending/retry", route(async (c) => {
  const b = (await c.req.json().catch(() => ({}))) as { includeFailed?: unknown };
  const result = await retryAllPending(b?.includeFailed === true);
  return { ...result, pending: listPendingWrites() };
}));
dataRoutes.post("/food/pending/discard", route(async (c) => {
  const b = (await jsonBody(c)) as { id?: unknown };
  return { ok: discardPendingWrite(String(b?.id ?? "")) };
}));

// Open Food Facts (public food database)
dataRoutes.get("/off/search", route(async (c) => searchFoods(c.req.query("q") ?? "")));
dataRoutes.get("/off/product", route(async (c) => ({ product: await productByBarcode((c.req.query("code") ?? "").trim()) })));

// ── Writes ───────────────────────────────────────────────────────────────────

/**
 * Phase 2 write probe: creates one anonymous nutrition-log entry so we can
 * confirm the API accepts nutrition writes and see the response shape.
 * Anonymous-food logs can't be edited, but can be deleted via /data/delete.
 * Replaced by the real food-entry API in Phase 4.
 */
dataRoutes.post("/debug/nutrition-test", async (c) => {
  try {
    const body = (await c.req.json().catch(() => null)) as {
      startTime?: string;
      utcOffsetSeconds?: number;
      kcal?: number;
      mealType?: string;
      foodDisplayName?: string;
    } | null;
    if (!body?.startTime || Number.isNaN(Date.parse(body.startTime))) throw new BadRequest("startTime (RFC 3339) is required");
    if (typeof body.utcOffsetSeconds !== "number" || Math.abs(body.utcOffsetSeconds) > 14 * 3600) {
      throw new BadRequest("utcOffsetSeconds is required");
    }
    const kcal = body.kcal ?? 1;
    if (typeof kcal !== "number" || kcal < 0 || kcal > 100_000) throw new BadRequest("kcal must be 0–100000");
    const mealType = body.mealType ?? "SNACK";
    if (!(MEAL_TYPES as readonly string[]).includes(mealType)) throw new BadRequest(`mealType must be one of ${MEAL_TYPES.join(", ")}`);

    const start = new Date(body.startTime);
    const end = new Date(start.getTime() + 60_000);
    const offset = `${Math.round(body.utcOffsetSeconds)}s`;
    const operation = await createDataPoint("nutrition-log", {
      nutritionLog: {
        interval: { startTime: start.toISOString(), startUtcOffset: offset, endTime: end.toISOString(), endUtcOffset: offset },
        energy: { kcal },
        mealType,
        foodDisplayName: body.foodDisplayName ?? "Health Tracker test entry",
      },
    });
    cacheInvalidateType("nutrition-log");
    return c.json({ operation });
  } catch (err) {
    return errorResponse(c, err);
  }
});

dataRoutes.post("/data/delete", async (c) => {
  try {
    const body = (await c.req.json().catch(() => null)) as { names?: unknown } | null;
    const names = body?.names;
    if (!Array.isArray(names) || names.length === 0 || names.length > 1000 || !names.every((n) => typeof n === "string" && isDataPointName(n))) {
      throw new BadRequest("names must be a non-empty array of names like users/me/dataTypes/{type}/dataPoints/{id}");
    }
    const operation = await batchDeleteDataPoints(names);
    for (const type of new Set(names.map((n) => n.split("/")[3]))) if (type) cacheInvalidateType(type);
    return c.json({ operation });
  } catch (err) {
    return errorResponse(c, err);
  }
});
