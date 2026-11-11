import { beforeEach, describe, expect, it } from "vitest";
import {
  FoodInputError, NotEditableError, createEntry, deleteEntry, fingerprintStart, getDay, getMyFoods, getRecents,
  listPendingWrites, parseEntry, processPendingWrites, updateEntry,
} from "../../core/food.js";
import { platform } from "../../core/platform.js";
import type { NewFoodLogEntry } from "../../shared/food.js";
import { done, fakeFetch, json } from "../helpers/fakeGoogle.js";
import { GRAM, OZ, USER, foodPoint, nutritionLog, signIn } from "../helpers/fixtures.js";

const LOGS = /\/nutrition-log\/dataPoints$/;
const ENTRY = (id: string) => `users/me/dataTypes/nutrition-log/dataPoints/${id}`;
const quick = (over: Partial<NewFoodLogEntry> = {}): NewFoodLogEntry =>
  ({ kind: "quick", displayName: "Turkey sandwich", kcal: 388, proteinG: 30, carbsG: 40, fatG: 12, sodiumMg: 900, mealType: "LUNCH", timeLocal: "2026-11-07T12:30", utcOffsetSeconds: -18000, ...over }) as NewFoodLogEntry;
const foodEntry = (over: Partial<NewFoodLogEntry> = {}): NewFoodLogEntry =>
  ({ kind: "food", food: "users/me/dataTypes/food/dataPoints/42", unit: OZ, amount: 2, mealType: "DINNER", timeLocal: "2026-11-07T19:00", utcOffsetSeconds: -18000, ...over }) as NewFoodLogEntry;

beforeEach(async () => {
  signIn();
  await platform().cache.clear();
});

describe("parseEntry (untrusted input)", () => {
  const base = { mealType: "LUNCH", timeLocal: "2026-11-07T12:30", utcOffsetSeconds: -18000 };
  it("accepts a valid quick add and drops unknown fields", () => {
    const e = parseEntry({ ...base, kind: "quick", displayName: "  Soup ", kcal: 120, extra: "x" });
    expect(e).toEqual({ ...base, kind: "quick", displayName: "Soup", kcal: 120, proteinG: undefined, carbsG: undefined, fatG: undefined, fiberG: undefined, sugarG: undefined, sodiumMg: undefined });
  });
  it.each([
    [{ ...base, kind: "quick", displayName: "", kcal: 1 }, /Name is required/],
    [{ ...base, kind: "quick", displayName: "x", kcal: -1 }, /Calories must be between/],
    [{ ...base, kind: "quick", displayName: "x" }, /Calories is required/],
    [{ ...base, kind: "quick", displayName: "x", kcal: "100" }, /Calories must be between/],
    [{ ...base, kind: "quick", displayName: "x".repeat(101), kcal: 1 }, /Name is required/],
    [{ ...base, mealType: "BRUNCH", kind: "quick", displayName: "x", kcal: 1 }, /mealType/],
    [{ ...base, timeLocal: "2026-11-07 12:30", kind: "quick", displayName: "x", kcal: 1 }, /timeLocal/],
    [{ ...base, timeLocal: "2099-01-01T00:00", kind: "quick", displayName: "x", kcal: 1 }, /future/],
    [{ ...base, kind: "food", food: "users/me/dataTypes/food/dataPoints/1", unit: OZ, amount: 0 }, /more than 0/],
    [{ ...base, kind: "food", food: "../../etc", unit: OZ, amount: 1 }, /food must be/],
    [{ ...base, kind: "food", food: "users/me/dataTypes/food/dataPoints/1", unit: "oz", amount: 1 }, /unit must be/],
    [{ ...base, kind: "other" }, /kind must be/],
  ])("rejects %j", (input, msg) => {
    expect(() => parseEntry(input)).toThrowError(msg);
    expect(() => parseEntry(input)).toThrowError(FoodInputError);
  });
});

describe("fingerprintStart", () => {
  it("stays inside the chosen local minute and varies between calls", () => {
    const e = quick({ timeLocal: "2026-11-07T12:30", utcOffsetSeconds: -18000 });
    const minuteUtc = Date.parse("2026-11-07T17:30:00Z");
    const samples = Array.from({ length: 50 }, () => Date.parse(fingerprintStart(e)));
    expect(samples.every((t) => t > minuteUtc && t < minuteUtc + 60_000)).toBe(true);
    expect(new Set(samples).size).toBeGreaterThan(40);
  });
});

