/**
 * Synthetic Google Health payloads. Shapes mirror live responses recorded on
 * 2026-11-07/08 (int64 values as strings, `users/{numericId}/…` resource
 * names, UTC times + "-18000s" offsets) but every value and ID here is made
 * up; no real health data is committed.
 */
import { saveTokens } from "../../server/tokenStore.js";

export const USER = "users/1234567890123456789";
export const OUR_CLIENT = "123456789012-testclientid.apps.googleusercontent.com"; // matches tests/setup.ts
export const EST = "-18000s";

export const ALL_SCOPES = [
  "openid",
  "email",
  ...["activity_and_fitness.readonly", "sleep.readonly", "nutrition.readonly", "nutrition.writeonly", "health_metrics_and_measurements.readonly", "profile.readonly"].map(
    (s) => `https://www.googleapis.com/auth/googlehealth.${s}`,
  ),
];

/** Store a valid, unexpired session so healthFetch doesn't try to refresh. */
export function signIn(scopes = ALL_SCOPES, email = "tester@example.com") {
  saveTokens({
    accessToken: "test-access-token",
    accessTokenExpiresAt: Date.now() + 3600_000,
    refreshToken: "test-refresh-token",
    scope: scopes.join(" "),
    email,
  });
}

const civil = (d: string) => {
  const [year, month, day] = d.split("-").map(Number);
  return { date: { year, month, day }, time: {} };
};
const nextDay = (d: string) => {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + 1);
  return x.toISOString().slice(0, 10);
};

/** One dailyRollUp bucket: `{ civilStartTime, civilEndTime, [field]: value }`. */
export const rollupDay = (date: string, field: string, value: unknown) => ({
  civilStartTime: civil(date),
  civilEndTime: civil(nextDay(date)),
  [field]: value,
});

export function sleepPoint(o: { id: string; start: string; end: string; asleep: number; awake: number; nap?: boolean; stages?: Record<string, number> }) {
  const stages = o.stages ?? { DEEP: 60, LIGHT: 200, REM: 80, AWAKE: o.awake };
  return {
    name: `${USER}/dataTypes/sleep/dataPoints/${o.id}`,
    dataSource: { recordingMethod: "DERIVED", device: { formFactor: "WATCH", displayName: "Test Watch" }, platform: "FITBIT" },
    sleep: {
      interval: { startTime: o.start, startUtcOffset: EST, endTime: o.end, endUtcOffset: EST },
      type: "STAGES",
      metadata: o.nap ? { stagesStatus: "SUCCEEDED", processed: true, nap: true } : { stagesStatus: "SUCCEEDED", processed: true, mainSleep: true },
      summary: {
        minutesInSleepPeriod: String(o.asleep + o.awake),
        minutesAsleep: String(o.asleep),
        minutesAwake: String(o.awake),
        stagesSummary: Object.entries(stages).map(([type, minutes]) => ({ type, minutes: String(minutes), count: "1" })),
      },
    },
  };
}

export function exercisePoint(o: { id: string; start: string; end: string; type: string; name: string; activeSecs?: number; metrics?: Record<string, unknown> }) {
  return {
    name: `${USER}/dataTypes/exercise/dataPoints/${o.id}`,
    dataSource: { recordingMethod: "PASSIVELY_MEASURED", application: { packageName: "com.example.fitness" }, platform: "HEALTH_CONNECT" },
    exercise: {
      interval: { startTime: o.start, startUtcOffset: EST, endTime: o.end, endUtcOffset: EST },
      exerciseType: o.type,
      displayName: o.name,
      metricsSummary: o.metrics ?? {},
      ...(o.activeSecs !== undefined ? { activeDuration: `${o.activeSecs}s` } : {}),
    },
  };
}

/** A nutrition-log point. `ours` marks it as written by this app's OAuth client. */
export function nutritionLog(o: {
  id: string;
  start: string;
  name: string;
  kcal?: number;
  mealType?: string;
  ours?: boolean;
  food?: string;
  serving?: { amount: number; unit?: string; label?: string };
  proteinG?: number;
  carbsG?: number;
  fatG?: number;
  sodiumG?: number;
}) {
  const nutrients = [
    ...(o.proteinG !== undefined ? [{ quantity: { grams: o.proteinG }, nutrient: "PROTEIN" }] : []),
    ...(o.sodiumG !== undefined ? [{ quantity: { grams: o.sodiumG }, nutrient: "SODIUM" }] : []),
  ];
  return {
    name: `${USER}/dataTypes/nutrition-log/dataPoints/${o.id}`,
    dataSource: o.ours
      ? { recordingMethod: "UNKNOWN", application: { googleWebClientId: OUR_CLIENT }, platform: "GOOGLE_WEB_API" }
      : { recordingMethod: "MANUAL", platform: "FITBIT" },
    nutritionLog: {
      interval: { startTime: o.start, startUtcOffset: EST, endTime: new Date(Date.parse(o.start) + 60_000).toISOString(), endUtcOffset: EST },
      ...(nutrients.length ? { nutrients } : {}),
      ...(o.kcal !== undefined ? { energy: { kcal: o.kcal } } : {}),
      ...(o.carbsG !== undefined ? { totalCarbohydrate: { grams: o.carbsG } } : {}),
      ...(o.fatG !== undefined ? { totalFat: { grams: o.fatG } } : {}),
      mealType: o.mealType ?? "SNACK",
      ...(o.serving
        ? { serving: { amount: o.serving.amount, ...(o.serving.unit ? { foodMeasurementUnit: o.serving.unit } : {}), ...(o.serving.label ? { foodMeasurementUnitDisplayName: o.serving.label } : {}) } }
        : {}),
      ...(o.food ? { food: o.food } : {}),
      foodDisplayName: o.name,
    },
  };
}

export const unitName = (n: number) => `users/me/dataTypes/food-measurement-unit/dataPoints/${n}`;
export const OZ = unitName(226);
export const GRAM = unitName(147);

export function foodPoint(o: { id: string; name: string; access?: "PRIVATE" | "PUBLIC"; kcal?: number; defaultOz?: number }) {
  const amount = o.defaultOz ?? 1;
  return {
    name: `${USER}/dataTypes/food/dataPoints/${o.id}`,
    food: {
      displayName: o.name,
      accessLevel: `FOOD_ACCESS_LEVEL_${o.access ?? "PRIVATE"}`,
      nutrients: [{ quantity: { grams: 5 }, nutrient: "PROTEIN" }],
      totalCarbohydrate: { grams: 0 },
      totalFat: { grams: 1 },
      energyAvg: { kcal: o.kcal ?? 50 },
      defaultServing: { amount, foodMeasurementUnit: OZ, foodMeasurementUnitDisplayName: "oz", foodMeasurementUnitDisplayNamePlural: "oz", multiplier: 1 },
      servings: [
        { amount: 1, foodMeasurementUnit: GRAM, foodMeasurementUnitDisplayName: "gram", foodMeasurementUnitDisplayNamePlural: "grams", multiplier: 0.0352739619 / amount },
        { amount: 1, foodMeasurementUnit: OZ, foodMeasurementUnitDisplayName: "oz", foodMeasurementUnitDisplayNamePlural: "oz", multiplier: 1 / amount },
      ],
    },
  };
}
