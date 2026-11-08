import type { DailySummary, ExerciseSession, SleepSession, SummaryResponse } from "../../shared/summary";
import { ChartCard } from "../viz/ChartCard";
import { ColumnChart } from "../viz/ColumnChart";
import { LineChart } from "../viz/LineChart";
import { ScheduleChart, fmtClock } from "../viz/ScheduleChart";
import { StatTile } from "../viz/StatTile";
import { fmtLongDate, fmtShortDate, parseDate } from "../viz/scale";
import {
  distance, fmtBpm, fmtDuration, fmtInt, fmtKcal, fmtMin, fmtPct, weight, type UnitSystem,
} from "../units";

export interface ViewProps {
  data: SummaryResponse;
  loading: boolean;
  units: UnitSystem;
}

const S1 = "var(--series-1)", S2 = "var(--series-2)", S3 = "var(--series-3)", S4 = "var(--series-4)";
const ORD = ["var(--ord-1)", "var(--ord-2)", "var(--ord-3)"];

const avg = (xs: (number | undefined)[]) => {
  const v = xs.filter((x): x is number => x !== undefined);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : undefined;
};
const azmTotal = (d: DailySummary) => (d.azm ? d.azm.fatBurn + d.azm.cardio + d.azm.peak : undefined);
const lastWith = <T,>(days: DailySummary[], pick: (d: DailySummary) => T | undefined) => {
  for (let i = days.length - 1; i >= 0; i--) {
    const v = pick(days[i]!);
    if (v !== undefined) return { value: v, date: days[i]!.date };
  }
  return undefined;
};
const dash = "—";

// ── Sleep helpers ────────────────────────────────────────────────────────────

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
function minutesFrom(date: string, local: string): number {
  const base = parseDate(date).getTime();
  const [d, t] = local.split("T") as [string, string];
  const [h, m] = t.split(":").map(Number) as [number, number];
  return Math.round((parseDate(d).getTime() - base) / 60000) + h * 60 + m;
}

// ── Today ────────────────────────────────────────────────────────────────────

export function TodayView({ data, units }: ViewProps) {
  const days = data.days;
  const today = days[days.length - 1]!;
  const prior = days.slice(0, -1);
  const nights = nightsByDate(data.sleep, days);
  const lastNight = nights[nights.length - 1];
  const W = weight(units);
  const latestWeight = lastWith(days, (d) => d.weightKg);
  const latestRhr = lastWith(days, (d) => d.restingHr);
  const n = days.length;

  const vsAvg = (todayV: number | undefined, priorVs: (number | undefined)[], fmt: (v: number) => string) => {
    const a = avg(priorVs);
    return a === undefined || todayV === undefined ? undefined : `${n - 1}-day average ${fmt(a)}`;
  };
  const todaysWorkouts = data.exercise.filter((e) => e.date === today.date);

  return (
    <div className="dash">
      <div className="viz-tiles">
        <StatTile hero label="Steps today" value={today.steps !== undefined ? fmtInt(today.steps) : dash}
          delta={vsAvg(today.steps, prior.map((d) => d.steps), fmtInt)} trend={days.map((d) => d.steps)} />
        <StatTile label="Active zone minutes" value={azmTotal(today) !== undefined ? fmtInt(azmTotal(today)!) : dash}
          delta={vsAvg(azmTotal(today), prior.map(azmTotal), fmtInt)} trend={days.map(azmTotal)} />
        <StatTile label="Calories burned" value={today.caloriesOut !== undefined ? fmtInt(today.caloriesOut) : dash} unit="kcal"
          delta={vsAvg(today.caloriesOut, prior.map((d) => d.caloriesOut), fmtInt)} trend={days.map((d) => d.caloriesOut)} />
        <StatTile label="Calories eaten" value={today.nutrition ? fmtInt(today.nutrition.kcal) : dash} unit="kcal"
          delta={vsAvg(today.nutrition?.kcal, prior.map((d) => d.nutrition?.kcal), fmtInt)} trend={days.map((d) => d.nutrition?.kcal)} />
        <StatTile label="Last night's sleep" value={lastNight?.asleep ? fmtDuration(lastNight.asleep) : dash}
          delta={lastNight?.main ? `${fmtClock(minutesFrom(lastNight.date, lastNight.main.startLocal))} – ${fmtClock(minutesFrom(lastNight.date, lastNight.main.endLocal))}` : undefined}
          trend={nights.map((x) => x.asleep || undefined)} />
        <StatTile label="Resting heart rate" value={latestRhr ? fmtInt(latestRhr.value) : dash} unit="bpm"
          delta={latestRhr && latestRhr.date !== today.date ? `as of ${fmtShortDate(latestRhr.date)}` : undefined}
          trend={days.map((d) => d.restingHr)} />
        <StatTile label="Weight" value={latestWeight ? W.convert(latestWeight.value).toFixed(1) : dash} unit={W.unit}
          delta={latestWeight && latestWeight.date !== today.date ? `as of ${fmtShortDate(latestWeight.date)}` : undefined}
          trend={days.map((d) => (d.weightKg !== undefined ? W.convert(d.weightKg) : undefined))} />
      </div>

      <section className="viz-card">
        <h3 className="viz-card-title">Today's workouts</h3>
        {todaysWorkouts.length ? <WorkoutTable sessions={todaysWorkouts} units={units} showDate={false} /> : <p className="viz-card-sub">None recorded yet today.</p>}
      </section>
    </div>
  );
}

