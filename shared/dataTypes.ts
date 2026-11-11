import type { ScopeKey } from "./types.js";

/**
 * Registry of the Google Health data types this app uses.
 *
 * `id` is the kebab-case data type in URLs (users/me/dataTypes/{id}).
 * `field` is the camelCase DataPoint union field holding the value. List filters
 * use the snake_case id instead (e.g. `daily_resting_heart_rate.date`), verified live.
 *
 * `kind` decides the list-filter shape (from the dataPoints.list reference):
 *   interval → {field}.interval.civil_start_time
 *   sample   → {field}.sample_time.civil_time
 *   session  → {field}.interval.civil_start_time   (exercise, nutrition/hydration logs)
 *   sleep    → sleep.interval.civil_end_time         (sleep is keyed by wake-up time)
 *   daily    → {field}.date
 *
 * Verified live 2026-11-07: rollup works for every type marked rollup: true;
 * daily-resting-heart-rate supports only list/reconcile.
 */
export type FilterKind = "interval" | "sample" | "session" | "sleep" | "daily";

export interface DataTypeInfo {
  id: string;
  field: string;
  label: string;
  kind: FilterKind;
  /** Read scope required. */
  scope: ScopeKey;
  /** Supported by dataPoints:dailyRollUp. */
  rollup: boolean;
  /** dailyRollUp max range in days (14 for a few heavy types, else 90). */
  rollupMaxDays?: number;
  /** list pageSize cap (25 for exercise and sleep, 10000 otherwise). */
  listMaxPageSize?: number;
  /** dataSourceFamily filter not allowed on list. */
  noSourceFamily?: boolean;
}

export const DATA_TYPES: DataTypeInfo[] = [
  // Activity & fitness
  { id: "steps", field: "steps", label: "Steps", kind: "interval", scope: "activity_and_fitness.readonly", rollup: true },
  { id: "distance", field: "distance", label: "Distance", kind: "interval", scope: "activity_and_fitness.readonly", rollup: true },
  { id: "floors", field: "floors", label: "Floors", kind: "interval", scope: "activity_and_fitness.readonly", rollup: true },
  { id: "active-zone-minutes", field: "activeZoneMinutes", label: "Active zone minutes", kind: "interval", scope: "activity_and_fitness.readonly", rollup: true },
  { id: "active-minutes", field: "activeMinutes", label: "Active minutes", kind: "interval", scope: "activity_and_fitness.readonly", rollup: true, rollupMaxDays: 14 },
  { id: "total-calories", field: "totalCalories", label: "Calories burned", kind: "interval", scope: "activity_and_fitness.readonly", rollup: true, rollupMaxDays: 14 },
  { id: "exercise", field: "exercise", label: "Exercise sessions", kind: "session", scope: "activity_and_fitness.readonly", rollup: false, listMaxPageSize: 25 },
  // Health metrics
  { id: "heart-rate", field: "heartRate", label: "Heart rate", kind: "sample", scope: "health_metrics_and_measurements.readonly", rollup: true, rollupMaxDays: 14 },
  { id: "daily-resting-heart-rate", field: "dailyRestingHeartRate", label: "Resting heart rate", kind: "daily", scope: "health_metrics_and_measurements.readonly", rollup: false },
  // Recovery vitals (S1): one record per day with a `date`, list only (no dailyRollUp). Field shapes from Google's
  // DataPoint reference (checked 2026-11-11); not yet seen live.
  { id: "daily-heart-rate-variability", field: "dailyHeartRateVariability", label: "Heart rate variability", kind: "daily", scope: "health_metrics_and_measurements.readonly", rollup: false },
  { id: "daily-oxygen-saturation", field: "dailyOxygenSaturation", label: "Oxygen saturation (SpO2)", kind: "daily", scope: "health_metrics_and_measurements.readonly", rollup: false },
  { id: "daily-respiratory-rate", field: "dailyRespiratoryRate", label: "Breathing rate", kind: "daily", scope: "health_metrics_and_measurements.readonly", rollup: false },
  { id: "daily-sleep-temperature-derivations", field: "dailySleepTemperatureDerivations", label: "Skin temperature", kind: "daily", scope: "health_metrics_and_measurements.readonly", rollup: false },
  { id: "daily-vo2-max", field: "dailyVo2Max", label: "VO2 max", kind: "daily", scope: "health_metrics_and_measurements.readonly", rollup: false },
  { id: "weight", field: "weight", label: "Weight", kind: "sample", scope: "health_metrics_and_measurements.readonly", rollup: true },
  { id: "body-fat", field: "bodyFat", label: "Body fat", kind: "sample", scope: "health_metrics_and_measurements.readonly", rollup: true },
  // Sleep
  { id: "sleep", field: "sleep", label: "Sleep", kind: "sleep", scope: "sleep.readonly", rollup: false, listMaxPageSize: 25, noSourceFamily: true },
  // Nutrition
  { id: "nutrition-log", field: "nutritionLog", label: "Food log", kind: "session", scope: "nutrition.readonly", rollup: true },
  { id: "hydration-log", field: "hydrationLog", label: "Water log", kind: "session", scope: "nutrition.readonly", rollup: true },
];

export const dataTypeById = (id: string) => DATA_TYPES.find((t) => t.id === id);

export const MEAL_TYPES = ["BREAKFAST", "LUNCH", "DINNER", "SNACK"] as const;
export type MealType = (typeof MEAL_TYPES)[number];
