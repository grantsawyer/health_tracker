import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, api } from "../api";
import { fmtInt, fmtKcal } from "../units";
import { ChartCard } from "../viz/ChartCard";
import { ColumnChart } from "../viz/ColumnChart";
import { RangeBar } from "../viz/RangeBar";
import { fmtLongDate, fmtShortDate } from "../viz/scale";
import { MacroSplitBar } from "./MacroSplitBar";
import { Icon } from "../ui/icons";
import type { Status } from "../ui/Pill";
import { budgetStatus } from "../dashboard/baseline";
import type { ViewCtx } from "../dashboard/Dashboards";
import { AddFood, MEAL_LABEL } from "./AddFood";
import { GoalEditor } from "../ui/GoalEditor";
import type { FoodLogDay, FoodLogEntry, PendingFoodWrite } from "../../shared/food";
import { addDaysISO } from "../dashboard/period";
import { MEALS, METRICS, anyPlacedByTime, byMealByDay, mealAverages, type MealMetric } from "./meals";

const fmtTime = (timeLocal: string) => {
  const [h = 0, m = 0] = timeLocal.slice(11, 16).split(":").map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
};
const MEAL_ORDER = ["BREAKFAST", "LUNCH", "DINNER", "SNACK", "ANYTIME"];
const dash = "—";

/**
 * Within ±10% of a macro goal counts as on target. This is a display
 * tolerance for the status pill, not a nutrition guideline.
 */
const TOLERANCE = 0.1;
function macroStatus(value: number, goal: number): Status {
  if (!goal) return { tone: "info", text: "No goal set" };
  if (value < goal * (1 - TOLERANCE)) return { tone: "warn", text: "Below goal" };
  if (value > goal * (1 + TOLERANCE)) return { tone: "warn", text: "Above goal" };
  return { tone: "good", text: "On target" };
}

/**
 * Food tab. D: the anchor day's log (macro bars vs goals, meal filter chips,
 * collapsible meal cards with add / edit / delete for this app's entries).
 * W / M / 3M: nutrition trends for the period. Changing days happens in the
 * shared period bar.
 */
