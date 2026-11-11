import { beforeEach, describe, expect, it } from "vitest";
import { buildSummary, civilToDate, mapExercise, mapSleep, toLocal } from "../../core/summary.js";
import { fullScope } from "../../shared/scopes.js";
import { fakeFetch, json } from "../helpers/fakeGoogle.js";
import { ALL_SCOPES, exercisePoint, rollupDay, signIn, sleepPoint } from "../helpers/fixtures.js";

describe("time helpers", () => {
  it("toLocal applies the UTC offset to get wall-clock time", () => {
    expect(toLocal("2026-11-07T04:00:00Z", "-18000s")).toBe("2026-11-06T23:00");
    expect(toLocal("2026-10-30T09:00:00Z", "-14400s")).toBe("2026-10-30T05:00"); // EDT, before DST ended
    expect(toLocal("2026-11-07T04:00:00Z", undefined)).toBe("2026-11-07T04:00");
  });
  it("civilToDate zero-pads", () => {
    expect(civilToDate({ date: { year: 2026, month: 3, day: 9 } })).toBe("2026-03-09");
  });
});

describe("mapSleep", () => {
  it("dates a night by its local wake-up day and buckets stages", () => {
    const s = mapSleep(sleepPoint({ id: "1", start: "2026-11-07T04:00:00Z", end: "2026-11-07T10:00:00Z", asleep: 330, awake: 30, stages: { DEEP: 70, LIGHT: 180, REM: 80, AWAKE: 30 } }) as any)!;
    expect(s).toMatchObject({
      date: "2026-11-07", startLocal: "2026-11-06T23:00", endLocal: "2026-11-07T05:00", isNap: false,
      minutesAsleep: 330, minutesAwake: 30, minutesInBed: 360, device: "Test Watch",
      stages: { deep: 70, light: 180, rem: 80, awake: 30, asleep: 0, restless: 0 },
    });
  });
  it("builds the stage timeline in minutes from the session start", () => {
    const p = sleepPoint({ id: "3", start: "2026-11-08T05:00:00Z", end: "2026-11-08T11:00:00Z", asleep: 340, awake: 20 }) as any;
    p.sleep.stages = [
      { startTime: "2026-11-08T05:00:00Z", endTime: "2026-11-08T05:05:00Z", type: "AWAKE" },
      { startTime: "2026-11-08T05:05:00Z", endTime: "2026-11-08T05:20:00Z", type: "LIGHT" },
      { startTime: "2026-11-08T05:20:00Z", endTime: "2026-11-08T05:50:00Z", type: "DEEP" },
      { startTime: "2026-11-08T05:50:00Z", endTime: "2026-11-08T05:50:00Z", type: "REM" }, // zero-length: dropped
      { startTime: "2026-11-08T05:50:00Z", endTime: "2026-11-08T06:00:00Z", type: "SOMETHING_NEW" }, // unknown: dropped
    ];
    expect(mapSleep(p)!.segments).toEqual([
      { stage: "awake", from: 0, to: 5 },
      { stage: "light", from: 5, to: 20 },
      { stage: "deep", from: 20, to: 50 },
    ]);
    expect(mapSleep(sleepPoint({ id: "4", start: "2026-11-08T05:00:00Z", end: "2026-11-08T11:00:00Z", asleep: 1, awake: 1 }) as any)!.segments).toEqual([]);
  });

  it("flags naps (nap without mainSleep)", () => {
    expect(mapSleep(sleepPoint({ id: "2", start: "2026-11-07T13:00:00Z", end: "2026-11-07T13:30:00Z", asleep: 20, awake: 10, nap: true }) as any)!.isNap).toBe(true);
  });
  it("returns null for points without a sleep interval", () => {
    expect(mapSleep({ name: "x" })).toBeNull();
  });
});

describe("mapExercise", () => {
  it("prefers activeDuration, converts mm → km and parses string metrics", () => {
    const e = mapExercise(exercisePoint({
      id: "9", start: "2026-11-07T17:40:00Z", end: "2026-11-07T18:30:00Z", type: "WALKING", name: "Walk", activeSecs: 2700.4,
      metrics: { distanceMillimeters: 2000000, steps: "2500", averageHeartRateBeatsPerMinute: "110", caloriesKcal: 250 },
    }) as any)!;
    expect(e).toMatchObject({ date: "2026-11-07", startLocal: "2026-11-07T12:40", type: "WALKING", displayName: "Walk", durationMin: 45, steps: 2500, avgHr: 110, calories: 250, source: "com.example.fitness" });
    expect(e.distanceKm).toBeCloseTo(2, 6);
  });
  it("falls back to wall-clock duration", () => {
    const e = mapExercise(exercisePoint({ id: "1", start: "2026-11-07T10:00:00Z", end: "2026-11-07T10:30:00Z", type: "WEIGHTLIFTING", name: "Weights" }) as any)!;
    expect(e.durationMin).toBe(30);
    expect(e.distanceKm).toBeUndefined();
  });
});

