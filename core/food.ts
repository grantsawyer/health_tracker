import { getPoints, withCache } from "./dataService.js";
import {
  HealthApiError, SOURCE_FAMILIES, addDays, batchDeleteDataPoints, createDataPoint, healthFetch, patchDataPoint, type DataPoint,
} from "./healthClient.js";
import { toLocal } from "./summary.js";
import { FoodInputError, NotEditableError, ReauthRequiredError } from "./errors.js";
import { platform, type PendingRow } from "./platform.js";
import { dataTypeById } from "../shared/dataTypes.js";
import {
  LOG_MEAL_TYPES, type FoodLogDay, type FoodLogEntry, type FoodServingOption, type LibraryFood,
  type CreateResult, type NewFoodLogEntry, type PendingFoodWrite, type RecentFood,
} from "../shared/food.js";

type Loose = Record<string, any>;

export { FoodInputError, NotEditableError } from "./errors.js";

const NUTRITION_LOG = dataTypeById("nutrition-log")!;
/** Normalize "users/{numericId}/…" (as returned) to "users/me/…" (as accepted in requests). */
const asMe = (name: string) => name.replace(/^users\/[^/]+\//, "users/me/");
const num = (v: unknown) => {
  const n = typeof v === "number" ? v : Number(v);
  return v === undefined || v === null || v === "" || !Number.isFinite(n) ? undefined : n;
};
const round1 = (v: number) => Math.round(v * 10) / 10;

// ── Paging for collections that take no filter (food, food-measurement-unit) ─
// The API caps these at 25 per page regardless of pageSize.
async function listAll(type: string, maxPages: number, stop?: (page: DataPoint[]) => boolean): Promise<DataPoint[]> {
  const out: DataPoint[] = [];
  let token = "";
  for (let page = 0; page < maxPages; page++) {
    const params = new URLSearchParams({ pageSize: "25", ...(token ? { pageToken: token } : {}) });
    const res = await healthFetch<{ dataPoints?: DataPoint[]; nextPageToken?: string }>(`/users/me/dataTypes/${type}/dataPoints?${params}`);
    const pts = res.dataPoints ?? [];
    out.push(...pts);
    token = res.nextPageToken ?? "";
    if (!token || stop?.(pts)) break;
  }
  return out;
}

async function cached<T>(key: string, type: string, ttlMs: number, fresh: boolean, load: () => Promise<T>): Promise<T> {
  return (await withCache(key, type, ttlMs, fresh, load)).value;
}

// ── Units (static catalog, ~hundreds of entries) ────────────────────────────
export function getUnits(fresh = false): Promise<Record<string, { label: string; plural?: string }>> {
  return cached("food:units", "food-measurement-unit", 30 * 24 * 3600_000, fresh, async () => {
    const pts = await listAll("food-measurement-unit", 80);
    return Object.fromEntries(
      pts.map((p) => {
        const u = p.foodMeasurementUnit as Loose;
        return [asMe(p.name!), { label: u?.displayName ?? "unit", plural: u?.pluralDisplayName }];
      }),
    );
  });
}

// ── Library: the owner's private foods (listed before public foods) ─────────
function mapFood(p: DataPoint): LibraryFood | null {
  const f = p.food as Loose | undefined;
  if (!f?.defaultServing?.foodMeasurementUnit || !p.name) return null;
  const nutrient = (k: string) => num((f.nutrients as Loose[] | undefined)?.find((x) => x.nutrient === k)?.quantity?.grams);
  const servings: FoodServingOption[] = ((f.servings ?? []) as Loose[])
    .filter((s) => s.foodMeasurementUnit && num(s.multiplier))
    .map((s) => ({
      unit: asMe(s.foodMeasurementUnit),
      label: s.foodMeasurementUnitDisplayName ?? "unit",
      plural: s.foodMeasurementUnitDisplayNamePlural,
      multiplier: num(s.multiplier)!,
    }));
  const def = f.defaultServing;
  const defUnit = asMe(def.foodMeasurementUnit);
  if (!servings.some((s) => s.unit === defUnit)) {
    const amount = num(def.amount) || 1;
    servings.unshift({ unit: defUnit, label: def.foodMeasurementUnitDisplayName ?? "serving", plural: def.foodMeasurementUnitDisplayNamePlural, multiplier: 1 / amount });
  }
  return {
    name: asMe(p.name),
    displayName: String(f.displayName ?? "Food").trim(),
    brand: f.brand || undefined,
    defaultServing: { unit: defUnit, label: def.foodMeasurementUnitDisplayName ?? "serving", amount: num(def.amount) || 1 },
    servings,
    kcal: num(f.energyAvg?.kcal),
    proteinG: nutrient("PROTEIN"),
    carbsG: num(f.totalCarbohydrate?.grams) ?? nutrient("CARBOHYDRATES"),
    fatG: num(f.totalFat?.grams),
  };
}

export function getMyFoods(fresh = false): Promise<LibraryFood[]> {
  return cached("food:mine", "food", 3600_000, fresh, async () => {
    const isPrivate = (p: DataPoint) => (p.food as Loose | undefined)?.accessLevel === "FOOD_ACCESS_LEVEL_PRIVATE";
    // Private foods come first; stop at the first page that reaches public foods.
    const pts = await listAll("food", 40, (page) => page.some((p) => !isPrivate(p)));
    return pts.filter(isPrivate).map(mapFood).filter((f): f is LibraryFood => f !== null)
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
  });
}

/** One food by resource name (library or public), cached for a week. */
export async function getFood(name: string, fresh = false): Promise<LibraryFood> {
  if (!FOOD_NAME.test(name)) throw new FoodInputError("Invalid food id");
  const food = await cached(`food:get:${name}`, "food", 7 * 24 * 3600_000, fresh, async () => mapFood(await healthFetch<DataPoint>(`/${name}`)));
  if (!food) throw new Error("Google returned a food without a default serving");
  return food;
}

/** Entries read back from Google carry the serving's label but not its unit id; recover it from the food. */
async function resolveUnit(foodName: string, label: string | undefined): Promise<string | undefined> {
  if (!label) return undefined;
  try {
    const food = await getFood(foodName);
    const l = label.toLowerCase();
    return food.servings.find((s) => s.label.toLowerCase() === l || s.plural?.toLowerCase() === l)?.unit;
  } catch {
    return undefined;
  }
}

// ── Log entries ──────────────────────────────────────────────────────────────
function isOurs(p: DataPoint): boolean {
  const app = (p.dataSource as Loose | undefined)?.application;
  const clientId = platform().clientId();
  return Boolean(clientId) && app?.googleWebClientId === clientId;
}

function mapEntry(p: DataPoint, units: Record<string, { label: string; plural?: string }>): FoodLogEntry | null {
  const n = p.nutritionLog as Loose | undefined;
  if (!n?.interval || !p.name) return null;
  const nutrient = (k: string) => num((n.nutrients as Loose[] | undefined)?.find((x) => x.nutrient === k)?.quantity?.grams);
  const unit = n.serving?.foodMeasurementUnit ? asMe(n.serving.foodMeasurementUnit) : undefined;
  const amount = num(n.serving?.amount);
  const sodium = nutrient("SODIUM");
  const ds = p.dataSource as Loose | undefined;
  return {
    id: asMe(p.name),
    timeLocal: toLocal(n.interval.startTime, n.interval.startUtcOffset),
    mealType: String(n.mealType ?? "ANYTIME"),
    displayName: String(n.foodDisplayName ?? "Food").trim(),
    food: n.food ? asMe(n.food) : undefined,
    serving: amount !== undefined
      ? { amount, unit, label: n.serving.foodMeasurementUnitDisplayName ?? (unit ? (amount === 1 ? units[unit]?.label : units[unit]?.plural ?? units[unit]?.label) : undefined) }
      : undefined,
    kcal: num(n.energy?.kcal),
    proteinG: nutrient("PROTEIN"),
    carbsG: num(n.totalCarbohydrate?.grams) ?? nutrient("CARBOHYDRATES"),
    fatG: num(n.totalFat?.grams),
    fiberG: nutrient("DIETARY_FIBER"),
    sugarG: nutrient("SUGAR"),
    sodiumMg: sodium !== undefined ? round1(sodium * 1000) : undefined,
    editable: isOurs(p),
    source: isOurs(p) ? "Health Tracker" : ds?.application?.packageName ?? (ds?.platform === "FITBIT" ? "Fitbit" : ds?.platform),
  };
}

/** Unit labels are only needed for entries whose serving lacks a display name (e.g. ones this app wrote). */
async function unitsIfNeeded(points: DataPoint[]) {
  const needs = points.some((p) => {
    const s = (p.nutritionLog as Loose | undefined)?.serving;
    return s?.foodMeasurementUnit && !s.foodMeasurementUnitDisplayName;
  });
  return needs ? getUnits().catch(() => ({})) : {};
}

export async function getDay(date: string, fresh = false): Promise<FoodLogDay> {
  const res = await getPoints(NUTRITION_LOG, { start: date, end: addDays(date, 1), fresh });
  const units = await unitsIfNeeded(res.value.dataPoints);
  const entries = res.value.dataPoints
    .map((p) => mapEntry(p, units))
    .filter((e): e is FoodLogEntry => e !== null && e.timeLocal.startsWith(date))
    .sort((a, b) => a.timeLocal.localeCompare(b.timeLocal));
  const sum = (k: "kcal" | "proteinG" | "carbsG" | "fatG") => round1(entries.reduce((t, e) => t + (e[k] ?? 0), 0));
  return { date, entries, totals: { kcal: sum("kcal"), proteinG: sum("proteinG"), carbsG: sum("carbsG"), fatG: sum("fatG") } };
}

/** Distinct items logged in the last 30 days, most recent first. Keyed by food resource, or name + kcal for quick adds. */
export async function getRecents(today: string, fresh = false): Promise<RecentFood[]> {
  const res = await getPoints(NUTRITION_LOG, { start: addDays(today, -30), end: addDays(today, 1), fresh });
  const units = await unitsIfNeeded(res.value.dataPoints);
  const entries = res.value.dataPoints.map((p) => mapEntry(p, units)).filter((e): e is FoodLogEntry => e !== null)
    .sort((a, b) => b.timeLocal.localeCompare(a.timeLocal));
  const seen = new Set<string>();
  const picked: FoodLogEntry[] = [];
  for (const e of entries) {
    const key = e.food ? `food:${e.food}` : `quick:${e.displayName.toLowerCase()}:${e.kcal ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    picked.push(e);
    if (picked.length >= 30) break;
  }
  // Recover unit ids for food entries in parallel (each food lookup is cached).
  await Promise.all(picked.map(async (e) => {
    if (e.food && e.serving && !e.serving.unit) e.serving.unit = await resolveUnit(e.food, e.serving.label);
  }));
  const out: RecentFood[] = [];
  for (const e of picked) {
    if (e.food && e.serving?.unit) {
      out.push({ kind: "food", food: e.food, displayName: e.displayName, amount: e.serving.amount, unit: e.serving.unit, label: e.serving.label, kcal: e.kcal, lastLogged: e.timeLocal });
    } else if (!e.food && e.kcal !== undefined) {
      out.push({ kind: "quick", displayName: e.displayName, kcal: e.kcal, proteinG: e.proteinG, carbsG: e.carbsG, fatG: e.fatG, fiberG: e.fiberG, sugarG: e.sugarG, sodiumMg: e.sodiumMg, lastLogged: e.timeLocal });
    }
  }
  return out;
}

// ── Writes ───────────────────────────────────────────────────────────────────
const TIME_LOCAL = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const FOOD_NAME = /^users\/me\/dataTypes\/food\/dataPoints\/[^/]+$/;
const UNIT_NAME = /^users\/me\/dataTypes\/food-measurement-unit\/dataPoints\/[^/]+$/;

function checkNum(v: unknown, label: string, max: number, required = false): number | undefined {
  if (v === undefined || v === null || v === "") {
    if (required) throw new FoodInputError(`${label} is required`);
    return undefined;
  }
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > max) throw new FoodInputError(`${label} must be between 0 and ${max}`);
  return v;
}

/** Validate untrusted input into a NewFoodLogEntry. */
export function parseEntry(body: unknown): NewFoodLogEntry {
  const b = (body ?? {}) as Loose;
  if (!(LOG_MEAL_TYPES as readonly string[]).includes(b.mealType)) throw new FoodInputError(`mealType must be one of ${LOG_MEAL_TYPES.join(", ")}`);
  if (typeof b.timeLocal !== "string" || !TIME_LOCAL.test(b.timeLocal)) throw new FoodInputError("timeLocal must be YYYY-MM-DDTHH:mm");
  if (typeof b.utcOffsetSeconds !== "number" || Math.abs(b.utcOffsetSeconds) > 14 * 3600) throw new FoodInputError("utcOffsetSeconds is required");
  const base = { mealType: b.mealType, timeLocal: b.timeLocal, utcOffsetSeconds: Math.round(b.utcOffsetSeconds) };
  const utc = Date.parse(`${b.timeLocal}:00Z`) - base.utcOffsetSeconds * 1000;
  if (utc > Date.now() + 24 * 3600_000) throw new FoodInputError("Time can't be more than a day in the future");

  if (b.kind === "food") {
    if (typeof b.food !== "string" || !FOOD_NAME.test(b.food)) throw new FoodInputError("food must be a food resource name");
    if (typeof b.unit !== "string" || !UNIT_NAME.test(b.unit)) throw new FoodInputError("unit must be a food-measurement-unit resource name");
    const amount = checkNum(b.amount, "Amount", 10_000, true)!;
    if (amount <= 0) throw new FoodInputError("Amount must be more than 0");
    return { ...base, kind: "food", food: b.food, unit: b.unit, amount };
  }
  if (b.kind === "quick") {
    const displayName = typeof b.displayName === "string" ? b.displayName.trim() : "";
    if (!displayName || displayName.length > 100) throw new FoodInputError("Name is required (up to 100 characters)");
    return {
      ...base, kind: "quick", displayName,
      kcal: checkNum(b.kcal, "Calories", 10_000, true)!,
      proteinG: checkNum(b.proteinG, "Protein", 1000),
      carbsG: checkNum(b.carbsG, "Carbs", 1000),
      fatG: checkNum(b.fatG, "Fat", 1000),
      fiberG: checkNum(b.fiberG, "Fiber", 1000),
      sugarG: checkNum(b.sugarG, "Sugar", 1000),
      sodiumMg: checkNum(b.sodiumMg, "Sodium", 50_000),
    };
  }
  throw new FoodInputError('kind must be "food" or "quick"');
}

/**
 * Google ignores client-chosen data point IDs (verified live 2026-11-08), so a
 * retried create could duplicate an entry whose first attempt actually landed.
 * Instead each new entry gets a random millisecond offset inside its minute
 * (invisible in the UI). The exact startTime is then a fingerprint the retry
 * queue checks for before re-sending.
 */
export function fingerprintStart(e: NewFoodLogEntry): string {
  const minute = Date.parse(`${e.timeLocal}:00Z`) - e.utcOffsetSeconds * 1000;
  return new Date(minute + 1 + Math.floor(Math.random() * 59_998)).toISOString();
}

function toNutritionLog(e: NewFoodLogEntry, startTime = fingerprintStart(e)): Loose {
  const start = new Date(startTime);
  const offset = `${e.utcOffsetSeconds}s`;
  const interval = { startTime: start.toISOString(), startUtcOffset: offset, endTime: new Date(start.getTime() + 60_000).toISOString(), endUtcOffset: offset };
  if (e.kind === "food") {
    return { interval, mealType: e.mealType, food: e.food, serving: { foodMeasurementUnit: e.unit, amount: e.amount } };
  }
  const nutrients: Loose[] = [];
  const add = (nutrient: string, grams: number | undefined) => grams !== undefined && nutrients.push({ nutrient, quantity: { grams } });
  add("PROTEIN", e.proteinG);
  add("DIETARY_FIBER", e.fiberG);
  add("SUGAR", e.sugarG);
  add("SODIUM", e.sodiumMg !== undefined ? e.sodiumMg / 1000 : undefined);
  return {
    interval, mealType: e.mealType, foodDisplayName: e.displayName, energy: { kcal: e.kcal },
    ...(e.carbsG !== undefined ? { totalCarbohydrate: { grams: e.carbsG } } : {}),
    ...(e.fatG !== undefined ? { totalFat: { grams: e.fatG } } : {}),
    ...(nutrients.length ? { nutrients } : {}),
  };
}

async function created(op: Loose): Promise<FoodLogEntry> {
  const dp = op?.response as DataPoint | undefined;
  if (!op?.done || !dp?.name) throw new Error(`Unexpected response from Google: ${JSON.stringify(op).slice(0, 300)}`);
  const entry = mapEntry(dp, await unitsIfNeeded([dp]));
  if (!entry) throw new Error("Google returned an entry without a time interval");
  return entry;
}

/** Errors worth retrying later: Google 5xx / 429, network failures, or an expired sign-in. */
function isTransient(err: unknown): boolean {
  if (err instanceof ReauthRequiredError) return true;
  if (err instanceof HealthApiError) return err.status >= 500 || err.status === 429;
  return err instanceof TypeError; // fetch() network failure
}

function toPendingInfo(r: PendingRow<NewFoodLogEntry>): PendingFoodWrite {
  return { id: r.id, label: r.label, timeLocal: r.entry.timeLocal, attempts: r.attempts, lastError: r.lastError, failed: r.failed, nextAttemptAt: new Date(r.nextAttemptAt).toISOString() };
}

const entryLabel = async (e: NewFoodLogEntry) =>
  e.kind === "quick" ? e.displayName : await getFood(e.food).then((f) => f.displayName, () => "Food");

/**
 * Create an entry. If Google is unavailable (5xx/429/network) or the sign-in
 * has expired, the entry is stored in the retry queue instead of being lost.
 */
export async function createEntry(e: NewFoodLogEntry): Promise<CreateResult> {
  const startTime = fingerprintStart(e);
  try {
    const op = await createDataPoint("nutrition-log", { nutritionLog: toNutritionLog(e, startTime) });
    await platform().cache.invalidateType("nutrition-log");
    return { status: "saved", entry: await created(op as Loose) };
  } catch (err) {
    if (!isTransient(err)) throw err;
    const pending = platform().pending;
    const id = await pending.enqueue(e, startTime, await entryLabel(e), (err as Error).message);
    platform().log.warn(`[food] queued entry ${id} for retry: ${(err as Error).message}`);
    const row = (await pending.list<NewFoodLogEntry>()).find((r) => r.id === id)!;
    return { status: "queued", pending: toPendingInfo(row) };
  }
}

export const listPendingWrites = async () => (await platform().pending.list<NewFoodLogEntry>()).map(toPendingInfo);
export const discardPendingWrite = (id: string) => platform().pending.remove(id, true);

/** True if this app already wrote a nutrition log with exactly this start time (a "lost" success). */
async function alreadyWritten(e: NewFoodLogEntry, startTime: string): Promise<boolean> {
  const date = e.timeLocal.slice(0, 10);
  const target = Date.parse(startTime);
  // Widen by a day each side: the UTC instant can fall on a neighbouring civil date.
  const res = await getPoints(NUTRITION_LOG, { start: addDays(date, -1), end: addDays(date, 2), source: SOURCE_FAMILIES.self, fresh: true });
  return res.value.dataPoints.some((p) => Date.parse((p.nutritionLog as Loose | undefined)?.interval?.startTime ?? "") === target);
}

let processing = false;
/** Retry due queue entries. Runs on a timer and on demand. */
export async function processPendingWrites(): Promise<{ sent: number; remaining: number }> {
  const pending = platform().pending;
  if (processing) return { sent: 0, remaining: (await pending.due()).length };
  processing = true;
  let sent = 0;
  try {
    for (const row of await pending.due<NewFoodLogEntry>()) {
      try {
        if (!(await alreadyWritten(row.entry, row.startTime))) {
          await createDataPoint("nutrition-log", { nutritionLog: toNutritionLog(row.entry, row.startTime) });
        }
        await pending.remove(row.id, false);
        await platform().cache.invalidateType("nutrition-log");
        sent++;
        platform().log.info(`[food] synced queued entry ${row.id} (${row.label})`);
      } catch (err) {
        if (err instanceof ReauthRequiredError) break; // nothing will work until the user signs in again
        await pending.markAttempt(row.id, (err as Error).message, !isTransient(err), row.attempts + 1);
      }
    }
  } finally {
    processing = false;
  }
  return { sent, remaining: (await pending.due()).length };
}

export async function retryAllPending(includeFailed: boolean) {
  await platform().pending.makeDueNow(includeFailed);
  return processPendingWrites();
}

const ENTRY_NAME = /^users\/me\/dataTypes\/nutrition-log\/dataPoints\/[^/]+$/;
async function getOwnEntry(id: string): Promise<DataPoint> {
  if (!ENTRY_NAME.test(id)) throw new FoodInputError("Invalid entry id");
  const dp = await healthFetch<DataPoint>(`/${id}`);
  if (!isOurs(dp)) throw new NotEditableError();
  return dp;
}

/**
 * Update an entry this app wrote. Food-based entries are patched in place;
 * quick-add entries (or switching kinds) are replaced: create first, then
 * delete the original, so a failure never loses the entry.
 */
export async function updateEntry(id: string, e: NewFoodLogEntry): Promise<FoodLogEntry> {
  const existing = await getOwnEntry(id);
  const wasFood = Boolean((existing.nutritionLog as Loose | undefined)?.food);
  let result: FoodLogEntry;
  if (wasFood && e.kind === "food") {
    result = await created((await patchDataPoint(id, { nutritionLog: toNutritionLog(e) })) as Loose);
  } else {
    result = await created((await createDataPoint("nutrition-log", { nutritionLog: toNutritionLog(e) })) as Loose);
    await batchDeleteDataPoints([id]);
  }
  await platform().cache.invalidateType("nutrition-log");
  return result;
}

export async function deleteEntry(id: string): Promise<void> {
  await getOwnEntry(id);
  await batchDeleteDataPoints([id]);
  await platform().cache.invalidateType("nutrition-log");
}