// ── Fitness ──────────────────────────────────────────────────────────────────

export function FitnessView({ data, loading, units }: ViewProps) {
  const days = data.days;
  const D = distance(units);
  const stepsAvg = avg(days.map((d) => d.steps));

  return (
    <div className="dash">
      <div className="dash-grid">
        <ChartCard title="Steps" subtitle={stepsAvg !== undefined ? `Average ${fmtInt(stepsAvg)} a day` : undefined} loading={loading}
          table={{ columns: ["Date", "Steps", `Distance (${D.unit})`, "Floors"], rows: days.map((d) => [fmtShortDate(d.date), d.steps !== undefined ? fmtInt(d.steps) : dash, d.distanceKm !== undefined ? D.convert(d.distanceKm).toFixed(2) : dash, d.floors ?? dash]) }}>
          <ColumnChart rows={days.map((d) => ({ date: d.date, values: [d.steps] }))} series={[{ label: "Steps", color: S1 }]} format={fmtInt} />
        </ChartCard>

        <ChartCard title="Active zone minutes" subtitle="Minutes in heart-rate zones; cardio and peak count double" loading={loading}
          legend={[{ label: "Fat burn", color: S1, shape: "rect" }, { label: "Cardio", color: S2, shape: "rect" }, { label: "Peak", color: S3, shape: "rect" }]}
          table={{ columns: ["Date", "Fat burn", "Cardio", "Peak", "Total"], rows: days.map((d) => [fmtShortDate(d.date), d.azm?.fatBurn ?? dash, d.azm?.cardio ?? dash, d.azm?.peak ?? dash, azmTotal(d) ?? dash]) }}>
          <ColumnChart rows={days.map((d) => ({ date: d.date, values: [d.azm?.fatBurn, d.azm?.cardio, d.azm?.peak] }))}
            series={[{ label: "Fat burn", color: S1 }, { label: "Cardio", color: S2 }, { label: "Peak", color: S3 }]} format={fmtInt} />
        </ChartCard>

        <ChartCard title="Active minutes" subtitle="By intensity" loading={loading}
          legend={[{ label: "Light", color: ORD[0]!, shape: "rect" }, { label: "Moderate", color: ORD[1]!, shape: "rect" }, { label: "Vigorous", color: ORD[2]!, shape: "rect" }]}
          table={{ columns: ["Date", "Light", "Moderate", "Vigorous"], rows: days.map((d) => [fmtShortDate(d.date), d.activeMinutes?.light ?? dash, d.activeMinutes?.moderate ?? dash, d.activeMinutes?.vigorous ?? dash]) }}>
          <ColumnChart rows={days.map((d) => ({ date: d.date, values: [d.activeMinutes?.light, d.activeMinutes?.moderate, d.activeMinutes?.vigorous] }))}
            series={[{ label: "Light", color: ORD[0]! }, { label: "Moderate", color: ORD[1]! }, { label: "Vigorous", color: ORD[2]! }]} format={fmtMin} />
        </ChartCard>

        <ChartCard title="Calories burned" subtitle="Total daily energy expenditure" loading={loading}
          table={{ columns: ["Date", "kcal"], rows: days.map((d) => [fmtShortDate(d.date), d.caloriesOut !== undefined ? fmtInt(d.caloriesOut) : dash]) }}>
          <ColumnChart rows={days.map((d) => ({ date: d.date, values: [d.caloriesOut] }))} series={[{ label: "Calories burned", color: S1 }]} format={fmtKcal} />
        </ChartCard>
      </div>

      <section className={`viz-card ${loading ? "viz-loading" : ""}`}>
        <h3 className="viz-card-title">Workouts</h3>
        <p className="viz-card-sub">{data.exercise.length} in this range</p>
        {data.exercise.length ? <WorkoutTable sessions={[...data.exercise].reverse()} units={units} showDate /> : null}
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
          <tr>
            {showDate && <th>Date</th>}
            <th>Workout</th><th>Start</th><th>Duration</th><th>Distance</th><th>Avg HR</th><th>Calories</th>
          </tr>
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

export function SleepView({ data, loading }: ViewProps) {
  const nights = nightsByDate(data.sleep, data.days);
  const tracked = nights.filter((x) => x.main);
  const sched = nights.map((x) => ({
    date: x.date,
    start: x.main ? minutesFrom(x.date, x.main.startLocal) : undefined,
    end: x.main ? minutesFrom(x.date, x.main.endLocal) : undefined,
  }));
  const avgAsleep = avg(tracked.map((x) => x.asleep));
  const avgBed = avg(sched.map((s) => s.start));
  const avgWake = avg(sched.map((s) => s.end));
  const naps = data.sleep.filter((s) => s.isNap);
  const h = (m: number) => m / 60;
  const fmtHours = (v: number) => fmtDuration(v * 60);

  return (
    <div className="dash">
      <div className="viz-tiles">
        <StatTile label="Average time asleep" value={avgAsleep !== undefined ? fmtDuration(avgAsleep) : dash} />
        <StatTile label="Average bedtime" value={avgBed !== undefined ? fmtClock(avgBed) : dash} />
        <StatTile label="Average wake time" value={avgWake !== undefined ? fmtClock(avgWake) : dash} />
        <StatTile label="Nights tracked" value={`${tracked.length} of ${nights.length}`} delta={naps.length ? `plus ${naps.length} nap${naps.length > 1 ? "s" : ""}` : undefined} />
      </div>
      <div className="dash-grid">
        <ChartCard title="Time asleep by stage" subtitle="Main sleep, by the night's wake-up date" loading={loading}
          legend={[{ label: "Deep", color: S1, shape: "rect" }, { label: "Light", color: S2, shape: "rect" }, { label: "REM", color: S3, shape: "rect" }, { label: "Awake", color: S4, shape: "rect" }]}
          table={{ columns: ["Night", "Asleep", "Deep", "Light", "REM", "Awake"], rows: nights.map((x) => [fmtShortDate(x.date), x.asleep ? fmtDuration(x.asleep) : dash, x.main ? fmtDuration(x.stages.deep) : dash, x.main ? fmtDuration(x.stages.light + x.stages.asleep) : dash, x.main ? fmtDuration(x.stages.rem) : dash, x.main ? fmtDuration(x.stages.awake + x.stages.restless) : dash]) }}>
          <ColumnChart
            rows={nights.map((x) => ({ date: x.date, values: x.main ? [h(x.stages.deep), h(x.stages.light + x.stages.asleep), h(x.stages.rem), h(x.stages.awake + x.stages.restless)] : [undefined, undefined, undefined, undefined] }))}
            series={[{ label: "Deep", color: S1 }, { label: "Light", color: S2 }, { label: "REM", color: S3 }, { label: "Awake", color: S4 }]}
            format={fmtHours} tickFormat={(v) => `${v}h`} />
        </ChartCard>

        <ChartCard title="Sleep schedule" subtitle="Bedtime to wake time, main sleep" loading={loading}
          table={{ columns: ["Night", "Bedtime", "Wake", "In bed"], rows: nights.map((x, i) => [fmtShortDate(x.date), sched[i]!.start !== undefined ? fmtClock(sched[i]!.start!) : dash, sched[i]!.end !== undefined ? fmtClock(sched[i]!.end!) : dash, x.main ? fmtDuration(x.main.minutesInBed) : dash]) }}>
          <ScheduleChart rows={sched} color={S1} />
        </ChartCard>
      </div>
      {naps.length > 0 && (
        <section className="viz-card">
          <h3 className="viz-card-title">Naps</h3>
          <table className="viz-table">
            <thead><tr><th>Date</th><th>Start</th><th>Asleep</th></tr></thead>
            <tbody>
              {[...naps].reverse().map((s) => (
                <tr key={s.id}><td>{fmtLongDate(s.date)}</td><td>{fmtClock(minutesFrom(s.date, s.startLocal))}</td><td>{fmtDuration(s.minutesAsleep)}</td></tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}

// ── Body ─────────────────────────────────────────────────────────────────────

export function BodyView({ data, loading, units }: ViewProps) {
  const days = data.days;
  const W = weight(units);
  const wRows = days.map((d) => ({ date: d.date, value: d.weightKg !== undefined ? W.convert(d.weightKg) : undefined }));
  const fmtW = W.formatConverted;

  return (
    <div className="dash">
      <div className="dash-grid">
        <ChartCard title="Weight" subtitle="Daily average of logged weigh-ins" loading={loading}
          table={{ columns: ["Date", `Weight (${W.unit})`], rows: wRows.map((r) => [fmtShortDate(r.date), r.value !== undefined ? r.value.toFixed(1) : dash]) }}>
          <LineChart rows={wRows} label="Weight" color={S1} format={fmtW} connectGaps />
        </ChartCard>

        <ChartCard title="Body fat" loading={loading}
          table={{ columns: ["Date", "Body fat"], rows: days.map((d) => [fmtShortDate(d.date), d.bodyFatPct !== undefined ? fmtPct(d.bodyFatPct) : dash]) }}>
          <LineChart rows={days.map((d) => ({ date: d.date, value: d.bodyFatPct }))} label="Body fat" color={S1} format={fmtPct} connectGaps />
        </ChartCard>

        <ChartCard title="Resting heart rate" loading={loading}
          table={{ columns: ["Date", "Resting HR"], rows: days.map((d) => [fmtShortDate(d.date), d.restingHr !== undefined ? fmtBpm(d.restingHr) : dash]) }}>
          <LineChart rows={days.map((d) => ({ date: d.date, value: d.restingHr }))} label="Resting HR" color={S1} format={fmtBpm} />
        </ChartCard>

        <ChartCard title="Heart rate" subtitle="Daily average, shaded from minimum to maximum" loading={loading}
          table={{ columns: ["Date", "Average", "Min", "Max"], rows: days.map((d) => [fmtShortDate(d.date), d.heartRate ? fmtBpm(d.heartRate.avg) : dash, d.heartRate ? fmtBpm(d.heartRate.min) : dash, d.heartRate ? fmtBpm(d.heartRate.max) : dash]) }}>
          <LineChart rows={days.map((d) => ({ date: d.date, value: d.heartRate?.avg, min: d.heartRate?.min, max: d.heartRate?.max }))}
            label="Average" bandLabel="Min – max" color={S1} format={fmtBpm} />
        </ChartCard>
      </div>
    </div>
  );
}
