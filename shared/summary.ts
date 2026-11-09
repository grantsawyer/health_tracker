/**
 * Normalized dashboard data: the contract between server/summary.ts and the
 * dashboards. All values are in metric base units (km, kg, kcal, minutes);
 * the UI converts for display. A missing field means "no data that day",
 * which is not the same as zero.
 */

export interface DailySummary {
  /** Local civil date, YYYY-MM-DD */
  date: string;
  steps?: number;
  distanceKm?: number;
  floors?: number;
  azm?: { fatBurn: number; cardio: number; peak: number };
  activeMinutes?: { light: number; moderate: number; vigorous: number };
  caloriesOut?: number;
  heartRate?: { avg: number; min: number; max: number };
  restingHr?: number;
  weightKg?: number;
  bodyFatPct?: number;
  nutrition?: { kcal: number; proteinG?: number; carbsG?: number; fatG?: number; fiberG?: number };
  waterMl?: number;
}

export interface SleepSession {
  id: string;
  /** Local date the session ended (the "night of" is the wake-up date). */
  date: string;
  /** Local wall-clock start/end, "YYYY-MM-DDTHH:mm" (no zone). */
  startLocal: string;
  endLocal: string;
  isNap: boolean;
  minutesAsleep: number;
  minutesAwake: number;
  minutesInBed: number;
  /** Minutes per stage. CLASSIC sleep (no stages) reports only asleep/awake/restless. */
  stages: { deep: number; light: number; rem: number; awake: number; asleep: number; restless: number };
  /** Stage timeline in minutes from the session start (empty if Google sent no stages). */
  segments: { stage: "deep" | "light" | "rem" | "awake" | "asleep" | "restless"; from: number; to: number }[];
  device?: string;
}

export interface ExerciseSession {
  id: string;
  date: string;
  startLocal: string;
  type: string;
  displayName: string;
  durationMin: number;
  distanceKm?: number;
  steps?: number;
  calories?: number;
  avgHr?: number;
  azm?: number;
  source?: string;
}

export interface SummaryResponse {
  start: string;
  end: string;
  days: DailySummary[];
  sleep: SleepSession[];
  exercise: ExerciseSession[];
  /** Per data type: why it's missing (permission not granted, API error). Other types still load. */
  errors: Record<string, string>;
  fetchedAt: string;
  /** True only if every underlying read came from cache. */
  cached: boolean;
}
