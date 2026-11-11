import { getPoints, getRollup, type Cached } from "./dataService.js";
import { addDays, type CivilDateTime, type DailyRollupPoint, type DataPoint } from "./healthClient.js";
import { fullScope } from "../shared/scopes.js";
import { dataTypeById, type DataTypeInfo } from "../shared/dataTypes.js";
import type { DailySummary, ExerciseSession, SleepSession, SummaryResponse } from "../shared/summary.js";

/**
 * Builds the dashboard summary: fetches every needed type in parallel (cached),
 * then maps Google's response shapes to the flat types in shared/summary.ts.
 *
 * Field names below were verified against live responses on 2026-11-07, e.g.
 * steps.countSum (string), distance.millimetersSum (string),
 * totalCalories.kcalSum (number), heartRate.beatsPerMinuteAvg/Min/Max,
 * activeZoneMinutes.sumIn{FatBurn,Cardio,Peak}HeartZone,
 * activeMinutes.activeMinutesRollupByActivityLevel[{activityLevel, activeMinutesSum}],
 * weight.weightGramsAvg, bodyFat.bodyFatPercentageAvg,
 * nutritionLog.{energy.kcalSum, totalCarbohydrate.gramsSum, totalFat.gramsSum, nutrients[{nutrient, quantity.gramsSum}]}.
 * Days with no data are simply absent from rollups (not zero-filled).
 */

const ROLLUP_TYPES = [
  "steps", "distance", "floors", "active-zone-minutes", "active-minutes", "total-calories",
  "heart-rate", "weight", "body-fat", "nutrition-log", "hydration-log",
] as const;

type Loose = Record<string, any>;

const num = (v: unknown): number | undefined => {
  if (v === undefined || v === null || v === "") return undefined;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : undefined;
};
const pad = (n: number) => String(n).padStart(2, "0");
export const civilToDate = (c: CivilDateTime | { year: number; month: number; day: number }) => {
  const d = "date" in c ? c.date : c;
  return `${d.year}-${pad(d.month)}-${pad(d.day)}`;
};

/** "2026-11-07T04:24:00Z" + "-18000s" → "2026-11-06T23:24" (local wall clock). */
export function toLocal(utc: string, offset: string | undefined): string {
  const secs = num(offset?.replace(/s$/, "")) ?? 0;
  return new Date(Date.parse(utc) + secs * 1000).toISOString().slice(0, 16);
}

const durationSecs = (d: string | undefined) => num(d?.replace(/s$/, "")) ?? 0;

// ── Rollup mappers (DailyRollupPoint value → DailySummary fields) ───────────
const rollupMappers: Record<(typeof ROLLUP_TYPES)[number], (v: Loose, day: DailySummary) => void> = {
  steps: (v, d) => (d.steps = num(v.steps?.countSum)),
  distance: (v, d) => {
    const mm = num(v.distance?.millimetersSum);
    if (mm !== undefined) d.distanceKm = mm / 1e6;
  },
  floors: (v, d) => (d.floors = num(v.floors?.countSum)),
  "active-zone-minutes": (v, d) => {
    const a = v.activeZoneMinutes;
    if (a) d.azm = { fatBurn: num(a.sumInFatBurnHeartZone) ?? 0, cardio: num(a.sumInCardioHeartZone) ?? 0, peak: num(a.sumInPeakHeartZone) ?? 0 };
  },
  "active-minutes": (v, d) => {
    const levels: Loose[] = v.activeMinutes?.activeMinutesRollupByActivityLevel ?? [];
    if (!levels.length) return;
    const get = (l: string) => num(levels.find((x) => x.activityLevel === l)?.activeMinutesSum) ?? 0;
    d.activeMinutes = { light: get("LIGHT"), moderate: get("MODERATE"), vigorous: get("VIGOROUS") };
  },
  "total-calories": (v, d) => (d.caloriesOut = num(v.totalCalories?.kcalSum)),
  "heart-rate": (v, d) => {
    const h = v.heartRate;
    const avg = num(h?.beatsPerMinuteAvg), min = num(h?.beatsPerMinuteMin), max = num(h?.beatsPerMinuteMax);
    if (avg !== undefined && min !== undefined && max !== undefined) d.heartRate = { avg, min, max };
  },
  weight: (v, d) => {
    const g = num(v.weight?.weightGramsAvg);
    if (g !== undefined) d.weightKg = g / 1000;
  },
  "body-fat": (v, d) => (d.bodyFatPct = num(v.bodyFat?.bodyFatPercentageAvg)),
  "nutrition-log": (v, d) => {
    const n = v.nutritionLog;
    const kcal = num(n?.energy?.kcalSum);
    if (kcal === undefined) return;
    const nutrient = (k: string) => num((n.nutrients as Loose[] | undefined)?.find((x) => x.nutrient === k)?.quantity?.gramsSum);
    d.nutrition = {
      kcal,
      proteinG: nutrient("PROTEIN"),
      carbsG: num(n.totalCarbohydrate?.gramsSum) ?? nutrient("CARBOHYDRATES"),
      fatG: num(n.totalFat?.gramsSum),
      fiberG: nutrient("DIETARY_FIBER"),
    };
  },
  // Unverified: no hydration data in the owner's account yet; field name inferred from VolumeQuantity + the *Sum pattern.
  "hydration-log": (v, d) => (d.waterMl = num(v.hydrationLog?.amountConsumed?.millilitersSum)),
};

