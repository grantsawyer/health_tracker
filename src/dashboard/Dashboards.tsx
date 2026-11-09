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
import { minutesFrom, nightsByDate, type Night } from "./sleep";
import { compareStages, efficiencyPct, efficiencySentence } from "./sleepStages";
import { useState } from "react";
import { CardBoard } from "./CardBoard";
import { metricById, type MetricDef } from "./cards";
import { useLayout } from "./useLayout";
import { GoalEditor } from "../ui/GoalEditor";
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
 * then a customizable "This week" grid. Customize mode lets the owner add,
 * remove and reorder cards from the registry in cards.tsx; the layout is
 * saved per user (app.db).
 */
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
    <MiniTrend {...def.week!(ctx)} title={def.week!(ctx).label === def.label ? def.label : def.week!(ctx).label} label={`${def.label} this week`}
      dates={ctx.dates} today={ctx.today} onOpen={() => ctx.open(def.tab)} />
  );

  return (
    <div className="dash">
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

      <h2 className="section-title">{ctx.dates.includes(ctx.today) ? "This week" : `Week of ${fmtShortDate(ctx.dates[0]!)}`}</h2>
      <CardBoard section="week" className="mini-grid" ids={shown.week} limit={LAYOUT_LIMITS.week} editing={editing} ctx={ctx}
        defs={metricById} render={week} onChange={(w) => setDraft({ ...shown, week: w })} />
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

  return (
    <div className="dash">
      {isDay && <NightDetail night={night} baseline={baseNights} status={vsGoal(night?.asleep || undefined)} />}

      <div className="dash-grid">
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

        <ChartCard title="Sleep schedule" value={avgStart !== undefined && avgEnd !== undefined ? `${fmtClock(avgStart)} – ${fmtClock(avgEnd)}` : dash}
          subtitle="Average bedtime to wake time" loading={ctx.loading}
          table={{ columns: ["Night", "Bedtime", "Wake", "In bed"], rows: nights.map((n, i) => ({ n, s: sched[i]! })).filter(({ n }) => n.date <= ctx.today).map(({ n, s }) => [fmtShortDate(n.date), s.start !== undefined ? fmtClock(s.start) : dash, s.end !== undefined ? fmtClock(s.end) : dash, n.main ? fmtDuration(n.main.minutesInBed) : dash]) }}>
          <ScheduleChart rows={sched} color="var(--sleep)" />
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
function NightDetail({ night, baseline, status }: { night: Night | undefined; baseline: Night[]; status?: Status }) {
  const [view, setView] = useState<NightView>("timeline");
  const main = night?.main;
  if (!main || !night) {
    return <section className="viz-card"><h3 className="viz-card-title">Sleep duration</h3><p className="viz-card-sub">No sleep recorded for this night.</p></section>;
  }
  const efficiency = efficiencyPct(night);
  const rows = compareStages(night, baseline);
  const history = baseline.filter((b) => b.main).length;
  const pct = (v: number) => `${Math.round(v)}%`;

  return (
    <section className="viz-card night-card" aria-labelledby="night-h">
      <div className="viz-card-head">
        <div>
          <h3 className="viz-card-title" id="night-h">Sleep duration</h3>
          <p className="viz-card-value">{fmtDuration(night.asleep)}<small>{main.startLocal.slice(11, 16)} – {main.endLocal.slice(11, 16)}</small></p>
          <p className="viz-card-sub">
            You spent {fmtDuration(main.minutesInBed)} in bed, with a sleep efficiency of {efficiency !== undefined ? pct(efficiency) : "—"}.{" "}
            {efficiencySentence(night, baseline) ?? ""}
          </p>
        </div>
        <div className="viz-card-actions">
          {status && <Pill tone={status.tone}>{status.text}</Pill>}
          <GoalEditor goalKey="sleepMinutes" label="Sleep" unit=" h" scale={60} format={fmtDuration} />
        </div>
      </div>

      <div className="night-view">
        {view === "timeline" && <SleepTimeline session={main} />}
        {view !== "timeline" && (
          <div className="ranges flat stage-bars">
            {rows.map((r) => {
              const usual = r.usual ? { lo: Math.max(0, r.usual.lo), hi: Math.min(100, r.usual.hi) } : undefined;
              return view === "usual" ? (
                <RangeBar key={r.key} label={r.label} detail={`${pct(r.pct)} · ${fmtDuration(r.minutes)}`} value={r.pct} max={100}
                  color={r.color} range={usual} rangeTint={r.color} status={r.status} />
              ) : (
                <RangeBar key={r.key} label={r.label}
                  detail={r.avgPct !== undefined && r.avgMinutes !== undefined ? `${pct(r.avgPct)} · ${fmtDuration(r.avgMinutes)}` : "No history"}
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
        {([["timeline", "Timeline"], ["usual", "Compared with usual"], ["average", "30-day average"]] as const).map(([k, label]) => (
          <button key={k} className="chip" aria-pressed={view === k} onClick={() => setView(k)}>
            {view === k && <Icon.check />}{label}
          </button>
        ))}
      </div>
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
      <div className="dash-grid">
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
    </div>
  );
}
