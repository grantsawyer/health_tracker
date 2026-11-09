import { describe, expect, it } from "vitest";
import { minutesFrom, nightsByDate } from "../../src/dashboard/sleep";
import { offNutrition, offToQuick, servingText, type OffDraft } from "../../src/food/offMath";
import { distance, fmtDuration, weight } from "../../src/units";
import { axisFormat, labelIndices, niceTicks } from "../../src/viz/scale";
import { fmtClock } from "../../src/viz/ScheduleChart";
import { defaultMeal } from "../../src/food/AddFood";
import type { OffProduct } from "../../shared/food";
import type { SleepSession } from "../../shared/summary";

describe("chart scales", () => {
  it("niceTicks covers the range with round steps", () => {
    expect(niceTicks(0, 14_000, 4)).toEqual([0, 5000, 10000, 15000]);
    expect(niceTicks(0, 1, 4)).toEqual([0, 0.25, 0.5, 0.75, 1]);
    expect(niceTicks(158.4, 165.3, 4)).toEqual([158, 160, 162, 164, 166]);
    expect(niceTicks(5, 5)).toEqual([4, 4.5, 5, 5.5, 6]); // flat data still gets a range
  });
  it("axisFormat goes compact only at ≥10,000", () => {
    expect(axisFormat([0, 2000, 4000])(2000)).toBe("2,000");
    expect(axisFormat([0, 10000, 20000])(20000)).toBe("20K");
  });
  it("labelIndices spaces labels evenly and always includes the last index", () => {
    expect([...labelIndices(30, 6)].sort((a, b) => a - b)).toEqual([4, 9, 14, 19, 24, 29]);
    expect(labelIndices(0, 5).size).toBe(0);
  });
});

describe("formatting", () => {
  it("fmtDuration", () => {
    expect(fmtDuration(327)).toBe("5h 27m");
    expect(fmtDuration(45)).toBe("45m");
    expect(fmtDuration(60)).toBe("1h 00m");
  });
  it("fmtClock handles negative (before midnight) and >24h minutes", () => {
    expect(fmtClock(-30)).toBe("11:30 PM");
    expect(fmtClock(330)).toBe("5:30 AM");
    expect(fmtClock(720)).toBe("12 PM");
    expect(fmtClock(1440 + 75)).toBe("1:15 AM");
  });
  it("unit conversions", () => {
    expect(distance("imperial").format(10)).toBe("6.2 mi");
    expect(distance("metric").format(10)).toBe("10 km");
    expect(weight("imperial").convert(70)).toBeCloseTo(154.3, 1);
    expect(weight("metric").formatConverted(73.1)).toBe("73.1 kg");
  });
});

describe("defaultMeal", () => {
  it.each([["04:59", "SNACK"], ["05:00", "BREAKFAST"], ["10:29", "BREAKFAST"], ["10:30", "LUNCH"], ["14:59", "LUNCH"], ["15:00", "SNACK"], ["17:00", "DINNER"], ["21:29", "DINNER"], ["21:30", "SNACK"]])(
    "%s → %s", (time, meal) => expect(defaultMeal(time)).toBe(meal),
  );
});

describe("Open Food Facts scaling", () => {
  const yogurt: OffProduct = {
    code: "1", name: "Greek Yogurt", brand: "Chobani", servingSize: "1 serving (150 g)", servingGrams: 150,
    per100g: { kcal: 73, proteinG: 8, carbsG: 10.7, fatG: 0, sodiumMg: 40 },
    perServing: { kcal: 110, proteinG: 12, carbsG: 16, fatG: 0, sodiumMg: 60 },
  };
  const draft = (unit: OffDraft["unit"], amount: string, product = yogurt): OffDraft => ({ kind: "off", product, unit, amount });

  it("uses per-serving values when the product has them", () => {
    expect(offNutrition(draft("serving", "2"))).toEqual({ kcal: 220, proteinG: 24, carbsG: 32, fatG: 0, fiberG: undefined, sugarG: undefined, sodiumMg: 120 });
  });
  it("scales per-100 g values by grams", () => {
    expect(offNutrition(draft("g", "50"))).toMatchObject({ kcal: 37, proteinG: 4, carbsG: 5.4, sodiumMg: 20 });
  });
  it("falls back to serving grams × per-100 g when there's no per-serving data", () => {
    const p = { ...yogurt, perServing: undefined };
    expect(offNutrition(draft("serving", "1", p))).toMatchObject({ kcal: 110, proteinG: 12 });
  });
  it("can't compute servings without serving data, or a non-positive amount", () => {
    expect(offNutrition(draft("serving", "1", { ...yogurt, perServing: undefined, servingGrams: undefined }))).toBeUndefined();
    expect(offNutrition(draft("g", "0"))).toBeUndefined();
    expect(offNutrition(draft("g", ""))).toBeUndefined();
  });
  it("servingText strips the redundant '1 serving (…)' wrapper", () => {
    expect(servingText(yogurt)).toBe("150 g");
    expect(servingText({ ...yogurt, servingSize: "30 g" })).toBe("30 g");
    expect(servingText({ ...yogurt, servingSize: undefined, servingGrams: 28 })).toBe("28 g");
  });
  it("offToQuick names the entry with brand and amount", () => {
    expect(offToQuick(draft("serving", "1"))).toMatchObject({ kind: "quick", displayName: "Greek Yogurt (Chobani), 1 serving (150 g)", kcal: 110 });
    expect(offToQuick(draft("g", "200", { ...yogurt, name: "Chobani Greek Yogurt" }))!.displayName).toBe("Chobani Greek Yogurt, 200 g");
  });
});

describe("sleep grouping", () => {
  const session = (over: Partial<SleepSession>): SleepSession => ({
    id: Math.random().toString(), date: "2026-11-07", startLocal: "2026-11-06T23:30", endLocal: "2026-11-07T05:30", isNap: false,
    minutesAsleep: 300, minutesAwake: 20, minutesInBed: 320, stages: { deep: 60, light: 180, rem: 60, awake: 20, asleep: 0, restless: 0 }, segments: [], ...over,
  });

  it("minutesFrom is relative to the midnight that starts the date", () => {
    expect(minutesFrom("2026-11-07", "2026-11-06T23:30")).toBe(-30);
    expect(minutesFrom("2026-11-07", "2026-11-07T05:30")).toBe(330);
  });

  it("nightsByDate: main = longest non-nap session; naps excluded; stages summed", () => {
    const nights = nightsByDate(
      [
        session({ id: "main", minutesInBed: 320 }),
        session({ id: "second", startLocal: "2026-11-07T06:00", endLocal: "2026-11-07T07:00", minutesInBed: 60, minutesAsleep: 50 }),
        session({ id: "nap", isNap: true, minutesAsleep: 21 }),
      ],
      [{ date: "2026-11-06" }, { date: "2026-11-07" }],
    );
    expect(nights[0]).toMatchObject({ date: "2026-11-06", asleep: 0, main: undefined });
    expect(nights[1]!.main!.id).toBe("main");
    expect(nights[1]!.asleep).toBe(350);
    expect(nights[1]!.stages.deep).toBe(120);
  });
});