describe("buildSummary", () => {
  beforeEach(() => signIn());

  /** Fake Google returning one day of every rollup type, plus list types. */
  function fakeAll(overrides: Record<string, () => Response> = {}) {
    const D = "2026-11-06";
    const rollups: Record<string, unknown> = {
      steps: { steps: { countSum: "4321" } },
      distance: { distance: { millimetersSum: "3000000" } },
      floors: { floors: { countSum: "7" } },
      "active-zone-minutes": { activeZoneMinutes: { sumInCardioHeartZone: "20", sumInPeakHeartZone: "5", sumInFatBurnHeartZone: "10" } },
      "active-minutes": { activeMinutes: { activeMinutesRollupByActivityLevel: [{ activityLevel: "LIGHT", activeMinutesSum: "60" }, { activityLevel: "VIGOROUS", activeMinutesSum: "15" }] } },
      "total-calories": { totalCalories: { kcalSum: 2222.5 } },
      "heart-rate": { heartRate: { beatsPerMinuteAvg: 70.5, beatsPerMinuteMax: 150, beatsPerMinuteMin: 50 } },
      weight: { weight: { weightGramsAvg: 70000 } },
      "body-fat": { bodyFat: { bodyFatPercentageAvg: 20.5 } },
      "nutrition-log": { nutritionLog: { nutrients: [{ quantity: { gramsSum: 60 }, nutrient: "PROTEIN" }, { quantity: { gramsSum: 10 }, nutrient: "DIETARY_FIBER" }], energy: { kcalSum: 1500 }, totalCarbohydrate: { gramsSum: 150 }, totalFat: { gramsSum: 50.5 } } },
      "hydration-log": null, // no water logged → no bucket at all (days without data are absent)
    };
    const g = fakeFetch();
    for (const [type, value] of Object.entries(rollups)) {
      g.on("POST", new RegExp(`/${type}/dataPoints:dailyRollUp$`), overrides[type] ?? (() => {
        if (!value) return json({ rollupDataPoints: [] });
        const [field, v] = Object.entries(value as object)[0]!;
        return json({ rollupDataPoints: [rollupDay(D, field, v)] });
      }));
    }
    g.on("GET", /\/daily-resting-heart-rate\/dataPoints$/, overrides["daily-resting-heart-rate"] ?? (() => json({ dataPoints: [{ dailyRestingHeartRate: { date: { year: 2026, month: 11, day: 6 }, beatsPerMinute: "60" } }] })));
    g.on("GET", /\/sleep\/dataPoints$/, () => json({ dataPoints: [sleepPoint({ id: "s1", start: "2026-11-06T05:00:00Z", end: "2026-11-06T11:00:00Z", asleep: 330, awake: 30 })] }));
    g.on("GET", /\/exercise\/dataPoints$/, () => json({ dataPoints: [exercisePoint({ id: "e1", start: "2026-11-06T13:00:00Z", end: "2026-11-06T13:20:00Z", type: "ROWING_MACHINE", name: "Rowing machine" })] }));
    return g;
  }

  it("normalizes every data type into one record per day", async () => {
    fakeAll();
    const s = await buildSummary("2026-11-05", "2026-11-07", true, new Set(ALL_SCOPES));
    expect(s.errors).toEqual({});
    expect(s.days.map((d) => d.date)).toEqual(["2026-11-05", "2026-11-06"]);
    expect(s.days[0]).toEqual({ date: "2026-11-05" }); // no data that day: fields absent, not zero
    const d = s.days[1]!;
    expect(d).toMatchObject({
      steps: 4321, floors: 7, restingHr: 60, bodyFatPct: 20.5,
      azm: { fatBurn: 10, cardio: 20, peak: 5 },
      activeMinutes: { light: 60, moderate: 0, vigorous: 15 },
      heartRate: { avg: 70.5, min: 50, max: 150 },
      nutrition: { kcal: 1500, proteinG: 60, carbsG: 150, fatG: 50.5, fiberG: 10 },
    });
    expect(d.distanceKm).toBeCloseTo(3, 4);
    expect(d.weightKg).toBeCloseTo(70, 3);
    expect(d.caloriesOut).toBeCloseTo(2222.5, 2);
    expect(d.waterMl).toBeUndefined();
    expect(s.sleep).toHaveLength(1);
    expect(s.sleep[0]!.date).toBe("2026-11-06");
    expect(s.exercise[0]!.type).toBe("ROWING_MACHINE");
    expect(s.cached).toBe(false);
  });

  it("serves the second identical request from cache", async () => {
    const g = fakeAll();
    await buildSummary("2026-11-05", "2026-11-07", false, new Set(ALL_SCOPES));
    const before = g.calls.length;
    const again = await buildSummary("2026-11-05", "2026-11-07", false, new Set(ALL_SCOPES));
    expect(g.calls.length).toBe(before);
    expect(again.cached).toBe(true);
  });

  it("one failing type is reported in errors while the rest still load", async () => {
    fakeAll({ "heart-rate": () => json({ error: { code: 500, message: "boom" } }, 500) });
    const s = await buildSummary("2026-11-05", "2026-11-07", true, new Set(ALL_SCOPES));
    expect(Object.keys(s.errors)).toEqual(["heart-rate"]);
    expect(s.errors["heart-rate"]).toContain("boom");
    expect(s.days[1]!.heartRate).toBeUndefined();
    expect(s.days[1]!.steps).toBe(4321);
  });

  it("types without a granted scope are skipped (no request) and reported", async () => {
    const g = fakeAll();
    const granted = new Set(ALL_SCOPES.filter((sc) => sc !== fullScope("sleep.readonly")));
    const s = await buildSummary("2026-11-05", "2026-11-07", true, granted);
    expect(s.errors.sleep).toBe("Permission not granted");
    expect(s.sleep).toEqual([]);
    expect(g.to(/\/sleep\//)).toHaveLength(0);
  });
});
