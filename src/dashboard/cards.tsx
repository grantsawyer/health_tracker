import type { DailySummary } from "../../shared/summary";
import type { LayoutSection, MetricId } from "../../shared/layout";
import { Icon } from "../ui/icons";
import type { Status } from "../ui/Pill";
import { distance, fmtBpm, fmtDuration, fmtInt, fmtKcal, fmtMin, fmtPct, weight } from "../units";
import { fmtClock } from "../viz/ScheduleChart";
import { fmtShortDate } from "../viz/scale";
import type { MiniTrendProps } from "../viz/MiniTrend";
import { budgetStatus, goalStatus, rangeStatus } from "./baseline";
import { S, azmTotal, dash, focusDay, lastWith, pctFill, series, typical, upToAnchor, type Tab, type ViewCtx } from "./ctx";
import { minutesFrom, nightsByDate, type Night } from "./sleep";

/**
 * Every metric the Today page can show, as a single-day tile ("today") and/or a
 * week trend card ("week"), in the same visual style. `available` says whether
 * the owner has any data for it in the last 30 days, so the picker can steer
 * away from empty cards (they can still be added).
 */
export type Tone = "activity" | "sleep" | "heart" | "food" | "body";
export interface TileContent {
  value: string;
  sub?: string;
  fill?: string;
}
export type WeekContent = Omit<MiniTrendProps, "dates" | "today" | "onOpen" | "title">;

export interface MetricDef {
  id: MetricId;
  label: string;
  group: "Activity" | "Food" | "Heart" | "Sleep" | "Body";
  tone: Tone;
  icon: () => React.JSX.Element;
  tab: Tab;
  available: (ctx: ViewCtx) => boolean;
  tile?: (ctx: ViewCtx) => TileContent;
  week?: (ctx: ViewCtx) => WeekContent;
}

// ── shared bits ──────────────────────────────────────────────────────────────
const allDays = (ctx: ViewCtx): DailySummary[] => [...(ctx.baseline?.days ?? []), ...ctx.data.days];
const hasDay = (pick: (d: DailySummary) => unknown) => (ctx: ViewCtx) => allDays(ctx).some((d) => pick(d) !== undefined && pick(d) !== 0);
const nights = (ctx: ViewCtx) => nightsByDate(ctx.data.sleep, ctx.dates.map((date) => ({ date })));
const tonight = (ctx: ViewCtx): Night | undefined => nights(ctx).find((n) => n.date === ctx.period.anchor);
const hasSleep = (pick: (n: Night) => number) => (ctx: ViewCtx) =>
  nightsByDate([...(ctx.baseline?.sleep ?? []), ...ctx.data.sleep], allDays(ctx)).some((n) => n.main && pick(n) > 0);
const g = (n: number) => `${fmtInt(n)} g`;
const ofGoal = (goal: number | null | undefined, unit = "") => (goal ? `of ${fmtInt(goal)}${unit}` : undefined);
const sleepGoalStatus = (ctx: ViewCtx, mins: number | undefined): Status =>
  !ctx.goals.sleepMinutes ? { tone: "info", text: "Set a sleep goal" }
    : !mins ? { tone: "info", text: "No data" }
    : mins >= ctx.goals.sleepMinutes ? { tone: "good", text: "Goal met" } : { tone: "warn", text: "Goal not met" };
const latest = (ctx: ViewCtx, pick: (d: DailySummary) => number | undefined) => lastWith(upToAnchor(ctx), pick);
const latestStatus = (ctx: ViewCtx, l: { date: string } | undefined, verb: string): Status =>
  l ? { tone: "info", text: l.date === ctx.period.anchor ? `${verb} this day` : `Last ${fmtShortDate(l.date)}` } : { tone: "info", text: "No data" };
const activeTotal = (d: DailySummary) => (d.activeMinutes ? d.activeMinutes.light + d.activeMinutes.moderate + d.activeMinutes.vigorous : undefined);
const waterUnits = (ctx: ViewCtx) =>
  ctx.units === "imperial" ? { conv: (ml: number) => ml / 29.5735, fmt: (v: number) => `${fmtInt(v)} fl oz` } : { conv: (ml: number) => ml, fmt: (v: number) => `${fmtInt(v)} ml` };
