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


// ── Sleep schedule goals ─────────────────────────────────────────────────────

/**
 * A clock goal (minutes after midnight) on the schedule chart's scale: minutes from the midnight that starts the
 * wake-up date. Bedtimes from noon on are the evening before (22:30 → -90); earlier ones are after midnight (00:30 → 30).
 */
export const bedtimeOffset = (clock: number) => (clock >= 12 * 60 ? clock - 24 * 60 : clock);

export interface ScheduleCheck {
  /** Minutes late (+) or early (−) versus the goal; undefined when that goal isn't set. */
  bedDiff?: number;
  wakeDiff?: number;
  /** True when every goal that's set is met within the tolerance; undefined without goals or without a night. */
  onSchedule?: boolean;
}

export function checkSchedule(
  night: { start?: number; end?: number },
  goals: { bedtime: number | null; wakeTime: number | null },
  tolerance: number,
): ScheduleCheck {
  if (night.start === undefined || night.end === undefined || (goals.bedtime === null && goals.wakeTime === null)) return {};
  const out: ScheduleCheck = {};
  if (goals.bedtime !== null) out.bedDiff = night.start - bedtimeOffset(goals.bedtime);
  if (goals.wakeTime !== null) out.wakeDiff = night.end - goals.wakeTime;
  out.onSchedule = [out.bedDiff, out.wakeDiff].every((d) => d === undefined || Math.abs(d) <= tolerance);
  return out;
}

/** "on time", "25 min late", "1h 10m early". */
export function describeDiff(diff: number, tolerance: number): string {
  if (Math.abs(diff) <= tolerance) return diff === 0 ? "on time" : `on time (${Math.abs(Math.round(diff))} min ${diff > 0 ? "late" : "early"})`;
  const m = Math.abs(Math.round(diff));
  const amount = m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m` : `${m} min`;
  return `${amount} ${diff > 0 ? "late" : "early"}`;
}
