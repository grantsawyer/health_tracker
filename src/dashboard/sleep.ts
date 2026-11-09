import { parseDate } from "../viz/scale";
import type { DailySummary, SleepSession } from "../../shared/summary";

/** Pure sleep helpers (unit-testable, no React). */

export interface Night {
  date: string;
  main?: SleepSession;
  asleep: number;
  stages: SleepSession["stages"];
}

/** Group non-nap sessions by wake-up date; the longest is the night's main sleep. */
export function nightsByDate(sessions: SleepSession[], days: DailySummary[]): Night[] {
  return days.map((d) => {
    const s = sessions.filter((x) => x.date === d.date && !x.isNap);
    const stages = { deep: 0, light: 0, rem: 0, awake: 0, asleep: 0, restless: 0 };
    for (const x of s) for (const k of Object.keys(stages) as (keyof typeof stages)[]) stages[k] += x.stages[k];
    const main = [...s].sort((a, b) => b.minutesInBed - a.minutesInBed)[0];
    return { date: d.date, main, asleep: s.reduce((t, x) => t + x.minutesAsleep, 0), stages };
  });
}

/** Wall-clock "YYYY-MM-DDTHH:mm" → minutes relative to midnight starting `date`. */
export function minutesFrom(date: string, local: string): number {
  const base = parseDate(date).getTime();
  const [d, t] = local.split("T") as [string, string];
  const [h, m] = t.split(":").map(Number) as [number, number];
  return Math.round((parseDate(d).getTime() - base) / 60000) + h * 60 + m;
}

