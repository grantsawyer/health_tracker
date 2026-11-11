import type { DailySummary, ExerciseSession, SummaryResponse } from "../../shared/summary";
import type { Goals } from "../../shared/goals";
import { ChartCard } from "../viz/ChartCard";
import { ColumnChart } from "../viz/ColumnChart";
import { LineChart } from "../viz/LineChart";
import { MiniTrend } from "../viz/MiniTrend";
import { RangeBar } from "../viz/RangeBar";
import { Ring } from "../viz/Ring";
import { ScheduleChart, fmtClock } from "../viz/ScheduleChart";
import { SleepTimeline } from "../viz/SleepTimeline";
import { fmtLongDate, fmtShortDate } from "../viz/scale";
import { Icon } from "../ui/icons";
import { Pill, type Status } from "../ui/Pill";
import { distance, fmtBpm, fmtDuration, fmtInt, fmtKcal, fmtMin, fmtPct, weight, type UnitSystem } from "../units";
import { budgetStatus, goalStatus, rangeStatus, rollingAverage, typicalRange } from "./baseline";
import type { Period } from "./period";
import { bedtimeOffset, checkSchedule, describeDiff, minutesFrom, nightsByDate, type Night } from "./sleep";
import { ScheduleGoalEditor } from "../ui/ScheduleGoalEditor";
import { SCHEDULE_TOLERANCE_MIN } from "../../shared/goals";
import { compareStagesOver, efficiencyPct, efficiencySentence } from "./sleepStages";
import { INTERRUPTION_MIN, qualityRows } from "./sleepQuality";
import { VITALS, fitnessLevel, type VitalDef } from "./vitals";
import { useEffect, useState, type ReactNode } from "react";
import { CardBoard } from "./CardBoard";
import { metricById, type MetricDef } from "./cards";
import { useLayout } from "./useLayout";
import { GoalEditor } from "../ui/GoalEditor";
import { useGoalsContext } from "./goalsContext";
import { api } from "../api";
import type { SettingsSyncInfo } from "../../shared/types";
import { LAYOUT_LIMITS, type TodayLayout } from "../../shared/layout";

export type { Tab, ViewCtx } from "./ctx";
import type { ViewCtx } from "./ctx";
import { ORD, S, avg, azmTotal, byDate, dash, elapsedDays, focusDay, lastWith, pctFill, periodWord, series, sum, table, typical, upToAnchor } from "./ctx";

// ── Today ────────────────────────────────────────────────────────────────────

function Tile(p: { tone: string; icon: () => React.JSX.Element; label: string; value: string; sub?: string; fill?: string; onOpen: () => void }) {
  return (
    <button className={`tile tone-${p.tone}`} style={{ ["--fill" as string]: p.fill ?? "0%" }} onClick={p.onOpen}
      aria-label={`${p.label}: ${p.value}${p.sub ? `, ${p.sub}` : ""}`}>
      <span className="tile-icon"><p.icon /></span>
      <span className="tile-text">
        <span className="tile-label">{p.label}</span>
        <span className="tile-value">{p.value}</span>
        {p.sub && <span className="tile-sub">{p.sub}</span>}
      </span>
    </button>
  );
}

/**
 * Today: a fixed steps square beside a customizable block of "today" tiles,
 * then a customizable "Last 7 days" grid. Customize mode lets the owner add,
 * remove and reorder cards from the registry in cards.tsx; the layout is
 * saved per user (app.db).
 */
/**
 * First run: until the user saves goals, the app runs on generic published targets (shared/goals.ts). Say so on
 * Today, with a way to adjust them or keep them (either saves, which hides the card).
 *
 * If Drive sync is paused (a new browser that hasn't connected Drive yet), the user's goals may already be in Drive.
 * Saving defaults here would make them the newest copy and overwrite the real goals on the next sync, so the card
 * offers "Connect Google Drive" instead and reloads goals once settings arrive.
 */
function FirstRunGoals({ ctx }: { ctx: ViewCtx }) {
  const { goals, saved, save, reload } = useGoalsContext();
  const [busy, setBusy] = useState(false);
  const [sync, setSync] = useState<SettingsSyncInfo | null>(null);
  useEffect(() => {
    if (saved) return;
    void api.settingsSync().then(setSync);
    return api.watchSettingsSync(setSync);
  }, [saved]);
  if (saved || !sync) return null;
  if (sync.state === "paused") {
    return (
      <section className="card card-wide first-run" aria-labelledby="first-run-h">
        <h2 id="first-run-h">Bring your goals here</h2>
        <p>
          If you've used Health Tracker in another browser, your goals, Today layout and favorites are saved in your
          Google Drive. Connect Drive to load them. New here? Connect anyway, and you'll be offered starting goals.
        </p>
        <div className="actions">
          <button className="primary" disabled={busy} onClick={() => {
            // Called straight from the click: Drive sign-in opens Google's pop-up.
            setBusy(true);
            api.connectDrive().then(() => reload()).finally(() => setBusy(false));
          }}>{busy ? "Connecting…" : "Connect Google Drive"}</button>
        </div>
      </section>
    );
  }
  return (
    <section className="card card-wide first-run" aria-labelledby="first-run-h">
      <h2 id="first-run-h">Set your goals</h2>
      <p>
        Health Tracker starts with general targets, not yours: {fmtInt(goals.steps)} steps, {fmtInt(goals.caloriesEaten)} kcal
        eaten, {goals.carbsG} g carbs, {goals.fatG} g fat and {goals.proteinG} g protein a day (FDA Daily Values and Fitbit's
        default targets). Rings, goal lines and status labels use them.
      </p>
      <div className="actions">
        <button className="primary" onClick={ctx.openAccount}>Adjust goals</button>
        <button disabled={busy} onClick={async () => { setBusy(true); try { await save({ steps: goals.steps }); } finally { setBusy(false); } }}>
          {busy ? "Saving…" : "Keep these"}
        </button>
      </div>
    </section>
  );
}

