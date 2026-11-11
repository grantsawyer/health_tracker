import { beforeEach, describe, expect, it } from "vitest";
import { createEntry, deleteEntry, getDay, getMyFoods, getRecents, parseEntry, updateEntry } from "../../core/food.js";
import { getGoals, goalsSaved } from "../../core/goals.js";
import { addDays } from "../../core/healthClient.js";
import { productByBarcode, searchFoods } from "../../core/openFoodFacts.js";
import { platform } from "../../core/platform.js";
import { buildSummary } from "../../core/summary.js";
import { DEMO_CLIENT_ID, localDate, offsetOf } from "../../src/demo/data.js";
import { createDemoRuntime } from "../../src/demo/demoRuntime.js";
import { REQUESTED_SCOPES } from "../../shared/scopes.js";

/** The demo (S6) runs the app's real core/ code on synthetic data; these check that every screen's data is there. */

const today = localDate();
const yesterday = addDays(today, -1);
const at = (date: string, hhmm: string) => {
  const t = `${date}T${hhmm}`;
  return { timeLocal: t, utcOffsetSeconds: Number(offsetOf(new Date(`${t}:00`)).replace(/s$/, "")) };
};

beforeEach(() => {
  createDemoRuntime(); // registers a fresh demo platform
});

describe("demo", () => {
  it("is signed in with every Health scope and makes no real network calls", () => {
    const rt = createDemoRuntime();
    expect(rt.auth?.session()?.scopes).toEqual(REQUESTED_SCOPES);
    expect(rt.clientId).toBe(DEMO_CLIENT_ID);
    return expect(platform().fetch("https://example.org/")).rejects.toThrow(/no network access/);
  });

  it("fills every dashboard for the last 90 days, the same on every load", async () => {
    const start = addDays(today, -90);
    const s = await buildSummary(start, addDays(today, 1), false, new Set(REQUESTED_SCOPES));
    expect(s.errors).toEqual({});
    const past = s.days.filter((d) => d.date < today);
    expect(past).toHaveLength(90);
    for (const d of past) {
      expect(d.steps).toBeGreaterThan(1000);
      expect(d.heartRate?.min).toBeLessThan(d.heartRate!.max);
      expect(d.restingHr).toBeGreaterThan(40);
      expect(d.azm).toBeDefined();
      expect(d.activeMinutes).toBeDefined();
      expect(d.caloriesOut).toBeGreaterThan(1500);
      expect(d.nutrition?.kcal).toBeGreaterThan(0);
    }
    expect(past.filter((d) => d.weightKg !== undefined).length).toBeGreaterThan(40); // weighed most days, not all
    expect(s.sleep.length).toBeGreaterThanOrEqual(89);
    for (const n of s.sleep) {
      expect(n.minutesAsleep).toBeGreaterThan(300);
      expect(n.segments.length).toBeGreaterThan(10);
      expect(n.stages.deep + n.stages.light + n.stages.rem + n.stages.awake).toBe(n.minutesInBed);
    }
    expect(s.exercise.length).toBeGreaterThan(25);

    createDemoRuntime();
    const again = await buildSummary(start, addDays(today, 1), false, new Set(REQUESTED_SCOPES));
    expect(again.days.filter((d) => d.date < today)).toEqual(past);
  });

  it("starts with goals saved, so the first-run card doesn't show", async () => {
    expect(await goalsSaved()).toBe(true);
    expect((await getGoals()).bedtime).toBe(23 * 60);
  });

  it("logs, edits and deletes food, and only this app's entries are editable", async () => {
    const day = await getDay(yesterday);
    expect(day.entries.length).toBeGreaterThan(1);
    const before = day.entries.filter((e) => e.editable).length;

    const quick = await createEntry(parseEntry({ kind: "quick", mealType: "SNACK", ...at(yesterday, "10:15"), displayName: "Synthetic snack", kcal: 150, proteinG: 5 }));
    expect(quick.status).toBe("saved");
    const quickId = quick.status === "saved" ? quick.entry.id : "";

    const [oats] = (await getMyFoods()).filter((f) => f.displayName.startsWith("Rolled oats"));
    expect(oats).toBeDefined();
    const logged = await createEntry(parseEntry({ kind: "food", mealType: "BREAKFAST", ...at(yesterday, "07:05"), food: oats!.name, unit: oats!.defaultServing.unit, amount: 2 }));
    expect(logged.status === "saved" && logged.entry.kcal).toBe(oats!.kcal! * 2);
    const loggedId = logged.status === "saved" ? logged.entry.id : "";

    // Logs against a food are patched; quick adds are replaced (as with Google).
    const edited = await updateEntry(loggedId, parseEntry({ kind: "food", mealType: "BREAKFAST", ...at(yesterday, "07:05"), food: oats!.name, unit: oats!.defaultServing.unit, amount: 1 }));
    expect(edited.id).toBe(loggedId);
    expect(edited.kcal).toBe(oats!.kcal);
    const replaced = await updateEntry(quickId, parseEntry({ kind: "quick", mealType: "SNACK", ...at(yesterday, "10:15"), displayName: "Synthetic snack", kcal: 200 }));
    expect(replaced.kcal).toBe(200);

    await deleteEntry(loggedId);
    const after = await getDay(yesterday, true);
    expect(after.entries.filter((e) => e.editable)).toHaveLength(before + 1);
    expect((await getRecents(today)).length).toBeGreaterThan(3);

    const other = (await getDay(addDays(today, -40))).entries.length + (await getDay(addDays(today, -41))).entries.length;
    expect(other).toBeGreaterThan(0);
  });

  it("searches and scans synthetic Open Food Facts products", async () => {
    const hits = await searchFoods("yogurt");
    expect(hits.map((h) => h.name)).toContain("Greek-style yogurt");
    const p = await productByBarcode("2000000000015");
    expect(p?.perServing?.kcal).toBe(110) // 73 kcal per 100 g × 150 g, rounded by core;
    expect(await productByBarcode("2000000000999")).toBeNull();
  });
});
