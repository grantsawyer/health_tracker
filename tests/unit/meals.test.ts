import { describe, expect, it } from "vitest";
import { anyPlacedByTime, byMealByDay, mealAverages, mealOf } from "../../src/food/meals.js";
import type { FoodLogEntry } from "../../shared/food.js";
import { describeSplit, macroSplit } from "../../src/food/macroSplit.js";

const e = (timeLocal: string, mealType: string, kcal: number, carbsG?: number): FoodLogEntry =>
  ({ id: timeLocal, timeLocal, mealType, displayName: "Food", kcal, carbsG, editable: true });

describe("meals", () => {
  it("keeps the logged meal, and places entries without one by time of day", () => {
    expect(mealOf(e("2026-11-07T22:00", "BREAKFAST", 1))).toBe("BREAKFAST");
    expect(["03:30", "04:00", "10:59", "11:00", "14:59", "15:30", "17:00", "20:59", "21:00"].map((t) => mealOf(e(`2026-11-07T${t}`, "ANYTIME", 1))))
      .toEqual(["SNACK", "BREAKFAST", "BREAKFAST", "LUNCH", "LUNCH", "SNACK", "DINNER", "DINNER", "SNACK"]);
    expect(anyPlacedByTime([e("2026-11-07T08:00", "BREAKFAST", 1)])).toBe(false);
    expect(anyPlacedByTime([e("2026-11-07T08:00", "ANYTIME", 1)])).toBe(true);
  });

  it("sums each meal per day; days with nothing logged stay empty, not zero", () => {
    const entries = [e("2026-11-06T08:00", "BREAKFAST", 300, 40), e("2026-11-06T08:30", "BREAKFAST", 100), e("2026-11-06T19:00", "DINNER", 600, 50)];
    expect(byMealByDay(entries, ["2026-11-05", "2026-11-06"], "kcal")).toEqual([
      { date: "2026-11-05", values: [undefined, undefined, undefined, undefined] },
      { date: "2026-11-06", values: [400, undefined, 600, undefined] },
    ]);
    expect(byMealByDay(entries, ["2026-11-06"], "carbsG")[0]!.values).toEqual([40, undefined, 50, undefined]);
  });

  it("averages per logged day with each meal's share of the total", () => {
    const entries = [e("2026-11-06T08:00", "BREAKFAST", 300), e("2026-11-06T13:00", "LUNCH", 700), e("2026-11-07T08:00", "BREAKFAST", 500)];
    const r = mealAverages(entries, "kcal");
    expect(r.days).toBe(2);
    expect(r.meals.map((m) => [m.key, m.perDay, Math.round(m.share)])).toEqual([["BREAKFAST", 400, 53], ["LUNCH", 350, 47], ["DINNER", 0, 0], ["SNACK", 0, 0]]);
    expect(mealAverages([], "kcal")).toMatchObject({ days: 0, meals: [{ perDay: 0, share: 0 }, {}, {}, {}] });
  });
});

describe("macroSplit (per-food proportion bar)", () => {
  it("splits by macro calories (fat counts 9 kcal/g), in carbs · fat · protein order", () => {
    const s = macroSplit({ carbsG: 40, fatG: 10, proteinG: 20 })!; // 160 + 90 + 80 = 330 kcal
    expect(s.map((x) => x.key)).toEqual(["carbsG", "fatG", "proteinG"]);
    expect(s.map((x) => Math.round(x.pct))).toEqual([48, 27, 24]);
    expect(describeSplit(s)).toBe("Carbs 48% · Fat 27% · Protein 24% of calories");
  });
  it("treats a missing macro as zero, and gives nothing when there are no macros", () => {
    expect(macroSplit({ proteinG: 25 })!.map((x) => x.pct)).toEqual([0, 0, 100]);
    expect(macroSplit({})).toBeNull();
    expect(macroSplit({ carbsG: 0, fatG: 0, proteinG: 0 })).toBeNull();
  });
});