export function TodayView(ctx: ViewCtx) {
  const { goals } = ctx;
  const day = focusDay(ctx);
  const { layout, save, reset } = useLayout();
  const [draft, setDraft] = useState<TodayLayout | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const editing = draft !== null;
  const shown = draft ?? layout;

  const done = async () => {
    if (!draft) return;
    setSaving(true);
    setError(null);
    try {
      await save(draft);
      setDraft(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const tile = (def: MetricDef) => {
    const c = def.tile!(ctx);
    return <Tile tone={def.tone} icon={def.icon} label={def.label} value={c.value} sub={c.sub} fill={c.fill} onOpen={() => ctx.open(def.tab)} />;
  };
  const ring = (
    <div className="ring-card">
      <Ring label="Steps" value={day?.steps ?? 0} goal={goals.steps} valueText={fmtInt(day?.steps ?? 0)} goalText={`of ${fmtInt(goals.steps)}`} />
      <span className="ring-goal-edit"><GoalEditor goalKey="steps" label="Steps" /></span>
    </div>
  );
  const week = (def: MetricDef) => (
    <MiniTrend {...def.week!(ctx)} title={def.week!(ctx).label === def.label ? def.label : def.week!(ctx).label} label={`${def.label}, last 7 days`}
      dates={ctx.dates} today={ctx.today} onOpen={() => ctx.open(def.tab)} />
  );

  return (
    <div className="dash">
      <FirstRunGoals ctx={ctx} />
      <section className="today-wrap" aria-label="The day at a glance">
        <CardBoard section="today" className="today-grid" ids={shown.today} limit={LAYOUT_LIMITS.today} editing={editing} ctx={ctx}
          defs={metricById} render={(def) => (def.id === "stepsRing" ? ring : tile(def))} onChange={(today) => setDraft({ ...shown, today })} />
      </section>

      <div className="quick-actions">
        {editing ? (
          <>
            <button className="primary" onClick={done} disabled={saving}><Icon.check /> {saving ? "Saving…" : "Done"}</button>
            <button onClick={() => { setDraft(null); setError(null); }}>Cancel</button>
            <button onClick={async () => { await reset(); setDraft(null); }}>Reset to default</button>
            <span className="muted small">Drag cards to rearrange, or use the arrows.</span>
          </>
        ) : (
          <>
            <button className="primary" onClick={ctx.logFood}><Icon.plus /> Log food</button>
            <button onClick={() => setDraft(layout)}><Icon.edit /> Customize</button>
          </>
        )}
      </div>
      {error && <p className="error-text" role="alert">{error}</p>}

      <h2 className="section-title">{ctx.dates.includes(ctx.today) ? "Last 7 days" : `7 days to ${fmtShortDate(ctx.dates[ctx.dates.length - 1]!)}`}</h2>
      <div className="week-wrap">
        <CardBoard section="week" className="mini-grid" ids={shown.week} limit={LAYOUT_LIMITS.week} editing={editing} ctx={ctx}
          defs={metricById} render={week} onChange={(w) => setDraft({ ...shown, week: w })} />
      </div>
    </div>
  );
}

// ── Fitness ──────────────────────────────────────────────────────────────────

export function FitnessView(ctx: ViewCtx) {
  const { goals, units } = ctx;
  const D = distance(units);
  const day = focusDay(ctx);
  const isDay = ctx.period.kind === "D";
  const m = byDate(ctx.data);
  const steps = series(ctx, (d) => d.steps);
  const burned = series(ctx, (d) => d.caloriesOut);
  const azm = (day && azmTotal(day)) ?? 0;
  const workouts = ctx.data.exercise.filter((e) => (isDay ? e.date === ctx.period.anchor : ctx.dates.includes(e.date)));
  const exerciseDays = new Set(ctx.data.exercise.filter((e) => ctx.dates.includes(e.date)).map((e) => e.date)).size;
  const exerciseGoal = goals.exerciseDaysPerWeek * Math.max(1, Math.round(ctx.dates.length / 7));
  const stepsAvg = avg(steps);

  return (
    <div className="dash">
      {isDay && (
        <section className="day-hero" aria-label="Activity for the day">
          <div className="ring-card">
            <Ring label="Steps" value={day?.steps ?? 0} goal={goals.steps} valueText={fmtInt(day?.steps ?? 0)} goalText={`of ${fmtInt(goals.steps)}`} />
          </div>
          <div className="ranges">
            <RangeBar label="Active zone minutes" detail={`${fmtInt(azm)} of ${fmtInt(goals.activeZoneMinutes)}`} value={azm} max={Math.max(goals.activeZoneMinutes * 1.5, azm)} color={S.activity} target={goals.activeZoneMinutes} status={goalStatus(azm, goals.activeZoneMinutes)} action={<GoalEditor goalKey="activeZoneMinutes" label="Active zone minutes" />} />
            <RangeBar label="Calories burned" detail={`${fmtInt(day?.caloriesOut ?? 0)} of ${fmtInt(goals.caloriesBurned)} kcal`} value={day?.caloriesOut} max={Math.max(goals.caloriesBurned * 1.5, day?.caloriesOut ?? 0)} color={S.activity} target={goals.caloriesBurned} status={goalStatus(day?.caloriesOut, goals.caloriesBurned, " kcal")} action={<GoalEditor goalKey="caloriesBurned" label="Calories burned" unit=" kcal" />} />
            <RangeBar label="Floors" detail={`${fmtInt(day?.floors ?? 0)} of ${fmtInt(goals.floors)}`} value={day?.floors ?? 0} max={Math.max(goals.floors * 1.5, day?.floors ?? 0)} color={S.activity} target={goals.floors} status={goalStatus(day?.floors ?? 0, goals.floors)} action={<GoalEditor goalKey="floors" label="Floors" />} />
            <div className="range-row"><div className="range-head" style={{ marginBottom: 0 }}><span><b>Distance</b> · {day?.distanceKm !== undefined ? D.format(day.distanceKm) : dash}</span></div></div>
          </div>
        </section>
      )}

      <div className="dash-grid">
        <ChartCard title="Steps" goal={<GoalEditor goalKey="steps" label="Steps" />} value={isDay ? fmtInt(day?.steps ?? 0) : stepsAvg !== undefined ? fmtInt(stepsAvg) : dash} unit={isDay ? undefined : " a day on average"}
          subtitle={`Goal met on ${steps.filter((v) => v !== undefined && v >= goals.steps).length} of ${elapsedDays(ctx)} days ${periodWord(ctx)}`} loading={ctx.loading}
          table={table(ctx, ["Steps", `Distance (${D.unit})`, "Floors"], (_, d) => [d?.steps !== undefined ? fmtInt(d.steps) : dash, d?.distanceKm !== undefined ? D.convert(d.distanceKm).toFixed(2) : dash, d?.floors ?? dash])}>
          <ColumnChart today={ctx.today} rows={ctx.dates.map((date, i) => ({ date, values: [steps[i]] }))} series={[{ label: "Steps", color: S.activity }]} format={fmtInt}
            reference={{ value: goals.steps, label: `Goal ${fmtInt(goals.steps)}`, badges: true }} />
        </ChartCard>

        <ChartCard title="Active zone minutes" goal={<GoalEditor goalKey="activeZoneMinutes" label="Active zone minutes" />} value={fmtInt(sum(series(ctx, azmTotal)))} unit={` ${periodWord(ctx)}`} subtitle="Cardio and peak minutes count double" loading={ctx.loading}
          legend={[{ label: "Fat burn", color: ORD[0]!, shape: "rect" }, { label: "Cardio", color: ORD[1]!, shape: "rect" }, { label: "Peak", color: ORD[2]!, shape: "rect" }]}
          table={table(ctx, ["Fat burn", "Cardio", "Peak", "Total"], (_, d) => [d?.azm?.fatBurn ?? dash, d?.azm?.cardio ?? dash, d?.azm?.peak ?? dash, d && azmTotal(d) !== undefined ? azmTotal(d)! : dash])}>
          <ColumnChart today={ctx.today} rows={ctx.dates.map((date) => ({ date, values: [m.get(date)?.azm?.fatBurn, m.get(date)?.azm?.cardio, m.get(date)?.azm?.peak] }))}
            series={[{ label: "Fat burn", color: ORD[0]! }, { label: "Cardio", color: ORD[1]! }, { label: "Peak", color: ORD[2]! }]} format={fmtInt}
            reference={{ value: goals.activeZoneMinutes, label: `Goal ${goals.activeZoneMinutes}`, badges: true }} />
        </ChartCard>

        <ChartCard title="Calories burned" goal={<GoalEditor goalKey="caloriesBurned" label="Calories burned" unit=" kcal" />} value={isDay ? fmtInt(day?.caloriesOut ?? 0) : fmtInt(avg(burned) ?? 0)} unit={isDay ? " kcal" : " kcal a day on average"} loading={ctx.loading}
          table={table(ctx, ["kcal"], (_, d) => [d?.caloriesOut !== undefined ? fmtInt(d.caloriesOut) : dash])}>
          <ColumnChart today={ctx.today} rows={ctx.dates.map((date, i) => ({ date, values: [burned[i]] }))} series={[{ label: "Calories burned", color: S.activity }]} format={fmtKcal}
            reference={{ value: goals.caloriesBurned, label: `Goal ${fmtInt(goals.caloriesBurned)}`, badges: true }} />
        </ChartCard>

        <ChartCard title="Active minutes" subtitle="By intensity" loading={ctx.loading}
          legend={[{ label: "Light", color: ORD[0]!, shape: "rect" }, { label: "Moderate", color: ORD[1]!, shape: "rect" }, { label: "Vigorous", color: ORD[2]!, shape: "rect" }]}
          table={table(ctx, ["Light", "Moderate", "Vigorous"], (_, d) => [d?.activeMinutes?.light ?? dash, d?.activeMinutes?.moderate ?? dash, d?.activeMinutes?.vigorous ?? dash])}>
          <ColumnChart today={ctx.today} rows={ctx.dates.map((date) => ({ date, values: [m.get(date)?.activeMinutes?.light, m.get(date)?.activeMinutes?.moderate, m.get(date)?.activeMinutes?.vigorous] }))}
            series={[{ label: "Light", color: ORD[0]! }, { label: "Moderate", color: ORD[1]! }, { label: "Vigorous", color: ORD[2]! }]} format={fmtMin} />
        </ChartCard>
      </div>

      <section className={`viz-card ${ctx.loading ? "viz-loading" : ""}`}>
        <div className="viz-card-head">
          <div>
            <h3 className="viz-card-title">Workouts</h3>
            {!isDay && <p className="viz-card-value">{exerciseDays}<small> of {exerciseGoal} exercise days</small></p>}
          </div>
          <div className="viz-card-actions">
            {!isDay && <Pill tone={exerciseDays >= exerciseGoal ? "good" : "info"}>{exerciseDays >= exerciseGoal ? "Goal met" : `${exerciseGoal - exerciseDays} left`}</Pill>}
            <GoalEditor goalKey="exerciseDaysPerWeek" label="Exercise days per week" unit=" a week" />
          </div>
        </div>
        {workouts.length ? <WorkoutTable sessions={[...workouts].reverse()} units={units} showDate={!isDay} /> : <p className="viz-card-sub">No workouts recorded {isDay ? "this day" : "in this period"}.</p>}
      </section>
    </div>
  );
}

const prettyType = (t: string) => t.charAt(0) + t.slice(1).toLowerCase().replace(/_/g, " ");
const normType = (t: string) => t.toUpperCase().replace(/[^A-Z]/g, "");

function WorkoutTable({ sessions, units, showDate }: { sessions: ExerciseSession[]; units: UnitSystem; showDate: boolean }) {
  const D = distance(units);
  return (
    <div className="viz-table-wrap">
      <table className="viz-table">
        <thead>
          <tr>{showDate && <th>Date</th>}<th>Workout</th><th>Start</th><th>Duration</th><th>Distance</th><th>Avg HR</th><th>Calories</th></tr>
        </thead>
        <tbody>
          {sessions.map((s) => (
            <tr key={s.id}>
              {showDate && <td>{fmtShortDate(s.date)}</td>}
              <td style={{ textAlign: "left" }}>{s.displayName}{!normType(s.type).startsWith(normType(s.displayName)) && !normType(s.displayName).startsWith(normType(s.type)) ? <span className="muted"> · {prettyType(s.type)}</span> : null}</td>
              <td>{fmtClock(minutesFrom(s.date, s.startLocal))}</td>
              <td>{fmtDuration(s.durationMin)}</td>
              <td>{s.distanceKm ? D.format(s.distanceKm) : dash}</td>
              <td>{s.avgHr ? fmtBpm(s.avgHr) : dash}</td>
              <td>{s.calories ? fmtKcal(s.calories) : dash}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Sleep ────────────────────────────────────────────────────────────────────

export function SleepView(ctx: ViewCtx) {
  const { goals } = ctx;
  const nights = nightsByDate(ctx.data.sleep, ctx.dates.map((date) => ({ date })));
  const isDay = ctx.period.kind === "D";
  const night = nights.find((n) => n.date === ctx.period.anchor);
  const baseNights = ctx.baseline ? nightsByDate(ctx.baseline.sleep, ctx.baseline.days).filter((n) => n.main) : [];
  const shown = nights.filter((n) => n.date <= ctx.today);
  const tracked = shown.filter((n) => n.main);
  const sched = nights.map((n) => ({ date: n.date, start: n.main ? minutesFrom(n.date, n.main.startLocal) : undefined, end: n.main ? minutesFrom(n.date, n.main.endLocal) : undefined }));
  const h = (min: number) => min / 60;
  const naps = ctx.data.sleep.filter((s) => s.isNap && (isDay ? s.date === ctx.period.anchor : ctx.dates.includes(s.date)));
  const avgAsleep = avg(tracked.map((n) => n.asleep));
  const avgStart = avg(sched.map((s) => s.start)), avgEnd = avg(sched.map((s) => s.end));
  const vsGoal = (min: number | undefined): Status | undefined =>
    goals.sleepMinutes && min !== undefined ? (min >= goals.sleepMinutes ? { tone: "good", text: "Goal met" } : { tone: "warn", text: "Goal not met" }) : undefined;

  // Bedtime / wake goals: each night on schedule when both are within ±SCHEDULE_TOLERANCE_MIN of their goals.
  const tol = SCHEDULE_TOLERANCE_MIN;
  const hasSchedGoal = goals.bedtime !== null || goals.wakeTime !== null;
  const checks = sched.map((s) => checkSchedule(s, goals, tol));
  const schedNotes = checks.map((c): [string, string][] | undefined => {
    const out: [string, string][] = [];
    if (c.bedDiff !== undefined) out.push(["vs bedtime goal", describeDiff(c.bedDiff, tol)]);
    if (c.wakeDiff !== undefined) out.push(["vs wake goal", describeDiff(c.wakeDiff, tol)]);
    return out.length ? out : undefined;
  });
  const judged = checks.filter((c, i) => c.onSchedule !== undefined && nights[i]!.date <= ctx.today);
  const onSched = judged.filter((c) => c.onSchedule).length;
  const schedStatus: Status | undefined = hasSchedGoal && judged.length
    ? { tone: onSched === judged.length ? "good" : "info", text: `On schedule ${onSched} of ${judged.length} night${judged.length === 1 ? "" : "s"}` }
    : undefined;
  const nightCheck = isDay ? checks[nights.findIndex((n) => n.date === ctx.period.anchor)] : undefined;
  const scheduleNote = nightCheck?.onSchedule === undefined ? undefined
    : `${nightCheck.onSchedule ? "On schedule" : "Off schedule"}: ${[
      nightCheck.bedDiff !== undefined && `bedtime ${describeDiff(nightCheck.bedDiff, tol)}`,
      nightCheck.wakeDiff !== undefined && `wake time ${describeDiff(nightCheck.wakeDiff, tol)}`,
    ].filter(Boolean).join(", ")}.`;

  return (
    <div className="dash">
      {isDay
        ? <NightDetail night={night} baseline={baseNights} status={vsGoal(night?.asleep || undefined)} scheduleNote={scheduleNote} />
        : <PeriodSleepDetail nights={tracked} baseline={baseNights} status={vsGoal(avgAsleep)} times={avgStart !== undefined && avgEnd !== undefined ? `${fmtClock(avgStart)} – ${fmtClock(avgEnd)}` : undefined} loading={ctx.loading} />}

      <div className="dash-grid">
        <SleepQuality nights={isDay ? (night ? [night] : []) : tracked} baseline={baseNights} isDay={isDay} loading={ctx.loading} />
        <ChartCard title="Time asleep" goal={<GoalEditor goalKey="sleepMinutes" label="Sleep" unit=" h" scale={60} format={fmtDuration} />} value={avgAsleep !== undefined ? fmtDuration(avgAsleep) : dash} unit=" on average"
          subtitle={`${tracked.length} of ${shown.length} nights tracked${goals.sleepMinutes ? ` · goal ${fmtDuration(goals.sleepMinutes)}` : ""}`} status={vsGoal(avgAsleep)} loading={ctx.loading}
          legend={[{ label: "Deep", color: "var(--stage-deep)", shape: "rect" }, { label: "REM", color: "var(--stage-rem)", shape: "rect" }, { label: "Light", color: "var(--stage-light)", shape: "rect" }, { label: "Awake", color: "var(--stage-awake)", shape: "rect" }]}
          table={{ columns: ["Night", "Asleep", "Deep", "REM", "Light", "Awake"], rows: shown.map((n) => [fmtShortDate(n.date), n.asleep ? fmtDuration(n.asleep) : dash, n.main ? fmtDuration(n.stages.deep) : dash, n.main ? fmtDuration(n.stages.rem) : dash, n.main ? fmtDuration(n.stages.light + n.stages.asleep) : dash, n.main ? fmtDuration(n.stages.awake + n.stages.restless) : dash]) }}>
          <ColumnChart today={ctx.today}
            rows={nights.map((n) => ({ date: n.date, values: n.main ? [h(n.stages.deep), h(n.stages.rem), h(n.stages.light + n.stages.asleep), h(n.stages.awake + n.stages.restless)] : [undefined, undefined, undefined, undefined] }))}
            series={[{ label: "Deep", color: "var(--stage-deep)" }, { label: "REM", color: "var(--stage-rem)" }, { label: "Light", color: "var(--stage-light)" }, { label: "Awake", color: "var(--stage-awake)" }]}
            format={(v) => fmtDuration(v * 60)} tickFormat={(v) => `${v}h`}
            reference={goals.sleepMinutes ? { value: h(goals.sleepMinutes), label: `Goal ${fmtDuration(goals.sleepMinutes)}` } : undefined} />
        </ChartCard>

        <ChartCard title="Sleep schedule" goal={<ScheduleGoalEditor />} status={schedStatus}
          value={avgStart !== undefined && avgEnd !== undefined ? `${fmtClock(avgStart)} – ${fmtClock(avgEnd)}` : dash}
          subtitle={hasSchedGoal ? `Average bedtime to wake time. On schedule = within ${tol} min of each goal.` : "Average bedtime to wake time"} loading={ctx.loading}
          table={{
            columns: ["Night", "Bedtime", "Wake", "In bed", ...(hasSchedGoal ? ["On schedule"] : [])],
            rows: nights.map((n, i) => ({ n, s: sched[i]!, c: checks[i]! })).filter(({ n }) => n.date <= ctx.today).map(({ n, s, c }) => [
              fmtShortDate(n.date), s.start !== undefined ? fmtClock(s.start) : dash, s.end !== undefined ? fmtClock(s.end) : dash, n.main ? fmtDuration(n.main.minutesInBed) : dash,
              ...(hasSchedGoal ? [c.onSchedule === undefined ? dash : c.onSchedule ? "Yes" : "No"] : []),
            ]),
          }}>
          <ScheduleChart rows={sched} color="var(--sleep)"
            goal={hasSchedGoal ? { start: goals.bedtime !== null ? bedtimeOffset(goals.bedtime) : undefined, end: goals.wakeTime ?? undefined, tolerance: tol } : undefined}
            onSchedule={checks.map((c) => c.onSchedule)} notes={schedNotes} />
        </ChartCard>
      </div>

      {naps.length > 0 && (
        <section className="viz-card">
          <h3 className="viz-card-title">Naps</h3>
          <table className="viz-table">
            <thead><tr><th>Date</th><th>Start</th><th>Asleep</th></tr></thead>
            <tbody>{[...naps].reverse().map((s) => <tr key={s.id}><td>{fmtLongDate(s.date)}</td><td>{fmtClock(minutesFrom(s.date, s.startLocal))}</td><td>{fmtDuration(s.minutesAsleep)}</td></tr>)}</tbody>
          </table>
        </section>
      )}
    </div>
  );
}

type NightView = "timeline" | "usual" | "average";

/**
 * The night card, after the owner's reference screenshot: headline duration
 * and times, an efficiency sentence, then one of three views chosen with chips
 * underneath: the stage timeline, each stage's share of the night compared
 * with the last 30 nights (dashed box = usual range), or the 30-day averages.
 */
function NightDetail({ night, baseline, status, scheduleNote }: { night: Night | undefined; baseline: Night[]; status?: Status; scheduleNote?: string }) {
  const main = night?.main;
  if (!main || !night) {
    return <section className="viz-card"><h3 className="viz-card-title">Sleep duration</h3><p className="viz-card-sub">No sleep recorded for this night.</p></section>;
  }
  const efficiency = efficiencyPct(night);
  return (
    <SleepDetailCard
      value={fmtDuration(night.asleep)} times={`${main.startLocal.slice(11, 16)} – ${main.endLocal.slice(11, 16)}`}
      sub={<>You spent {fmtDuration(main.minutesInBed)} in bed, with a sleep efficiency of {efficiency !== undefined ? pctText(efficiency) : "—"}.{" "}{efficiencySentence(night, baseline) ?? ""}</>}
      note={scheduleNote} status={status} nights={[night]} baseline={baseline} timeline={<SleepTimeline session={main} />} />
  );
}

/**
 * W/M/3M: the same card for the period's tracked nights (average duration, stage shares vs usual, 30-day averages).
 * No timeline: a hypnogram only makes sense for one night (owner request 2026-11-11).
 */
function PeriodSleepDetail({ nights, baseline, status, times, loading }: { nights: Night[]; baseline: Night[]; status?: Status; times?: string; loading: boolean }) {
  if (!nights.length) {
    return <section className="viz-card"><h3 className="viz-card-title">Sleep duration</h3><p className="viz-card-sub">{loading ? "Loading…" : "No sleep recorded in this period."}</p></section>;
  }
  const meanOf = (xs: (number | undefined)[]) => {
    const v = xs.filter((x): x is number => x !== undefined);
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : undefined;
  };
  const asleep = meanOf(nights.map((n) => n.asleep))!;
  const inBed = meanOf(nights.map((n) => n.main?.minutesInBed));
  const efficiency = meanOf(nights.map(efficiencyPct));
  return (
    <SleepDetailCard value={fmtDuration(asleep)} unit="on average" times={times}
      sub={<>Average of {nights.length} night{nights.length === 1 ? "" : "s"}: {inBed !== undefined ? fmtDuration(inBed) : "—"} in bed, with a sleep efficiency of {efficiency !== undefined ? pctText(efficiency) : "—"}.</>}
      status={status} nights={nights} baseline={baseline} />
  );
}

const pctText = (v: number) => `${Math.round(v)}%`;

function SleepDetailCard({ value, unit, times, sub, note, status, nights, baseline, timeline }: {
  value: string; unit?: string; times?: string; sub: ReactNode; note?: string; status?: Status;
  nights: Night[]; baseline: Night[];
  /** One night only: the stage timeline, shown first. Without it the card opens on "Compared with usual". */
  timeline?: ReactNode;
}) {
  const [picked, setView] = useState<NightView>(timeline ? "timeline" : "usual");
  const view: NightView = !timeline && picked === "timeline" ? "usual" : picked;
  const rows = compareStagesOver(nights, baseline);
  const history = baseline.filter((b) => b.main).length;
  const views = ([["timeline", "Timeline"], ["usual", "Compared with usual"], ["average", "30-day average"]] as const).filter(([k]) => k !== "timeline" || timeline);

  return (
    <section className="viz-card night-card" aria-labelledby="night-h">
      <div className="viz-card-head">
        <div>
          <h3 className="viz-card-title" id="night-h">Sleep duration</h3>
          <p className="viz-card-value">{value}{(unit || times) && <small>{[unit?.trim(), times].filter(Boolean).join(" · ")}</small>}</p>
          <p className="viz-card-sub">{sub}</p>
          {note && <p className="viz-card-sub">{note}</p>}
        </div>
        <div className="viz-card-actions">
          {status && <Pill tone={status.tone}>{status.text}</Pill>}
          <GoalEditor goalKey="sleepMinutes" label="Sleep" unit=" h" scale={60} format={fmtDuration} />
        </div>
      </div>

      <div className="night-view">
        {view === "timeline" && timeline}
        {view !== "timeline" && (
          <div className="ranges flat stage-bars">
            {rows.map((r) => {
              const usual = r.usual ? { lo: Math.max(0, r.usual.lo), hi: Math.min(100, r.usual.hi) } : undefined;
              return view === "usual" ? (
                <RangeBar key={r.key} label={r.label} detail={`${pctText(r.pct)} · ${fmtDuration(r.minutes)}`} value={r.pct} max={100}
                  color={r.color} range={usual} rangeTint={r.color} status={r.status} />
              ) : (
                <RangeBar key={r.key} label={r.label}
                  detail={r.avgPct !== undefined && r.avgMinutes !== undefined ? `${pctText(r.avgPct)} · ${fmtDuration(r.avgMinutes)}` : "No history"}
                  value={r.avgPct} max={100} color={r.color} />
              );
            })}
            <p className="range-note">
              {view === "usual"
                ? <><i className="range-key" /> Your usual range: average ± 1 standard deviation over your last {history} nights</>
                : <>Average share of each night over your last {history} nights</>}
            </p>
          </div>
        )}
      </div>

      <div className="meal-chips night-chips" role="group" aria-label="Sleep view">
        {views.map(([k, label]) => (
          <button key={k} className="chip" aria-pressed={view === k} onClick={() => setView(k)}>
            {view === k && <Icon.check />}{label}
          </button>
        ))}
      </div>
    </section>
  );
}

/**
 * Sleep quality (after the Google Health app's card): time to sound sleep, sound sleep, restlessness and
 * interruptions, each against the owner's usual range. D = that night; W/M/3M = the average of the period's nights.
 * Definitions in sleepQuality.ts, repeated on the card because Google doesn't publish its own.
 */
function SleepQuality({ nights, baseline, isDay, loading }: { nights: Night[]; baseline: Night[]; isDay: boolean; loading: boolean }) {
  const rows = qualityRows(nights.map((n) => n.main), baseline.map((b) => b.main));
  const history = baseline.filter((b) => b.main).length;
  const sub = isDay ? "This night, compared with your usual" : `Average of ${nights.length} night${nights.length === 1 ? "" : "s"}, compared with your usual`;
  const times = (c: number) => (isDay ? `${Math.round(c)} time${Math.round(c) === 1 ? "" : "s"}` : `${c.toFixed(1)} times a night`);
  // One minutes axis for all four rows (like the macro bars): the same minutes sit at the same x on every track.
  // It ends 15% past the largest value or usual-range edge.
  const minutesAxis = Math.max(10, ...rows.flatMap((r) => [r.value ?? 0, r.usual?.hi ?? 0])) * 1.15;
  return (
    <section className={`viz-card ${loading ? "viz-loading" : ""}`} aria-labelledby="quality-h">
      <div className="viz-card-head">
        <div>
          <h3 className="viz-card-title" id="quality-h">Sleep quality</h3>
          <p className="viz-card-sub">{sub}</p>
        </div>
      </div>
      {rows.length === 0 ? (
        <p className="viz-card-sub" style={{ marginTop: 12 }}>No sleep stages recorded {isDay ? "for this night" : "in this period"}.</p>
      ) : (
        <div className="ranges flat" style={{ marginTop: 12 }}>
          {rows.map((r) => {
            const usual = r.usual ? { lo: Math.max(0, r.usual.lo), hi: r.usual.hi } : undefined;
            const detail = r.value === undefined ? "No data"
              : r.key === "interruptions" && r.count !== undefined ? `${fmtDuration(r.value)} · ${times(r.count)}` : fmtDuration(r.value);
            return <RangeBar key={r.key} label={r.label} detail={detail} value={r.value} max={minutesAxis} color="var(--sleep)"
              range={usual} rangeTint="var(--sleep)" status={r.status} knob />;
          })}
          <p className="range-note">
            <i className="range-key" /> Your usual range: average ± 1 standard deviation over your last {history} nights.
          </p>
          <details className="range-note">
            <summary>How these are measured</summary>
            Google doesn't share these figures, so the app works them out from each night's sleep stages.{" "}
            <b>Time to sound sleep</b>: from the start of the night to the first deep sleep. <b>Sound sleep</b>: time in deep
            sleep. <b>Restlessness</b>: time awake in spells shorter than {INTERRUPTION_MIN} minutes, between falling asleep and
            the final wake-up. <b>Interruptions</b>: awake spells of {INTERRUPTION_MIN} minutes or more in that time.
          </details>
        </div>
      )}
    </section>
  );
}

// ── Body ─────────────────────────────────────────────────────────────────────

export function BodyView(ctx: ViewCtx) {
  const W = weight(ctx.units);
  const m = byDate(ctx.data);
  const wVals = series(ctx, (d) => (d.weightKg !== undefined ? W.convert(d.weightKg) : undefined));
  // Average over baseline + displayed days so the line has history at the start of the range.
  const allDays = new Map([...(ctx.baseline?.days ?? []), ...ctx.data.days].map((d) => [d.date, d]));
  const sorted = [...allDays.values()].sort((a, b) => a.date.localeCompare(b.date));
  const rolled = rollingAverage(sorted.map((d) => (d.weightKg !== undefined ? W.convert(d.weightKg) : undefined)));
  const rollByDate = new Map(sorted.map((d, i) => [d.date, rolled[i]]));
  const wAvg = ctx.dates.map((d) => rollByDate.get(d));
  const latestW = lastWith(upToAnchor(ctx), (d) => d.weightKg);
  const restTyp = typical(ctx, (d) => d.restingHr);
  const latestRest = lastWith(upToAnchor(ctx), (d) => d.restingHr);
  const latestFat = lastWith(upToAnchor(ctx), (d) => d.bodyFatPct);
  const hr = series(ctx, (d) => d.heartRate?.avg);
  const rest = series(ctx, (d) => d.restingHr);
  const fat = series(ctx, (d) => d.bodyFatPct);

  return (
    <div className="dash">
      <div className="dash-grid two-up">
        <ChartCard title="Weight" value={latestW ? W.convert(latestW.value).toFixed(1) : dash} unit={latestW ? ` ${W.unit}` : undefined}
          subtitle={latestW ? (latestW.date === ctx.today ? "Weighed today" : `Last weigh-in ${fmtShortDate(latestW.date)}`) : "No weigh-ins in this period"} loading={ctx.loading}
          legend={[{ label: "Daily", color: S.body, shape: "line" }, { label: "7-day average", color: "var(--viz-muted)", shape: "line" }]}
          table={table(ctx, [`Weight (${W.unit})`, "7-day avg"], (date, d) => [d?.weightKg !== undefined ? W.convert(d.weightKg).toFixed(1) : dash, rollByDate.get(date)?.toFixed(1) ?? dash])}>
          <LineChart today={ctx.today} rows={ctx.dates.map((date, i) => ({ date, value: wVals[i] }))} label="Weight" color={S.body} format={W.formatConverted} connectGaps
            secondary={{ label: "7-day average", values: wAvg, color: "var(--viz-muted)" }} />
        </ChartCard>

        <ChartCard title="Resting heart rate" value={latestRest ? fmtInt(latestRest.value) : dash} unit={latestRest ? " bpm" : undefined} status={rangeStatus(latestRest?.value, restTyp)} loading={ctx.loading}
          legend={restTyp ? [{ label: "Resting heart rate", color: S.heart, shape: "line" }, { label: `Your typical range, ${fmtInt(restTyp.lo)}–${fmtInt(restTyp.hi)} bpm (last 30 days)`, color: "", shape: "band" }] : undefined}
          table={table(ctx, ["Resting HR"], (_, d) => [d?.restingHr !== undefined ? fmtBpm(d.restingHr) : dash])}>
          <LineChart today={ctx.today} rows={ctx.dates.map((date, i) => ({ date, value: rest[i] }))} label="Resting HR" color={S.heart} format={fmtBpm} typical={restTyp} />
        </ChartCard>

        <ChartCard title="Heart rate" value={avg(hr) !== undefined ? fmtInt(avg(hr)!) : dash} unit=" bpm on average" subtitle="Daily average, shaded from lowest to highest" loading={ctx.loading}
          table={table(ctx, ["Average", "Low", "High"], (_, d) => [d?.heartRate ? fmtBpm(d.heartRate.avg) : dash, d?.heartRate ? fmtBpm(d.heartRate.min) : dash, d?.heartRate ? fmtBpm(d.heartRate.max) : dash])}>
          <LineChart today={ctx.today} rows={ctx.dates.map((date) => ({ date, value: m.get(date)?.heartRate?.avg, min: m.get(date)?.heartRate?.min, max: m.get(date)?.heartRate?.max }))}
            label="Average" bandLabel="Low – high" color={S.heart} format={fmtBpm} />
        </ChartCard>

        <ChartCard title="Body fat" value={latestFat ? fmtPct(latestFat.value) : dash} loading={ctx.loading}
          table={table(ctx, ["Body fat"], (_, d) => [d?.bodyFatPct !== undefined ? fmtPct(d.bodyFatPct) : dash])}>
          <LineChart today={ctx.today} rows={ctx.dates.map((date, i) => ({ date, value: fat[i] }))} label="Body fat" color={S.body} format={fmtPct} connectGaps />
        </ChartCard>
      </div>
      <RecoveryVitals ctx={ctx} />
    </div>
  );
}

/**
 * Recovery vitals (S1): HRV, SpO2, breathing rate, skin temperature and VO2 max, each against the owner's typical
 * range. Only vitals with any data in the last 30 days or this period are shown (they need a watch worn overnight).
 */
function RecoveryVitals({ ctx }: { ctx: ViewCtx }) {
  const allDays = [...(ctx.baseline?.days ?? []), ...ctx.data.days];
  const shown = VITALS.filter((v) => allDays.some((d) => v.pick(ctx)(d) !== undefined));
  return (
    <section className="dash" aria-labelledby="vitals-h">
      <h2 className="section-title" id="vitals-h">Recovery vitals</h2>
      {shown.length === 0 ? (
        <p className="muted">
          {ctx.loading ? "Loading…" : "No recovery vitals yet. Google Health records them from a watch or tracker worn overnight."}
        </p>
      ) : (
        <div className="dash-grid two-up">{shown.map((v) => <VitalChart key={v.id} ctx={ctx} def={v} />)}</div>
      )}
    </section>
  );
}

function VitalChart({ ctx, def }: { ctx: ViewCtx; def: VitalDef }) {
  const pick = def.pick(ctx);
  const fmt = (v: number) => def.format(v, ctx.units);
  const typ = typical(ctx, pick);
  const latest = lastWith(upToAnchor(ctx), pick);
  const values = series(ctx, pick);
  const level = def.id === "vo2Max" ? fitnessLevel(latest && byDate(ctx.data).get(latest.date)?.cardioFitness) : undefined;
  return (
    <ChartCard title={def.label} value={latest ? fmt(latest.value) : dash} status={rangeStatus(latest?.value, typ)} loading={ctx.loading}
      subtitle={[level && `${level} cardio fitness.`, def.about].filter(Boolean).join(" ")}
      legend={typ ? [{ label: def.label, color: def.color, shape: "line" }, { label: `Your typical range, ${fmt(typ.lo)} to ${fmt(typ.hi)} (last 30 days)`, color: "", shape: "band" }] : undefined}
      table={table(ctx, [def.label], (_, d) => { const v = d ? pick(d) : undefined; return [v !== undefined ? fmt(v) : dash]; })}>
      <LineChart today={ctx.today} rows={ctx.dates.map((date, i) => ({ date, value: values[i] }))} label={def.label} color={def.color} format={def.compact ?? fmt} typical={typ} connectGaps />
    </ChartCard>
  );
}