export function FoodView({ ctx, onChanged, autoOpenAdd, onAutoOpened }: { ctx: ViewCtx; onChanged: () => void; autoOpenAdd?: boolean; onAutoOpened?: () => void }) {
  const isDay = ctx.period.kind === "D";
  const date = ctx.period.anchor;
  const [day, setDay] = useState<FoodLogDay | null>(null);
  const [dayLoading, setDayLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [panel, setPanel] = useState<{ editing?: FoodLogEntry } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingFoodWrite[]>([]);
  const [retrying, setRetrying] = useState(false);
  const [mealFilter, setMealFilter] = useState<string>("ALL");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (autoOpenAdd) {
      setPanel({});
      onAutoOpened?.();
    }
  }, [autoOpenAdd, onAutoOpened]);

  const loadPending = useCallback(() => api.food.pending().then(setPending, () => undefined), []);
  useEffect(() => {
    void loadPending();
  }, [loadPending]);

  const loadDay = useCallback(async (fresh = false) => {
    setDayLoading(true);
    setError(null);
    try {
      setDay(await api.food.day(date, fresh));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setDayLoading(false);
    }
  }, [date]);

  useEffect(() => {
    if (isDay) void loadDay();
  }, [loadDay, isDay]);

  // While anything is waiting, poll so the banner clears once the background retry succeeds.
  const hadPending = useRef(false);
  useEffect(() => {
    if (!pending.length) {
      if (hadPending.current) {
        hadPending.current = false;
        if (isDay) void loadDay();
        onChanged();
      }
      return;
    }
    hadPending.current = true;
    const t = setInterval(loadPending, 20_000);
    return () => clearInterval(t);
  }, [pending.length, loadPending]); // eslint-disable-line react-hooks/exhaustive-deps

  const retryNow = async (includeFailed: boolean) => {
    setRetrying(true);
    try {
      const r = await api.food.retryPending(includeFailed);
      setPending(r.pending);
      if (r.sent) setNotice(`Synced ${r.sent} entr${r.sent === 1 ? "y" : "ies"} to Google Health.`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRetrying(false);
    }
  };
  const discard = async (p: PendingFoodWrite) => {
    if (!window.confirm(`Discard “${p.label}”? It hasn't been saved to Google Health.`)) return;
    await api.food.discardPending(p.id);
    void loadPending();
  };

  const afterChange = async () => {
    await Promise.all([isDay ? loadDay() : Promise.resolve(), loadPending()]);
    onChanged();
  };

  const remove = async (e: FoodLogEntry) => {
    if (!window.confirm(`Delete ${e.displayName} from your Google Health food log?`)) return;
    setBusyId(e.id);
    try {
      await api.food.remove(e.id);
      await afterChange();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : (err as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  const groups = MEAL_ORDER.map((m) => ({ meal: m, entries: day?.entries.filter((e) => e.mealType === m) ?? [] })).filter((g) => g.entries.length);
  const others = day?.entries.filter((e) => !MEAL_ORDER.includes(e.mealType)) ?? [];
  if (others.length) groups.push({ meal: "OTHER", entries: others });
  const shownGroups = mealFilter === "ALL" ? groups : groups.filter((g) => g.meal === mealFilter);
  const toggle = (meal: string) => setCollapsed((c) => { const n = new Set(c); if (n.has(meal)) n.delete(meal); else n.add(meal); return n; });

  return (
    <div className="dash">
      {notice && (
        <div className="banner banner-ok" role="status">
          {notice} <button className="link" onClick={() => setNotice(null)}>Dismiss</button>
        </div>
      )}
      {pending.length > 0 && (
        <section className="banner banner-warn pending" role="status" aria-label="Entries waiting to sync">
          <div className="pending-head">
            <strong>{pending.length} entr{pending.length === 1 ? "y" : "ies"} waiting to sync to Google Health</strong>
            <button onClick={() => retryNow(pending.some((p) => p.failed))} disabled={retrying}>{retrying ? "Retrying…" : "Retry now"}</button>
          </div>
          <ul>
            {pending.map((p) => (
              <li key={p.id}>
                <span>{p.label} · {fmtLongDate(p.timeLocal.slice(0, 10))} {fmtTime(p.timeLocal)}</span>
                <span className="muted">
                  {p.failed ? `Google rejected it: ${p.lastError ?? "unknown error"}` : `Saved on this computer; next try ${new Date(p.nextAttemptAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`}
                </span>
                <button className="link" onClick={() => discard(p)}>Discard</button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Day view: the log (filter, actions, add panel, meals) first; the summary below it, or beside it on wide screens. */}
      <div className={isDay ? "food-day" : undefined}>
        <div className="food-log-col">
          <div className="food-toolbar">
            {isDay && day && groups.length > 0 ? (
              <div className="meal-chips" role="group" aria-label="Filter by meal">
                {["ALL", ...groups.map((g) => g.meal)].map((m) => (
                  <button key={m} className="chip" aria-pressed={mealFilter === m} onClick={() => setMealFilter(m)}>
                    {mealFilter === m && <Icon.check />}{m === "ALL" ? "All" : MEAL_LABEL[m] ?? "Other"}
                  </button>
                ))}
              </div>
            ) : <span />}
            <div className="actions">
              {isDay && <button onClick={() => loadDay(true)} disabled={dayLoading}>Refresh</button>}
              <button className="primary" onClick={() => setPanel({})} disabled={Boolean(panel)}><Icon.plus /> Add food</button>
            </div>
          </div>

          {panel && (
            <AddFood
              key={panel.editing?.id ?? "new"}
              date={isDay ? date : ctx.today}
              editing={panel.editing}
              onDone={async (saved, msg) => {
                setPanel(null);
                if (msg) setNotice(msg);
                if (saved) await afterChange();
              }}
            />
          )}

          {isDay && (
            <section className={`dash ${dayLoading ? "viz-loading" : ""}`} aria-label="Food log">
              {error && <p className="error-text" role="alert">{error}</p>}
              {day && !day.entries.length && <p className="muted">Nothing logged {date === ctx.today ? "yet today" : "this day"}. Use Add food to log a meal.</p>}
              <div className="meals">
                {shownGroups.map((g) => {
                  const open = !collapsed.has(g.meal);
                  const kcal = g.entries.reduce((t, e) => t + (e.kcal ?? 0), 0);
                  return (
                    <div key={g.meal} className="meal-card meal-group">
                      <button className="meal-head" aria-expanded={open} onClick={() => toggle(g.meal)}>
                        <span>
                          <span className="meal-name">{MEAL_LABEL[g.meal] ?? "Other"}</span><br />
                          <span className="meal-count">{g.entries.length} item{g.entries.length === 1 ? "" : "s"}</span>
                        </span>
                        <span className="meal-kcal">{fmtInt(kcal)}<small> kcal</small></span>
                        <span className="chev"><Icon.chevronDown /></span>
                      </button>
                      {open && (
                        <ul className="entry-list">
                          {g.entries.map((e) => (
                            <li key={e.id}>
                              {/* Name over details, then the three macro bars, then kcal + actions (owner layout 2026-11-11). */}
                              <span className="entry-time muted">{fmtTime(e.timeLocal)}</span>
                              <span className="entry-name" title={e.displayName}>{e.displayName}</span>
                              <span className="entry-bars"><MacroSplitBar food={e} /></span>
                              <span className="entry-right">
                                <span className="entry-kcal">{e.kcal !== undefined ? fmtKcal(e.kcal) : dash}</span>
                                <span className="entry-actions">
                                  {e.editable ? (
                                    <>
                                      <button className="entry-icon" onClick={() => setPanel({ editing: e })} disabled={Boolean(panel) || busyId === e.id}
                                        aria-label={`Edit ${e.displayName}`} title="Edit"><Icon.edit /></button>
                                      <button className="entry-icon" onClick={() => remove(e)} disabled={busyId === e.id} aria-busy={busyId === e.id}
                                        aria-label={`Delete ${e.displayName}`} title="Delete"><Icon.trash /></button>
                                    </>
                                  ) : (
                                    <span className="muted" title="Logged by another app; edit it there">Read-only</span>
                                  )}
                                </span>
                              </span>
                              <span className="muted entry-detail">
                                {e.serving ? `${+e.serving.amount.toFixed(2)} ${e.serving.label ?? ""} · ` : ""}
                                {/* Same order as the macro bar and the charts: carbs · fat · protein. */}
                                {[e.carbsG !== undefined && `${fmtInt(e.carbsG)}g carbs`, e.fatG !== undefined && `${fmtInt(e.fatG)}g fat`, e.proteinG !== undefined && `${fmtInt(e.proteinG)}g protein`].filter(Boolean).join(" · ")}
                                {!e.editable && e.source ? ` · via ${e.source}` : ""}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          )}
        </div>
        {isDay && <MacroSummary day={day} ctx={ctx} />}
      </div>

      <NutritionTrends ctx={ctx} />
    </div>
  );
}

/** Calories vs goal and each macro vs its goal, with its share of macro calories. */
function MacroSummary({ day, ctx }: { day: FoodLogDay | null; ctx: ViewCtx }) {
  const { goals } = ctx;
  const t = day?.totals ?? { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0 };
  const macroKcal = t.carbsG * 4 + t.fatG * 9 + t.proteinG * 4;
  const share = (k: number) => (macroKcal ? `${Math.round((k / macroKcal) * 100)}%` : "0%");
  const burned = ctx.data.days.find((d) => d.date === ctx.period.anchor)?.caloriesOut;
  // One gram axis for the three macros (owner request 2026-11-09): the same grams sit at the same x on every track,
  // so goals of different sizes sit at different points. The track ends 15% past the largest goal or intake.
  const rows = [
    { label: "Carbs", key: "carbsG" as const, g: t.carbsG, goal: goals.carbsG, kcal: t.carbsG * 4, color: "var(--macro-carbs)" },
    { label: "Fat", key: "fatG" as const, g: t.fatG, goal: goals.fatG, kcal: t.fatG * 9, color: "var(--macro-fat)" },
    { label: "Protein", key: "proteinG" as const, g: t.proteinG, goal: goals.proteinG, kcal: t.proteinG * 4, color: "var(--macro-protein)" },
  ];
  const gramAxis = Math.max(1, ...rows.flatMap((r) => [r.goal, r.g])) * 1.15;
  return (
    <section className="viz-card food-summary" aria-label="Calories and macros">
      <div className="viz-card-head">
        <div>
          <h3 className="viz-card-title">Calories eaten</h3>
          <p className="viz-card-value">{fmtInt(t.kcal)}<small> of {fmtInt(goals.caloriesEaten)} kcal</small></p>
          {burned !== undefined && <p className="viz-card-sub">{fmtInt(burned)} kcal burned{ctx.period.anchor === ctx.today ? " so far" : ""}</p>}
        </div>
      </div>
      <div className="ranges flat" style={{ marginTop: 12 }}>
        <RangeBar label="Calories" detail={`${fmtInt(t.kcal)} kcal`} value={t.kcal} max={Math.max(goals.caloriesEaten * 1.25, t.kcal)} color="var(--food)"
          target={goals.caloriesEaten} status={budgetStatus(t.kcal, goals.caloriesEaten, " kcal")}
          action={<GoalEditor goalKey="caloriesEaten" label="Calories" unit=" kcal" />} />
        {rows.map((r) => (
          <RangeBar key={r.label} label={r.label} detail={`${share(r.kcal)} · ${fmtInt(r.g)} of ${fmtInt(r.goal)} g`} value={r.g}
            max={gramAxis} color={r.color} target={r.goal} status={macroStatus(r.g, r.goal)}
            action={<GoalEditor goalKey={r.key} label={r.label} unit=" g" />} />
        ))}
      </div>
    </section>
  );
}

function NutritionTrends({ ctx }: { ctx: ViewCtx }) {
  const m = new Map(ctx.data.days.map((d) => [d.date, d]));
  const logged = ctx.data.days.filter((d) => d.nutrition && ctx.dates.includes(d.date));
  const avgIn = logged.length ? logged.reduce((t, d) => t + d.nutrition!.kcal, 0) / logged.length : undefined;
  const shown = ctx.dates.filter((d) => d <= ctx.today);
  const underBudget = logged.filter((d) => d.nutrition!.kcal <= ctx.goals.caloriesEaten).length;
  return (
    <>
    <div className="dash-grid">
      <ChartCard title="Calories eaten" goal={<GoalEditor goalKey="caloriesEaten" label="Calorie budget" unit=" kcal" />} value={avgIn !== undefined ? fmtInt(avgIn) : dash} unit={avgIn !== undefined ? " kcal a day on average" : undefined}
        subtitle={logged.length ? `Within your ${fmtInt(ctx.goals.caloriesEaten)} kcal budget on ${underBudget} of ${logged.length} logged days` : "No food logged in this period"} loading={ctx.loading}
        table={{ columns: ["Date", "Eaten (kcal)", "Burned (kcal)"], rows: shown.map((date) => [fmtShortDate(date), m.get(date)?.nutrition ? fmtInt(m.get(date)!.nutrition!.kcal) : dash, m.get(date)?.caloriesOut !== undefined ? fmtInt(m.get(date)!.caloriesOut!) : dash]) }}>
        <ColumnChart today={ctx.today} rows={ctx.dates.map((date) => ({ date, values: [m.get(date)?.nutrition?.kcal] }))} series={[{ label: "Calories eaten", color: "var(--food)" }]} format={fmtKcal}
          reference={{ value: ctx.goals.caloriesEaten, label: `Budget ${fmtInt(ctx.goals.caloriesEaten)}` }} />
      </ChartCard>
      <ChartCard title="Macros" subtitle="Grams per day" loading={ctx.loading}
        legend={[{ label: "Carbs", color: "var(--macro-carbs)", shape: "rect" }, { label: "Fat", color: "var(--macro-fat)", shape: "rect" }, { label: "Protein", color: "var(--macro-protein)", shape: "rect" }]}
        table={{ columns: ["Date", "Carbs (g)", "Fat (g)", "Protein (g)"], rows: shown.map((date) => { const n = m.get(date)?.nutrition; return [fmtShortDate(date), n?.carbsG !== undefined ? fmtInt(n.carbsG) : dash, n?.fatG !== undefined ? fmtInt(n.fatG) : dash, n?.proteinG !== undefined ? fmtInt(n.proteinG) : dash]; }) }}>
        <ColumnChart today={ctx.today} rows={ctx.dates.map((date) => { const n = m.get(date)?.nutrition; return { date, values: [n?.carbsG, n?.fatG, n?.proteinG] }; })}
          series={[{ label: "Carbs", color: "var(--macro-carbs)" }, { label: "Fat", color: "var(--macro-fat)" }, { label: "Protein", color: "var(--macro-protein)" }]} format={(v) => `${fmtInt(v)} g`} />
      </ChartCard>
      {MACROS.map((mac) => <MacroChart key={mac.key} ctx={ctx} macro={mac} />)}
    </div>
    <MealCharts ctx={ctx} />
    </>
  );
}

const MACROS = [
  { key: "carbsG", label: "Carbs", color: "var(--macro-carbs)" },
  { key: "fatG", label: "Fat", color: "var(--macro-fat)" },
  { key: "proteinG", label: "Protein", color: "var(--macro-protein)" },
] as const;

/** One macro per day against its target band (goal ± 10%), in the same form as the Calories eaten chart. */
function MacroChart({ ctx, macro }: { ctx: ViewCtx; macro: (typeof MACROS)[number] }) {
  const m = new Map(ctx.data.days.map((d) => [d.date, d]));
  const goal = ctx.goals[macro.key];
  const value = (date: string) => m.get(date)?.nutrition?.[macro.key];
  const logged = ctx.dates.map(value).filter((v): v is number => v !== undefined);
  const average = logged.length ? logged.reduce((a, b) => a + b, 0) / logged.length : undefined;
  const onTarget = logged.filter((v) => macroStatus(v, goal).text === "On target").length;
  const shown = ctx.dates.filter((d) => d <= ctx.today);
  return (
    <ChartCard title={macro.label} goal={<GoalEditor goalKey={macro.key} label={macro.label} unit=" g" />}
      value={average !== undefined ? fmtInt(average) : dash} unit={average !== undefined ? " g a day on average" : undefined}
      subtitle={logged.length ? `On target (within ${TOLERANCE * 100}% of ${fmtInt(goal)} g) on ${onTarget} of ${logged.length} logged days` : "No food logged in this period"}
      loading={ctx.loading}
      table={{ columns: ["Date", `${macro.label} (g)`], rows: shown.map((date) => [fmtShortDate(date), value(date) !== undefined ? fmtInt(value(date)!) : dash]) }}>
      <ColumnChart today={ctx.today} rows={ctx.dates.map((date) => ({ date, values: [value(date)] }))} series={[{ label: macro.label, color: macro.color }]}
        format={(v) => `${fmtInt(v)} g`}
        target={{ lo: goal * (1 - TOLERANCE), hi: goal * (1 + TOLERANCE), label: `Target ${fmtInt(goal * (1 - TOLERANCE))}–${fmtInt(goal * (1 + TOLERANCE))} g`, badges: true }} />
    </ChartCard>
  );
}

/**
 * By meal: each day stacked by meal, and each meal's average per logged day. One metric switch above both charts
 * (calories or a macro). Needs the period's individual entries, read once per period.
 */
function MealCharts({ ctx }: { ctx: ViewCtx }) {
  const [entries, setEntries] = useState<FoodLogEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [metric, setMetric] = useState<MealMetric>("kcal");
  const start = ctx.dates[0]!;
  const last = ctx.dates[ctx.dates.length - 1]!;
  useEffect(() => {
    let live = true;
    setError(null);
    api.food.entries(start, addDaysISO(last, 1)).then((e) => live && setEntries(e), (err: Error) => live && setError(err.message));
    return () => {
      live = false;
    };
  }, [start, last, ctx.data.fetchedAt]);

  const info = METRICS.find((x) => x.key === metric)!;
  const fmt = (v: number) => (metric === "kcal" ? fmtKcal(v) : `${fmtInt(v)} g`);
  const list = entries ?? [];
  const rows = byMealByDay(list, ctx.dates, metric);
  const avgs = mealAverages(list, metric);
  const perDay = avgs.meals.reduce((t, x) => t + x.perDay, 0);
  const top = Math.max(1, ...avgs.meals.map((x) => x.perDay));
  const shown = rows.filter((r) => r.date <= ctx.today);
  const loading = ctx.loading || entries === null;
  const byTime = anyPlacedByTime(list);
  return (
    <section className="dash" aria-labelledby="by-meal-h">
      <div className="food-toolbar">
        <h2 className="section-title" id="by-meal-h">By meal</h2>
        <div className="meal-chips" role="group" aria-label="Measure">
          {METRICS.map((x) => (
            <button key={x.key} className="chip" aria-pressed={metric === x.key} onClick={() => setMetric(x.key)}>
              {metric === x.key && <Icon.check />}{x.label}
            </button>
          ))}
        </div>
      </div>
      {error && <p className="error-text" role="alert">Couldn't load entries: {error}</p>}
      <div className="dash-grid">
        <ChartCard title={`${info.label} by meal`} value={avgs.days ? fmtInt(perDay) : dash}
          unit={avgs.days ? ` ${info.unit} a day on average` : undefined}
          subtitle={avgs.days ? `Each day split by meal${byTime ? ". Entries logged without a meal are placed by time of day." : ""}` : "No food logged in this period"}
          loading={loading} legend={MEALS.map((x) => ({ label: x.label, color: x.color, shape: "rect" as const }))}
          table={{ columns: ["Date", ...MEALS.map((x) => `${x.label} (${info.unit})`)], rows: shown.map((r) => [fmtShortDate(r.date), ...r.values.map((v) => (v !== undefined ? fmtInt(v) : dash))]) }}>
          <ColumnChart today={ctx.today} rows={rows} series={MEALS.map((x) => ({ label: x.label, color: x.color }))} format={fmt} />
        </ChartCard>
        <ChartCard title={`Average ${info.label.toLowerCase()} per meal`}
          subtitle={avgs.days ? `Per logged day, over ${avgs.days} day${avgs.days === 1 ? "" : "s"}, with each meal's share` : "No food logged in this period"}
          loading={loading}
          table={{ columns: ["Meal", `Per day (${info.unit})`, "Share"], rows: avgs.meals.map((x) => [x.label, fmtInt(x.perDay), `${Math.round(x.share)}%`]) }}>
          <div className="ranges flat" style={{ marginTop: 14 }}>
            {avgs.meals.map((x) => (
              <RangeBar key={x.key} label={x.label} detail={`${fmt(x.perDay)} · ${Math.round(x.share)}%`} value={x.perDay} max={top * 1.1} color={x.color} />
            ))}
          </div>
        </ChartCard>
      </div>
    </section>
  );
}