// ── Recovery vitals (S1): daily records with a `date` (field names from Google's DataPoint reference) ────────
export const VITAL_TYPES = [
  "daily-heart-rate-variability", "daily-oxygen-saturation", "daily-respiratory-rate",
  "daily-sleep-temperature-derivations", "daily-vo2-max",
] as const;
const vitalMappers: Record<(typeof VITAL_TYPES)[number], (v: Loose, day: DailySummary) => void> = {
  "daily-heart-rate-variability": (v, d) => (d.hrvMs = num(v.averageHeartRateVariabilityMilliseconds) ?? num(v.deepSleepRootMeanSquareOfSuccessiveDifferencesMilliseconds)),
  "daily-oxygen-saturation": (v, d) => (d.spo2Pct = num(v.averagePercentage)),
  "daily-respiratory-rate": (v, d) => (d.breathingRate = num(v.breathsPerMinute)),
  "daily-sleep-temperature-derivations": (v, d) => {
    d.skinTempC = num(v.nightlyTemperatureCelsius);
    d.skinTempBaselineC = num(v.baselineTemperatureCelsius);
  },
  "daily-vo2-max": (v, d) => {
    d.vo2Max = num(v.vo2Max);
    const level = typeof v.cardioFitnessLevel === "string" ? v.cardioFitnessLevel : undefined;
    d.cardioFitness = level && level !== "CARDIO_FITNESS_LEVEL_UNSPECIFIED" ? level : undefined;
  },
};

// ── List mappers ─────────────────────────────────────────────────────────────
export function mapSleep(p: DataPoint): SleepSession | null {
  const s = p.sleep as Loose | undefined;
  if (!s?.interval) return null;
  const startLocal = toLocal(s.interval.startTime, s.interval.startUtcOffset);
  const endLocal = toLocal(s.interval.endTime, s.interval.endUtcOffset);
  const stages = { deep: 0, light: 0, rem: 0, awake: 0, asleep: 0, restless: 0 };
  for (const st of (s.summary?.stagesSummary ?? []) as Loose[]) {
    const key = String(st.type).toLowerCase() as keyof typeof stages;
    if (key in stages) stages[key] += num(st.minutes) ?? 0;
  }
  // Stage-by-stage timeline (minutes from session start), for the hypnogram view.
  const t0 = Date.parse(s.interval.startTime);
  const segments: SleepSession["segments"] = ((s.stages ?? []) as Loose[])
    .map((st) => ({
      stage: String(st.type ?? "").toLowerCase() as SleepSession["segments"][number]["stage"],
      from: Math.round((Date.parse(st.startTime) - t0) / 60000),
      to: Math.round((Date.parse(st.endTime) - t0) / 60000),
    }))
    .filter((x) => ["deep", "light", "rem", "awake", "asleep", "restless"].includes(x.stage) && x.to > x.from)
    .sort((a, b) => a.from - b.from);
  return {
    id: p.name ?? `${startLocal}-sleep`,
    date: endLocal.slice(0, 10),
    startLocal,
    endLocal,
    isNap: Boolean(s.metadata?.nap) && !s.metadata?.mainSleep,
    minutesAsleep: num(s.summary?.minutesAsleep) ?? 0,
    minutesAwake: num(s.summary?.minutesAwake) ?? 0,
    minutesInBed: num(s.summary?.minutesInSleepPeriod) ?? Math.round((Date.parse(s.interval.endTime) - Date.parse(s.interval.startTime)) / 60000),
    stages,
    segments,
    device: (p.dataSource as Loose | undefined)?.device?.displayName,
  };
}

