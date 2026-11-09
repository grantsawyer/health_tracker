import { Hono, type Context } from "hono";
import { getPoints, getRollup } from "../core/dataService.js";
import { buildSummary } from "../core/summary.js";
import { OffError, productByBarcode, searchFoods } from "../core/openFoodFacts.js";
import { getFavorites, removeFavorite, saveFavorite } from "../core/favorites.js";
import { getGoals, updateGoals } from "../core/goals.js";
import { getLayout, resetLayout, saveLayout } from "../core/layout.js";
import { FoodInputError, NotEditableError, createEntry, discardPendingWrite, listPendingWrites, retryAllPending, deleteEntry, getDay, getEntries, getFood, getMyFoods, getRecents, getUnits, parseEntry, updateEntry } from "../core/food.js";
import { AccountNotLinkedError, HealthApiError } from "../core/healthClient.js";
import { BadRequestError } from "../core/errors.js";
import { requireDataType, requireDate, sourceFamily, validateRange } from "../core/validate.js";
import { deletePoints, writeTestEntry } from "../core/explorer.js";
import { ReauthRequiredError, fullScope } from "./oauth.js";
import { loadTokens } from "./tokenStore.js";
import { DATA_TYPES } from "../shared/dataTypes.js";

export const dataRoutes = new Hono();

function grantedScopes(): Set<string> {
  return new Set(loadTokens()?.scope.split(" ") ?? []);
}

const range = (c: Context) => validateRange(c.req.query("start"), c.req.query("end"));
const fresh = (c: Context) => c.req.query("fresh") === "1";

/** Map errors to HTTP responses the frontend can act on (the browser build maps them the same way in src/api.browser.ts). */
function errorResponse(c: Context, err: unknown) {
  if (err instanceof BadRequestError || err instanceof FoodInputError) return c.json({ error: "bad_request", message: err.message }, 400);
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

async function jsonBody(c: Context): Promise<unknown> {
  return c.req.json().catch(() => {
    throw new BadRequestError("Request body must be JSON");
  });
}
const route = (fn: (c: Context) => Promise<unknown>) => async (c: Context) => {
  try {
    return c.json(await fn(c));
  } catch (err) {
    return errorResponse(c, err);
  }
};
function requireId(b: unknown): string {
  const id = (b as { id?: unknown } | null)?.id;
  if (typeof id !== "string") throw new BadRequestError("id is required");
  return id;
}

// ── Reads ────────────────────────────────────────────────────────────────────

dataRoutes.get("/data-types", (c) => {
  const granted = grantedScopes();
  return c.json(DATA_TYPES.map((t) => ({ ...t, granted: granted.has(fullScope(t.scope)) })));
});

dataRoutes.get("/data/:type/points", route(async (c) => {
  const info = requireDataType(c.req.param("type") ?? "");
  const r = await getPoints(info, { ...range(c), source: sourceFamily(c.req.query("source")), fresh: fresh(c) });
  return { ...r.value, cached: r.cached, fetchedAt: r.fetchedAt };
}));

dataRoutes.get("/data/:type/rollup", route(async (c) => {
  const info = requireDataType(c.req.param("type") ?? "");
  if (!info.rollup) throw new BadRequestError(`${info.id} does not support daily rollups`);
  const r = await getRollup(info, { ...range(c), source: sourceFamily(c.req.query("source")), fresh: fresh(c) });
  return { ...r.value, cached: r.cached, fetchedAt: r.fetchedAt };
}));

/** Normalized dashboard data for a date range (see shared/summary.ts). */
dataRoutes.get("/summary", route(async (c) => {
  const { start, end } = range(c);
  return buildSummary(start, end, fresh(c), grantedScopes());
}));

// ── Food logging (see shared/food.ts for the Google Health constraints) ─────

dataRoutes.get("/food/day", route((c) => getDay(requireDate(c.req.query("date"), "date"), fresh(c))));
dataRoutes.get("/food/entries", route((c) => {
  const { start, end } = range(c);
  return getEntries(start, end, fresh(c));
}));
dataRoutes.get("/food/library", route((c) => getMyFoods(fresh(c))));
dataRoutes.get("/food/recents", route((c) => getRecents(requireDate(c.req.query("today"), "today"), fresh(c))));
dataRoutes.get("/food/item", route((c) => getFood(c.req.query("name") ?? "", fresh(c))));
dataRoutes.get("/food/units", route((c) => getUnits(fresh(c))));
dataRoutes.post("/food/entries", route(async (c) => createEntry(parseEntry(await jsonBody(c)))));
dataRoutes.post("/food/entries/update", route(async (c) => {
  const b = (await jsonBody(c)) as { entry?: unknown };
  return updateEntry(requireId(b), parseEntry(b.entry));
}));
dataRoutes.post("/food/entries/delete", route(async (c) => {
  await deleteEntry(requireId(await jsonBody(c)));
  return { ok: true };
}));

// Goals, Today layout and favorites (app settings; Google's API has no goals)
dataRoutes.get("/goals", route(async () => getGoals()));
dataRoutes.post("/goals", route(async (c) => updateGoals(await jsonBody(c))));
dataRoutes.get("/layout", route(async () => getLayout()));
dataRoutes.post("/layout", route(async (c) => saveLayout(await jsonBody(c))));
dataRoutes.post("/layout/reset", route(async () => resetLayout()));
dataRoutes.get("/food/favorites", route(async () => getFavorites()));
dataRoutes.post("/food/favorites", route(async (c) => saveFavorite(await jsonBody(c))));
dataRoutes.post("/food/favorites/delete", route(async (c) => {
  const b = (await jsonBody(c)) as { id?: unknown };
  return { ok: await removeFavorite(String(b?.id ?? "")) };
}));

// Retry queue for entries Google couldn't accept yet
dataRoutes.get("/food/pending", route(async () => listPendingWrites()));
dataRoutes.post("/food/pending/retry", route(async (c) => {
  const b = (await c.req.json().catch(() => ({}))) as { includeFailed?: unknown };
  const result = await retryAllPending(b?.includeFailed === true);
  return { ...result, pending: await listPendingWrites() };
}));
dataRoutes.post("/food/pending/discard", route(async (c) => {
  const b = (await jsonBody(c)) as { id?: unknown };
  return { ok: await discardPendingWrite(String(b?.id ?? "")) };
}));

// Open Food Facts (public food database)
dataRoutes.get("/off/search", route(async (c) => searchFoods(c.req.query("q") ?? "")));
dataRoutes.get("/off/product", route(async (c) => ({ product: await productByBarcode((c.req.query("code") ?? "").trim()) })));

// ── Data explorer writes ─────────────────────────────────────────────────────
dataRoutes.post("/debug/nutrition-test", route(async (c) => writeTestEntry(await c.req.json().catch(() => null))));
dataRoutes.post("/data/delete", route(async (c) => deletePoints(((await c.req.json().catch(() => null)) as { names?: unknown } | null)?.names)));