describe("getDay", () => {
  it("maps entries, marks only this app's entries editable, and totals the day", async () => {
    fakeFetch()
      .on("GET", LOGS, () => json({ dataPoints: [
        nutritionLog({ id: "1", start: "2026-11-07T20:00:00Z", name: "Green tea", kcal: 5, carbsG: 1, fatG: 0, food: `${USER}/dataTypes/food/dataPoints/7`, serving: { amount: 8, label: "oz" }, mealType: "ANYTIME" }),
        nutritionLog({ id: "2", start: "2026-11-07T17:30:12.345Z", name: "Turkey sandwich", kcal: 388, proteinG: 30, carbsG: 40, fatG: 12, sodiumG: 0.9, ours: true }),
        nutritionLog({ id: "3", start: "2026-11-08T03:00:00Z", name: "Late snack", kcal: 100, serving: { amount: 2, unit: OZ }, ours: true, food: `${USER}/dataTypes/food/dataPoints/8` }),
      ] }))
      .on("GET", /\/food-measurement-unit\/dataPoints$/, () => json({ dataPoints: [{ name: `${USER}/dataTypes/food-measurement-unit/dataPoints/226`, foodMeasurementUnit: { displayName: "oz", pluralDisplayName: "oz" } }] }));
    const day = await getDay("2026-11-07");
    expect(day.entries.map((e) => [e.timeLocal, e.displayName, e.editable])).toEqual([
      ["2026-11-07T12:30", "Turkey sandwich", true],
      ["2026-11-07T15:00", "Green tea", false],
      ["2026-11-07T22:00", "Late snack", true],
    ]);
    const [sandwich, tea, late] = day.entries;
    expect(sandwich).toMatchObject({ id: ENTRY("2"), sodiumMg: 900, source: "Health Tracker" });
    expect(tea).toMatchObject({ mealType: "ANYTIME", food: "users/me/dataTypes/food/dataPoints/7", serving: { amount: 8, label: "oz" }, source: "Fitbit" });
    // unit label recovered from the units catalog when Google omits the display name
    expect(late!.serving).toEqual({ amount: 2, unit: OZ, label: "oz" });
    expect(day.totals).toEqual({ kcal: 493, proteinG: 30, carbsG: 41, fatG: 12 });
  });
});

describe("getMyFoods", () => {
  it("returns private foods and stops paging at the first page with public foods", async () => {
    const g = fakeFetch()
      .on("GET", /\/food\/dataPoints$/, () => json({ dataPoints: [foodPoint({ id: "2", name: "Green tea" }), foodPoint({ id: "1", name: "Apple" })], nextPageToken: "p2" }), 1)
      .on("GET", /\/food\/dataPoints$/, () => json({ dataPoints: [foodPoint({ id: "3", name: "Yogurt" }), foodPoint({ id: "99", name: "Public apple", access: "PUBLIC" })], nextPageToken: "p3" }), 1);
    const foods = await getMyFoods(true);
    expect(foods.map((f) => f.displayName)).toEqual(["Apple", "Green tea", "Yogurt"]);
    expect(g.calls).toHaveLength(2); // never requests p3
    expect(g.calls[0]!.url.searchParams.get("pageSize")).toBe("25");
    expect(foods[0]).toMatchObject({ name: "users/me/dataTypes/food/dataPoints/1", kcal: 50, proteinG: 5, defaultServing: { unit: OZ, label: "oz", amount: 1 } });
    expect(foods[0]!.servings.map((s) => s.label)).toEqual(["gram", "oz"]);
  });
});

describe("getRecents", () => {
  it("dedupes by food (or name + kcal), newest first, and recovers unit ids from the food", async () => {
    fakeFetch()
      .on("GET", LOGS, () => json({ dataPoints: [
        nutritionLog({ id: "a", start: "2026-11-01T12:00:00Z", name: "Rice", kcal: 80, food: `${USER}/dataTypes/food/dataPoints/42`, serving: { amount: 2, label: "oz" } }),
        nutritionLog({ id: "b", start: "2026-11-07T12:00:00Z", name: "Rice", kcal: 40, food: `${USER}/dataTypes/food/dataPoints/42`, serving: { amount: 1, label: "oz" } }),
        nutritionLog({ id: "c", start: "2026-11-06T12:00:00Z", name: "Hummus", kcal: 70 }),
        nutritionLog({ id: "d", start: "2026-11-05T12:00:00Z", name: "hummus", kcal: 70 }),
        nutritionLog({ id: "e", start: "2026-11-04T12:00:00Z", name: "Hummus", kcal: 35 }),
      ] }))
      .on("GET", /\/food\/dataPoints\/42$/, () => json(foodPoint({ id: "42", name: "Rice" })));
    const r = await getRecents("2026-11-08");
    expect(r.map((x) => [x.kind, x.displayName, x.kcal])).toEqual([
      ["food", "Rice", 40],
      ["quick", "Hummus", 70],
      ["quick", "Hummus", 35],
    ]);
    expect(r[0]).toMatchObject({ food: "users/me/dataTypes/food/dataPoints/42", amount: 1, unit: OZ, label: "oz" });
  });
});