export function mapExercise(p: DataPoint): ExerciseSession | null {
  const e = p.exercise as Loose | undefined;
  if (!e?.interval) return null;
  const m: Loose = e.metricsSummary ?? {};
  const startLocal = toLocal(e.interval.startTime, e.interval.startUtcOffset);
  const active = durationSecs(e.activeDuration);
  const wall = (Date.parse(e.interval.endTime) - Date.parse(e.interval.startTime)) / 1000;
  const mm = num(m.distanceMillimeters);
  const ds = p.dataSource as Loose | undefined;
  return {
    id: p.name ?? `${startLocal}-exercise`,
    date: startLocal.slice(0, 10),
    startLocal,
    type: String(e.exerciseType ?? "OTHER"),
    displayName: String(e.displayName ?? e.exerciseType ?? "Workout"),
    durationMin: Math.round((active || wall) / 60),
    distanceKm: mm ? mm / 1e6 : undefined,
    steps: num(m.steps),
    calories: num(m.caloriesKcal),
    avgHr: num(m.averageHeartRateBeatsPerMinute),
    azm: num(m.activeZoneMinutes),
    source: ds?.device?.displayName ?? ds?.application?.packageName ?? ds?.platform,
  };
}

// ── Build ────────────────────────────────────────────────────────────────────
export async function buildSummary(start: string, end: string, fresh: boolean, granted: Set<string>): Promise<SummaryResponse> {
  const errors: Record<string, string> = {};
  let allCached = true;

  const days = new Map<string, DailySummary>();
  for (let d = start; d < end; d = addDays(d, 1)) days.set(d, { date: d });

  async function load<T>(id: string, fn: (info: DataTypeInfo) => Promise<Cached<T>>): Promise<T | null> {
    const info = dataTypeById(id)!;
    if (!granted.has(fullScope(info.scope))) {
      errors[id] = "Permission not granted";
      return null;
    }
    try {
      const r = await fn(info);
      if (!r.cached) allCached = false;
      return r.value;
    } catch (err) {
      errors[id] = (err as Error).message;
      return null;
    }
  }

  const opts = { start, end, fresh };
  const [rollups, resting, sleep, exercise, vitals] = await Promise.all([
    Promise.all(ROLLUP_TYPES.map((id) => load(id, (i) => getRollup(i, opts)).then((v) => [id, v?.days ?? []] as const))),
    load("daily-resting-heart-rate", (i) => getPoints(i, opts)),
    load("sleep", (i) => getPoints(i, opts)),
    load("exercise", (i) => getPoints(i, opts)),
    Promise.all(VITAL_TYPES.map((id) => load(id, (i) => getPoints(i, opts)).then((v) => [id, v?.dataPoints ?? []] as const))),
  ]);

  for (const [id, points] of rollups) {
    for (const p of points as DailyRollupPoint[]) {
      const day = days.get(civilToDate(p.civilStartTime));
      if (day) rollupMappers[id](p as Loose, day);
    }
  }
  for (const p of resting?.dataPoints ?? []) {
    const r = p.dailyRestingHeartRate as Loose | undefined;
    const day = r?.date ? days.get(civilToDate(r.date)) : undefined;
    if (day) day.restingHr = num(r!.beatsPerMinute);
  }
  for (const [id, points] of vitals) {
    const field = dataTypeById(id)!.field;
    for (const p of points) {
      const v = p[field] as Loose | undefined;
      const day = v?.date ? days.get(civilToDate(v.date)) : undefined;
      if (day) vitalMappers[id](v!, day);
    }
  }

  const byDateAsc = <T extends { startLocal: string }>(a: T, b: T) => a.startLocal.localeCompare(b.startLocal);
  return {
    start,
    end,
    days: [...days.values()],
    sleep: (sleep?.dataPoints ?? []).map(mapSleep).filter((s): s is SleepSession => s !== null).sort(byDateAsc),
    exercise: (exercise?.dataPoints ?? []).map(mapExercise).filter((e): e is ExerciseSession => e !== null).sort(byDateAsc),
    errors,
    fetchedAt: new Date().toISOString(),
    cached: allCached,
  };
}
