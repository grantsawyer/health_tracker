import type { FoodLogEntry } from "../../shared/food";

/**
 * By-meal views of food entries (pure, unit-tested).
 *
 * Entries keep the meal they were logged with. Entries logged without one (Google's "ANYTIME", common for logs from
 * other apps) are placed by time of day so they still count: before 11:00 breakfast (from 4:00), 11:00–14:59 lunch,
 * 17:00–20:59 dinner, anything else a snack. The charts say so.
 */
export type MealKey = "BREAKFAST" | "LUNCH" | "DINNER" | "SNACK";
export type MealMetric = "kcal" | "carbsG" | "fatG" | "proteinG";

/** Categorical slots 1–4 in fixed order (validated light + dark; adjacent stacked pairs pass CVD). */
export const MEALS: { key: MealKey; label: string; color: string }[] = [
  { key: "BREAKFAST", label: "Breakfast", color: "var(--series-1)" },
  { key: "LUNCH", label: "Lunch", color: "var(--series-2)" },
  { key: "DINNER", label: "Dinner", color: "var(--series-3)" },
  { key: "SNACK", label: "Snack", color: "var(--series-4)" },
];

export const METRICS: { key: MealMetric; label: string; unit: string }[] = [
  { key: "kcal", label: "Calories", unit: "kcal" },
  { key: "carbsG", label: "Carbs", unit: "g" },
  { key: "fatG", label: "Fat", unit: "g" },
  { key: "proteinG", label: "Protein", unit: "g" },
];

export function mealOf(e: Pick<FoodLogEntry, "mealType" | "timeLocal">): MealKey {
  if (e.mealType === "BREAKFAST" || e.mealType === "LUNCH" || e.mealType === "DINNER" || e.mealType === "SNACK") return e.mealType;
  const h = Number(e.timeLocal.slice(11, 13));
  if (h >= 4 && h < 11) return "BREAKFAST";
  if (h >= 11 && h < 15) return "LUNCH";
  if (h >= 17 && h < 21) return "DINNER";
  return "SNACK";
}

/** True if any entry had no meal and was placed by time (so the chart can say so). */
export const anyPlacedByTime = (entries: FoodLogEntry[]) =>
  entries.some((e) => !["BREAKFAST", "LUNCH", "DINNER", "SNACK"].includes(e.mealType));

/** Per date, the metric summed per meal (in MEALS order). Days with nothing logged are all undefined, not zero. */
export function byMealByDay(entries: FoodLogEntry[], dates: string[], metric: MealMetric): { date: string; values: (number | undefined)[] }[] {
  const sums = new Map<string, number[]>();
  for (const e of entries) {
    const date = e.timeLocal.slice(0, 10);
    const row = sums.get(date) ?? [0, 0, 0, 0];
    row[MEALS.findIndex((m) => m.key === mealOf(e))]! += e[metric] ?? 0;
    sums.set(date, row);
  }
  return dates.map((date) => {
    const row = sums.get(date);
    return { date, values: row ? row.map((v) => v || undefined) : [undefined, undefined, undefined, undefined] };
  });
}

export interface MealAverage {
  key: MealKey;
  label: string;
  color: string;
  /** Average per logged day (days with no entries at all don't count). */
  perDay: number;
  /** Share of the period's total for this metric, 0–100. */
  share: number;
}

export function mealAverages(entries: FoodLogEntry[], metric: MealMetric): { days: number; meals: MealAverage[] } {
  const days = new Set(entries.map((e) => e.timeLocal.slice(0, 10))).size;
  const totals = MEALS.map((m) => entries.filter((e) => mealOf(e) === m.key).reduce((t, e) => t + (e[metric] ?? 0), 0));
  const all = totals.reduce((a, b) => a + b, 0);
  return {
    days,
    meals: MEALS.map((m, i) => ({ ...m, perDay: days ? totals[i]! / days : 0, share: all ? (totals[i]! / all) * 100 : 0 })),
  };
}