const stageMins = (n: Night | undefined, k: "deep" | "rem") => (n?.main ? n.stages[k] : undefined);

/** Exercise days as a 1/0 series so the bars read "exercised" per day. */
const exerciseSeries = (ctx: ViewCtx) => ctx.dates.map((d) => (ctx.data.exercise.some((e) => e.date === d) ? 1 : undefined));

// ── registry ─────────────────────────────────────────────────────────────────
export const METRICS: MetricDef[] = [
  {
    // Rendered as the steps ring (three slots tall) by TodayView; `tile` is its text fallback.
    id: "stepsRing", label: "Steps ring", group: "Activity", tone: "activity", icon: Icon.fitness, tab: "fitness",
    available: hasDay((d) => d.steps),
    tile: (ctx) => { const v = focusDay(ctx)?.steps ?? 0; return { value: fmtInt(v), sub: ofGoal(ctx.goals.steps), fill: pctFill(v, ctx.goals.steps) }; },
  },
  {
    id: "steps", label: "Steps", group: "Activity", tone: "activity", icon: Icon.fitness, tab: "fitness",
    available: hasDay((d) => d.steps),
    tile: (ctx) => { const v = focusDay(ctx)?.steps ?? 0; return { value: fmtInt(v), sub: ofGoal(ctx.goals.steps), fill: pctFill(v, ctx.goals.steps) }; },
    week: (ctx) => ({ label: "Steps", value: fmtInt(focusDay(ctx)?.steps ?? 0), kind: "bars", color: S.activity, values: series(ctx, (d) => d.steps), goal: ctx.goals.steps, format: fmtInt, status: goalStatus(focusDay(ctx)?.steps ?? 0, ctx.goals.steps) }),
  },
  {
    id: "distance", label: "Distance", group: "Activity", tone: "activity", icon: Icon.fitness, tab: "fitness",
    available: hasDay((d) => d.distanceKm),
    tile: (ctx) => { const v = focusDay(ctx)?.distanceKm; return { value: v !== undefined ? distance(ctx.units).format(v) : dash }; },
    week: (ctx) => { const D = distance(ctx.units); const v = focusDay(ctx)?.distanceKm; return { label: "Distance", value: v !== undefined ? D.convert(v).toFixed(1) : dash, unit: v !== undefined ? ` ${D.unit}` : undefined, kind: "bars", color: S.activity, values: series(ctx, (d) => (d.distanceKm !== undefined ? D.convert(d.distanceKm) : undefined)), format: (x) => `${x.toFixed(1)} ${D.unit}` }; },
  },
  {
    id: "floors", label: "Floors", group: "Activity", tone: "activity", icon: Icon.fitness, tab: "fitness",
    available: hasDay((d) => d.floors),
    tile: (ctx) => { const v = focusDay(ctx)?.floors ?? 0; return { value: fmtInt(v), sub: ofGoal(ctx.goals.floors), fill: pctFill(v, ctx.goals.floors) }; },
    week: (ctx) => ({ label: "Floors", value: fmtInt(focusDay(ctx)?.floors ?? 0), kind: "bars", color: S.activity, values: series(ctx, (d) => d.floors), goal: ctx.goals.floors, format: fmtInt, status: goalStatus(focusDay(ctx)?.floors ?? 0, ctx.goals.floors) }),
  },
  {
    id: "activeZoneMinutes", label: "Active zone minutes", group: "Activity", tone: "activity", icon: Icon.bolt, tab: "fitness",
    available: hasDay(azmTotal),
    tile: (ctx) => { const d = focusDay(ctx); const v = (d && azmTotal(d)) ?? 0; return { value: fmtInt(v), sub: ofGoal(ctx.goals.activeZoneMinutes), fill: pctFill(v, ctx.goals.activeZoneMinutes) }; },
    week: (ctx) => { const d = focusDay(ctx); const v = (d && azmTotal(d)) ?? 0; return { label: "Active zone minutes", value: fmtInt(v), kind: "bars", color: S.activity, values: series(ctx, azmTotal), goal: ctx.goals.activeZoneMinutes, format: fmtMin, status: goalStatus(v, ctx.goals.activeZoneMinutes) }; },
  },
  {
    id: "activeMinutes", label: "Active minutes", group: "Activity", tone: "activity", icon: Icon.bolt, tab: "fitness",
    available: hasDay(activeTotal),
    tile: (ctx) => { const d = focusDay(ctx); return { value: d && activeTotal(d) !== undefined ? fmtMin(activeTotal(d)!) : dash, sub: d?.activeMinutes ? `${fmtInt(d.activeMinutes.vigorous)} vigorous` : undefined }; },
    week: (ctx) => { const d = focusDay(ctx); return { label: "Active minutes", value: d && activeTotal(d) !== undefined ? fmtInt(activeTotal(d)!) : dash, unit: d && activeTotal(d) !== undefined ? " min" : undefined, kind: "bars", color: S.activity, values: series(ctx, activeTotal), format: fmtMin }; },
  },
  {
    id: "caloriesBurned", label: "Calories burned", group: "Activity", tone: "activity", icon: Icon.flame, tab: "fitness",
    available: hasDay((d) => d.caloriesOut),
    tile: (ctx) => { const v = focusDay(ctx)?.caloriesOut; return { value: v !== undefined ? `${fmtInt(v)} kcal` : dash, sub: goalStatus(v, ctx.goals.caloriesBurned, " kcal").text, fill: pctFill(v, ctx.goals.caloriesBurned) }; },
    week: (ctx) => { const v = focusDay(ctx)?.caloriesOut; return { label: "Calories burned", value: fmtInt(v ?? 0), unit: " kcal", kind: "bars", color: S.activity, values: series(ctx, (d) => d.caloriesOut), goal: ctx.goals.caloriesBurned, format: fmtKcal, status: goalStatus(v, ctx.goals.caloriesBurned, " kcal") }; },
  },
  {
    id: "workouts", label: "Workouts", group: "Activity", tone: "activity", icon: Icon.fitness, tab: "fitness",
    available: (ctx) => ctx.data.exercise.length > 0 || (ctx.baseline?.exercise.length ?? 0) > 0,
    tile: (ctx) => {
      const w = ctx.data.exercise.filter((e) => e.date === ctx.period.anchor);
      return { value: w.length ? `${w.length} workout${w.length === 1 ? "" : "s"}` : "None", sub: w.length ? `${fmtDuration(w.reduce((t, e) => t + e.durationMin, 0))} total` : "No workouts recorded" };
    },
    week: (ctx) => {
      const days = new Set(ctx.data.exercise.filter((e) => ctx.dates.includes(e.date)).map((e) => e.date)).size;
      const goal = ctx.goals.exerciseDaysPerWeek;
      return { label: "Exercise days", value: `${days} of ${goal}`, kind: "bars", color: S.activity, values: exerciseSeries(ctx), goal: 1, format: () => "Exercised", status: days >= goal ? { tone: "good", text: "Goal met" } : { tone: "info", text: `${goal - days} left` } };
    },
  },
  {
    id: "caloriesEaten", label: "Calories eaten", group: "Food", tone: "food", icon: Icon.food, tab: "food",
    available: hasDay((d) => d.nutrition?.kcal),
    tile: (ctx) => { const v = focusDay(ctx)?.nutrition?.kcal ?? 0; return { value: `${fmtInt(v)} kcal`, sub: budgetStatus(v, ctx.goals.caloriesEaten, " kcal").text, fill: pctFill(v, ctx.goals.caloriesEaten) }; },
    week: (ctx) => { const v = focusDay(ctx)?.nutrition?.kcal; return { label: "Calories eaten", value: v !== undefined ? fmtInt(v) : dash, unit: v !== undefined ? " kcal" : undefined, kind: "bars", color: S.food, values: series(ctx, (d) => d.nutrition?.kcal), format: fmtKcal, status: budgetStatus(v, ctx.goals.caloriesEaten, " kcal") }; },
  },
  ...(["carbs", "fat", "protein"] as const).map((k): MetricDef => {
    const field = (`${k}G`) as "carbsG" | "fatG" | "proteinG";
    const label = k === "carbs" ? "Carbs" : k === "fat" ? "Fat" : "Protein";
    return {
      id: k, label, group: "Food", tone: "food", icon: Icon.food, tab: "food",
      available: hasDay((d) => d.nutrition?.[field]),
      tile: (ctx) => { const v = focusDay(ctx)?.nutrition?.[field] ?? 0; return { value: g(v), sub: ofGoal(ctx.goals[field], " g"), fill: pctFill(v, ctx.goals[field]) }; },
      week: (ctx) => { const v = focusDay(ctx)?.nutrition?.[field]; return { label, value: v !== undefined ? fmtInt(v) : dash, unit: v !== undefined ? " g" : undefined, kind: "line", color: `var(--macro-${k})`, values: series(ctx, (d) => d.nutrition?.[field]), goal: ctx.goals[field], format: g, status: goalStatus(v, ctx.goals[field], " g") }; },
    };
  }),
  {
    id: "fiber", label: "Fiber", group: "Food", tone: "food", icon: Icon.food, tab: "food",
    available: hasDay((d) => d.nutrition?.fiberG),
    tile: (ctx) => { const v = focusDay(ctx)?.nutrition?.fiberG; return { value: v !== undefined ? g(v) : "0 g" }; },
    week: (ctx) => { const v = focusDay(ctx)?.nutrition?.fiberG; return { label: "Fiber", value: v !== undefined ? fmtInt(v) : dash, unit: v !== undefined ? " g" : undefined, kind: "line", color: S.food, values: series(ctx, (d) => d.nutrition?.fiberG), format: g }; },
  },
  {
    id: "water", label: "Water", group: "Food", tone: "food", icon: Icon.food, tab: "food",
    available: hasDay((d) => d.waterMl),
    tile: (ctx) => { const W = waterUnits(ctx); const v = focusDay(ctx)?.waterMl; return { value: v !== undefined ? W.fmt(W.conv(v)) : dash }; },
    week: (ctx) => { const W = waterUnits(ctx); const v = focusDay(ctx)?.waterMl; return { label: "Water", value: v !== undefined ? W.fmt(W.conv(v)) : dash, kind: "bars", color: S.food, values: series(ctx, (d) => (d.waterMl !== undefined ? W.conv(d.waterMl) : undefined)), format: W.fmt }; },
  },
  {
    id: "heartRate", label: "Heart rate", group: "Heart", tone: "heart", icon: Icon.heart, tab: "body",
    available: hasDay((d) => d.heartRate),
    tile: (ctx) => { const d = focusDay(ctx); return { value: d?.heartRate ? `${fmtInt(d.heartRate.min)}–${fmtInt(d.heartRate.max)} bpm` : dash, sub: d?.restingHr ? `${fmtInt(d.restingHr)} bpm resting` : undefined }; },
    week: (ctx) => { const v = focusDay(ctx)?.heartRate?.avg; return { label: "Average heart rate", value: v !== undefined ? fmtInt(v) : dash, unit: v !== undefined ? " bpm" : undefined, kind: "line", color: S.heart, values: series(ctx, (d) => d.heartRate?.avg), format: fmtBpm }; },
  },
  {
    id: "restingHeartRate", label: "Resting heart rate", group: "Heart", tone: "heart", icon: Icon.heart, tab: "body",
    available: hasDay((d) => d.restingHr),
    tile: (ctx) => { const l = latest(ctx, (d) => d.restingHr); return { value: l ? fmtBpm(l.value) : dash, sub: rangeStatus(l?.value, typical(ctx, (d) => d.restingHr)).text }; },
    week: (ctx) => { const l = latest(ctx, (d) => d.restingHr); const band = typical(ctx, (d) => d.restingHr); return { label: "Resting heart rate", value: l ? fmtInt(l.value) : dash, unit: l ? " bpm" : undefined, kind: "line", color: S.heart, values: series(ctx, (d) => d.restingHr), band, format: fmtBpm, status: rangeStatus(l?.value, band) }; },
  },
  {
    id: "sleep", label: "Sleep", group: "Sleep", tone: "sleep", icon: Icon.sleep, tab: "sleep",
    available: (ctx) => ctx.data.sleep.length > 0 || (ctx.baseline?.sleep.length ?? 0) > 0,
    tile: (ctx) => { const n = tonight(ctx); return { value: n?.asleep ? fmtDuration(n.asleep) : dash, sub: n?.main ? `${fmtClock(minutesFrom(n.date, n.main.startLocal))} – ${fmtClock(minutesFrom(n.date, n.main.endLocal))}` : "No sleep recorded", fill: pctFill(n?.asleep, ctx.goals.sleepMinutes) }; },
    week: (ctx) => { const n = tonight(ctx); return { label: "Sleep", value: n?.asleep ? fmtDuration(n.asleep) : dash, kind: "line", color: "var(--sleep)", values: nights(ctx).map((x) => x.asleep || undefined), goal: ctx.goals.sleepMinutes, format: fmtDuration, status: sleepGoalStatus(ctx, n?.asleep) }; },
  },
  {
    id: "sleepSchedule", label: "Bedtime", group: "Sleep", tone: "sleep", icon: Icon.sleep, tab: "sleep",
    available: (ctx) => ctx.data.sleep.length > 0 || (ctx.baseline?.sleep.length ?? 0) > 0,
    tile: (ctx) => { const n = tonight(ctx); return n?.main ? { value: fmtClock(minutesFrom(n.date, n.main.startLocal)), sub: `Up at ${fmtClock(minutesFrom(n.date, n.main.endLocal))} · ${fmtDuration(n.main.minutesInBed)} in bed` } : { value: dash, sub: "No sleep recorded" }; },
  },
  ...(["deep", "rem"] as const).map((k): MetricDef => ({
    id: k === "deep" ? "deepSleep" : "remSleep", label: k === "deep" ? "Deep sleep" : "REM sleep", group: "Sleep", tone: "sleep", icon: Icon.sleep, tab: "sleep",
    available: hasSleep((n) => n.stages[k]),
    tile: (ctx) => { const n = tonight(ctx); const m = stageMins(n, k); return { value: m !== undefined ? fmtDuration(m) : dash, sub: m !== undefined && n?.main?.minutesInBed ? `${Math.round((m / n.main.minutesInBed) * 100)}% of the night` : "No sleep recorded" }; },
    week: (ctx) => { const m = stageMins(tonight(ctx), k); return { label: k === "deep" ? "Deep sleep" : "REM sleep", value: m !== undefined ? fmtDuration(m) : dash, kind: "line", color: `var(--stage-${k})`, values: nights(ctx).map((n) => stageMins(n, k)), format: fmtDuration }; },
  })),
  {
    id: "weight", label: "Weight", group: "Body", tone: "body", icon: Icon.scale, tab: "body",
    available: hasDay((d) => d.weightKg),
    tile: (ctx) => { const W = weight(ctx.units); const l = latest(ctx, (d) => d.weightKg); return { value: l ? W.formatConverted(W.convert(l.value)) : dash, sub: l ? (l.date === ctx.period.anchor ? "Weighed this day" : `as of ${fmtShortDate(l.date)}`) : "No weigh-ins" }; },
    week: (ctx) => { const W = weight(ctx.units); const l = latest(ctx, (d) => d.weightKg); return { label: "Weight", value: l ? W.convert(l.value).toFixed(1) : dash, unit: l ? ` ${W.unit}` : undefined, kind: "line", color: S.body, values: series(ctx, (d) => (d.weightKg !== undefined ? W.convert(d.weightKg) : undefined)), format: W.formatConverted, status: latestStatus(ctx, l, "Weighed") }; },
  },
  {
    id: "bodyFat", label: "Body fat", group: "Body", tone: "body", icon: Icon.scale, tab: "body",
    available: hasDay((d) => d.bodyFatPct),
    tile: (ctx) => { const l = latest(ctx, (d) => d.bodyFatPct); return { value: l ? fmtPct(l.value) : dash, sub: l && l.date !== ctx.period.anchor ? `as of ${fmtShortDate(l.date)}` : undefined }; },
    week: (ctx) => { const l = latest(ctx, (d) => d.bodyFatPct); return { label: "Body fat", value: l ? fmtPct(l.value) : dash, kind: "line", color: S.body, values: series(ctx, (d) => d.bodyFatPct), format: fmtPct, status: latestStatus(ctx, l, "Measured") }; },
  },
];

export const metricById = new Map(METRICS.map((m) => [m.id, m]));

/** Metrics that can go in a section, in registry order. */
export const metricsFor = (section: LayoutSection) => METRICS.filter((m) => (section === "today" ? m.tile : m.week));