describe("createEntry", () => {
  it("sends a quick add as an anonymous log with grams (sodium mg → g)", async () => {
    const g = fakeFetch().on("POST", LOGS, (req) => done({ name: `${USER}/dataTypes/nutrition-log/dataPoints/55`, dataSource: { application: { googleWebClientId: "123456789012-testclientid.apps.googleusercontent.com" } }, nutritionLog: req.body.nutritionLog }));
    const res = await createEntry(quick());
    expect(res.status).toBe("saved");
    const log = g.calls[0]!.body.nutritionLog;
    expect(log).toMatchObject({
      mealType: "LUNCH", foodDisplayName: "Turkey sandwich", energy: { kcal: 388 }, totalCarbohydrate: { grams: 40 }, totalFat: { grams: 12 },
      nutrients: [{ nutrient: "PROTEIN", quantity: { grams: 30 } }, { nutrient: "SODIUM", quantity: { grams: 0.9 } }],
    });
    expect(log.interval.startUtcOffset).toBe("-18000s");
    expect(Date.parse(log.interval.endTime) - Date.parse(log.interval.startTime)).toBe(60_000);
    expect(log.interval.startTime.slice(0, 16)).toBe("2026-11-07T17:30");
    if (res.status === "saved") expect(res.entry).toMatchObject({ id: ENTRY("55"), editable: true, sodiumMg: 900 });
  });

  it("sends a library food as food + serving and lets Google compute nutrition", async () => {
    const g = fakeFetch().on("POST", LOGS, (req) => done({ name: `${USER}/dataTypes/nutrition-log/dataPoints/56`, nutritionLog: { ...req.body.nutritionLog, energy: { kcal: 112 } } }));
    await createEntry(foodEntry());
    expect(g.calls[0]!.body.nutritionLog).toMatchObject({ food: "users/me/dataTypes/food/dataPoints/42", serving: { foodMeasurementUnit: OZ, amount: 2 }, mealType: "DINNER" });
    expect(g.calls[0]!.body.nutritionLog.energy).toBeUndefined();
  });

  it.each([
    ["Google 503", () => json({ error: { message: "unavailable" } }, 503)],
    ["Google 429", () => json({ error: { message: "slow down" } }, 429)],
    ["network failure", () => { throw new TypeError("fetch failed"); }],
  ])("queues the entry on %s", async (_label, fail) => {
    fakeFetch().on("POST", LOGS, fail as () => Response);
    const res = await createEntry(quick({ displayName: `Queued ${_label}` }));
    expect(res.status).toBe("queued");
    expect((await listPendingWrites()).some((p) => p.label === `Queued ${_label}`)).toBe(true);
  });

  it("does not queue on a permanent error (400)", async () => {
    fakeFetch().on("POST", LOGS, () => json({ error: { message: "The request is invalid." } }, 400));
    const before = (await listPendingWrites()).length;
    await expect(createEntry(quick())).rejects.toThrow(/invalid/);
    expect((await listPendingWrites())).toHaveLength(before);
  });
});

describe("processPendingWrites", () => {
  async function queueOne(name: string) {
    fakeFetch().on("POST", LOGS, () => json({ error: { message: "unavailable" } }, 503));
    await createEntry(quick({ displayName: name }));
    await platform().pending.makeDueNow(false);
    return (await listPendingWrites()).find((p) => p.label === name)!;
  }

  it("re-sends a queued entry with the same fingerprinted start time", async () => {
    const p = await queueOne("Retry me");
    let sentStart = "";
    const g = fakeFetch()
      .on("GET", LOGS, () => json({ dataPoints: [] }))
      .on("POST", LOGS, (req) => { sentStart = req.body.nutritionLog.interval.startTime; return done({ name: `${USER}/dataTypes/nutrition-log/dataPoints/77` }); });
    const r = await processPendingWrites();
    expect(r.sent).toBeGreaterThanOrEqual(1);
    expect((await listPendingWrites()).find((x) => x.id === p.id)).toBeUndefined();
    expect(g.to(LOGS, "GET")[0]!.url.searchParams.get("dataSourceFamily")).toBe("users/me/dataSourceFamilies/self-sources");
    expect(sentStart.slice(0, 16)).toBe("2026-11-07T17:30");
  });

  it("does NOT re-send when the first attempt actually landed (lost response)", async () => {
    const p = await queueOne("Lost response");
    // Google already has a self-written entry with the queued entry's exact fingerprinted startTime.
    const rows = await platform().pending.due<NewFoodLogEntry>();
    let posted = 0;
    fakeFetch()
      .on("GET", LOGS, () => json({ dataPoints: rows.map((r, i) => nutritionLog({ id: `x${i}`, start: r.startTime, name: r.label, kcal: 1, ours: true })) }))
      .on("POST", LOGS, () => { posted++; return done({ name: "unused" }); });
    const r = await processPendingWrites();
    expect(posted).toBe(0);
    expect(r.sent).toBe(rows.length);
    expect((await listPendingWrites()).find((x) => x.id === p.id)).toBeUndefined();
  });

  it("marks entries failed (no more automatic retries) on a permanent error", async () => {
    const p = await queueOne("Will be rejected");
    fakeFetch()
      .on("GET", LOGS, () => json({ dataPoints: [] }))
      .on("POST", LOGS, () => json({ error: { message: "The request is invalid." } }, 400));
    await processPendingWrites();
    expect((await listPendingWrites()).find((x) => x.id === p.id)).toMatchObject({ failed: true, attempts: 2 });
  });
});

describe("updateEntry / deleteEntry", () => {
  const own = (id: string, extra: Partial<Parameters<typeof nutritionLog>[0]> = {}) =>
    nutritionLog({ id, start: "2026-11-07T17:30:00Z", name: "Mine", kcal: 10, ours: true, ...extra });

  it("patches food-based entries in place", async () => {
    const g = fakeFetch()
      .on("GET", /\/dataPoints\/10$/, () => json(own("10", { food: `${USER}/dataTypes/food/dataPoints/42`, serving: { amount: 1, unit: OZ } })))
      .on("PATCH", /\/dataPoints\/10$/, (req) => done({ name: `${USER}/dataTypes/nutrition-log/dataPoints/10`, nutritionLog: req.body.nutritionLog }));
    const e = await updateEntry(ENTRY("10"), foodEntry({ amount: 3, unit: GRAM }));
    expect(e.id).toBe(ENTRY("10"));
    expect(g.to(/:batchDelete$/)).toHaveLength(0);
    expect(g.to(/\/dataPoints\/10$/, "PATCH")[0]!.body.nutritionLog.serving).toEqual({ foodMeasurementUnit: GRAM, amount: 3 });
  });

  it("replaces quick adds: create the new entry first, then delete the old one", async () => {
    const order: string[] = [];
    fakeFetch()
      .on("GET", /\/dataPoints\/11$/, () => json(own("11")))
      .on("POST", LOGS, () => { order.push("create"); return done({ name: `${USER}/dataTypes/nutrition-log/dataPoints/12`, nutritionLog: own("12").nutritionLog }); })
      .on("POST", /:batchDelete$/, (req) => { order.push(`delete ${req.body.names}`); return done({}); });
    const e = await updateEntry(ENTRY("11"), quick({ kcal: 20 }));
    expect(order).toEqual(["create", `delete ${ENTRY("11")}`]);
    expect(e.id).toBe(ENTRY("12"));
  });

  it("if creating the replacement fails, the original is not deleted", async () => {
    const g = fakeFetch()
      .on("GET", /\/dataPoints\/13$/, () => json(own("13")))
      .on("POST", LOGS, () => json({ error: { message: "boom" } }, 500))
      .on("POST", /:batchDelete$/, () => done({}));
    await expect(updateEntry(ENTRY("13"), quick())).rejects.toThrow(/boom/);
    expect(g.to(/:batchDelete$/)).toHaveLength(0);
  });

  it("refuses to edit or delete entries written by another app", async () => {
    const g = fakeFetch()
      .on("GET", /\/dataPoints\/20$/, () => json(nutritionLog({ id: "20", start: "2026-11-07T17:30:00Z", name: "From Fitbit", kcal: 50 })))
      .on("POST", /:batchDelete$/, () => done({}));
    await expect(updateEntry(ENTRY("20"), quick())).rejects.toBeInstanceOf(NotEditableError);
    await expect(deleteEntry(ENTRY("20"))).rejects.toBeInstanceOf(NotEditableError);
    expect(g.to(/:batchDelete$/)).toHaveLength(0);
  });

  it("deletes the app's own entry", async () => {
    const g = fakeFetch()
      .on("GET", /\/dataPoints\/21$/, () => json(own("21")))
      .on("POST", /:batchDelete$/, () => done({}));
    await deleteEntry(ENTRY("21"));
    expect(g.to(/:batchDelete$/)[0]!.body.names).toEqual([ENTRY("21")]);
  });

  it("rejects malformed entry ids before calling Google", async () => {
    const g = fakeFetch();
    await expect(deleteEntry("users/me/dataTypes/steps/dataPoints/1")).rejects.toBeInstanceOf(FoodInputError);
    expect(g.calls).toHaveLength(0);
  });
});
