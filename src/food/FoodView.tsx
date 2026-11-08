import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, api } from "../api";
import { fmtInt, fmtKcal } from "../units";
import { ChartCard } from "../viz/ChartCard";
import { ColumnChart } from "../viz/ColumnChart";
import { StatTile } from "../viz/StatTile";
import { fmtLongDate, fmtShortDate, parseDate } from "../viz/scale";
import { AddFood, MEAL_LABEL } from "./AddFood";
import type { FoodLogDay, FoodLogEntry, PendingFoodWrite } from "../../shared/food";
import type { SummaryResponse } from "../../shared/summary";

const localDate = (d = new Date()) => d.toLocaleDateString("en-CA");
const shiftDate = (date: string, days: number) => {
  const d = parseDate(date);
  d.setDate(d.getDate() + days);
  return localDate(d);
};
const fmtTime = (timeLocal: string) => {
  const [h = 0, m = 0] = timeLocal.slice(11, 16).split(":").map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
};
const MEAL_ORDER = ["BREAKFAST", "LUNCH", "DINNER", "SNACK", "ANYTIME"];
const S1 = "var(--series-1)", S2 = "var(--series-2)", S3 = "var(--series-3)";

/**
 * Food tab: a day's log (grouped by meal, with add / edit / delete for entries
 * this app wrote) above nutrition trends for the dashboard range.
 */
export function FoodView({ data, loading, onChanged }: { data: SummaryResponse; loading: boolean; onChanged: () => void }) {
  const [date, setDate] = useState(() => {
    // Optional deep link: ?date=YYYY-MM-DD (ignored if malformed or in the future).
    const q = new URLSearchParams(window.location.search).get("date");
    return q && /^\d{4}-\d{2}-\d{2}$/.test(q) && q <= localDate() ? q : localDate();
  });
  const [day, setDay] = useState<FoodLogDay | null>(null);
  const [dayLoading, setDayLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [panel, setPanel] = useState<{ editing?: FoodLogEntry } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingFoodWrite[]>([]);
  const [retrying, setRetrying] = useState(false);

  const loadPending = useCallback(() => api.food.pending().then(setPending, () => undefined), []);
  useEffect(() => {
    void loadPending();
  }, [loadPending]);
  // While anything is waiting, poll so the banner clears once the background retry succeeds.
  const hadPending = useRef(false);
  useEffect(() => {
    if (!pending.length) {
      if (hadPending.current) {
        hadPending.current = false;
        void loadDay();
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
    void loadDay();
  }, [loadDay]);

  const afterChange = async () => {
    await Promise.all([loadDay(), loadPending()]);
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

  const today = localDate();
  const groups = MEAL_ORDER.map((m) => ({ meal: m, entries: day?.entries.filter((e) => e.mealType === m) ?? [] })).filter((g) => g.entries.length);
  const others = day?.entries.filter((e) => !MEAL_ORDER.includes(e.mealType)) ?? [];
  if (others.length) groups.push({ meal: "OTHER", entries: others });
  const burned = data.days.find((d) => d.date === date)?.caloriesOut;

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
      <section className={`card card-wide food-day ${dayLoading ? "viz-loading" : ""}`}>
        <div className="food-day-head">
          <div className="day-nav">
            <button aria-label="Previous day" onClick={() => setDate((d) => shiftDate(d, -1))}>‹</button>
            <h2>{date === today ? "Today" : fmtLongDate(date)}</h2>
            <button aria-label="Next day" onClick={() => setDate((d) => shiftDate(d, 1))} disabled={date >= today}>›</button>
            {date !== today && <button className="link" onClick={() => setDate(today)}>Back to today</button>}
          </div>
          <div className="actions" style={{ marginTop: 0 }}>
            <button onClick={() => loadDay(true)} disabled={dayLoading}>Refresh</button>
            <button className="primary" onClick={() => setPanel({})} disabled={Boolean(panel)}>+ Add food</button>
          </div>
        </div>

        {day && (
          <div className="viz-tiles food-totals">
            <StatTile label="Calories eaten" value={fmtInt(day.totals.kcal)} unit="kcal"
              delta={burned !== undefined ? `${fmtInt(burned)} kcal burned${date === today ? " so far" : ""}` : undefined} />
            <StatTile label="Protein" value={fmtInt(day.totals.proteinG)} unit="g" />
            <StatTile label="Carbs" value={fmtInt(day.totals.carbsG)} unit="g" />
            <StatTile label="Fat" value={fmtInt(day.totals.fatG)} unit="g" />
          </div>
        )}
        {error && <p className="error-text" role="alert">{error}</p>}
        {day && !day.entries.length && <p className="muted">Nothing logged {date === today ? "yet today" : "this day"}.</p>}

        {groups.map((g) => (
          <div key={g.meal} className="meal-group">
            <h3>
              {MEAL_LABEL[g.meal] ?? "Other"}
              <span className="muted"> · {fmtKcal(g.entries.reduce((t, e) => t + (e.kcal ?? 0), 0))}</span>
            </h3>
            <ul className="entry-list">
              {g.entries.map((e) => (
                <li key={e.id}>
                  <span className="entry-time muted">{fmtTime(e.timeLocal)}</span>
                  <span className="entry-main">
                    <span className="entry-name">{e.displayName}</span>
                    <span className="muted entry-detail">
                      {e.serving ? `${+e.serving.amount.toFixed(2)} ${e.serving.label ?? ""} · ` : ""}
                      {[e.proteinG !== undefined && `${fmtInt(e.proteinG)}g protein`, e.carbsG !== undefined && `${fmtInt(e.carbsG)}g carbs`, e.fatG !== undefined && `${fmtInt(e.fatG)}g fat`].filter(Boolean).join(" · ")}
                      {!e.editable && e.source ? ` · via ${e.source}` : ""}
                    </span>
                  </span>
                  <span className="entry-kcal">{e.kcal !== undefined ? fmtKcal(e.kcal) : "—"}</span>
                  <span className="entry-actions">
                    {e.editable ? (
                      <>
                        <button onClick={() => setPanel({ editing: e })} disabled={Boolean(panel) || busyId === e.id}>Edit</button>
                        <button onClick={() => remove(e)} disabled={busyId === e.id}>{busyId === e.id ? "…" : "Delete"}</button>
                      </>
                    ) : (
                      <span className="muted" title="Logged by another app; edit it there">Read-only</span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </section>

      {panel && (
        <AddFood
          key={panel.editing?.id ?? "new"}
          date={date}
          editing={panel.editing}
          onDone={async (saved, msg) => {
            setPanel(null);
            if (msg) setNotice(msg);
            if (saved) await afterChange();
          }}
        />
      )}

      <NutritionTrends data={data} loading={loading} />
    </div>
  );
}

function NutritionTrends({ data, loading }: { data: SummaryResponse; loading: boolean }) {
  const days = data.days;
  const logged = days.filter((d) => d.nutrition);
  const avgIn = logged.length ? logged.reduce((t, d) => t + d.nutrition!.kcal, 0) / logged.length : undefined;
  const dash = "—";
  return (
    <div className="dash-grid">
      <ChartCard title="Calories eaten" subtitle={avgIn !== undefined ? `Average ${fmtInt(avgIn)} kcal on ${logged.length} logged day${logged.length === 1 ? "" : "s"}` : "No food logged in this range"} loading={loading}
        table={{ columns: ["Date", "Eaten (kcal)", "Burned (kcal)"], rows: days.map((d) => [fmtShortDate(d.date), d.nutrition ? fmtInt(d.nutrition.kcal) : dash, d.caloriesOut !== undefined ? fmtInt(d.caloriesOut) : dash]) }}>
        <ColumnChart rows={days.map((d) => ({ date: d.date, values: [d.nutrition?.kcal] }))} series={[{ label: "Calories eaten", color: S1 }]} format={fmtKcal} />
      </ChartCard>
      <ChartCard title="Macros" subtitle="Grams per day" loading={loading}
        legend={[{ label: "Protein", color: S1, shape: "rect" }, { label: "Carbs", color: S2, shape: "rect" }, { label: "Fat", color: S3, shape: "rect" }]}
        table={{ columns: ["Date", "Protein (g)", "Carbs (g)", "Fat (g)"], rows: days.map((d) => [fmtShortDate(d.date), d.nutrition?.proteinG !== undefined ? fmtInt(d.nutrition.proteinG) : dash, d.nutrition?.carbsG !== undefined ? fmtInt(d.nutrition.carbsG) : dash, d.nutrition?.fatG !== undefined ? fmtInt(d.nutrition.fatG) : dash]) }}>
        <ColumnChart rows={days.map((d) => ({ date: d.date, values: [d.nutrition?.proteinG, d.nutrition?.carbsG, d.nutrition?.fatG] }))}
          series={[{ label: "Protein", color: S1 }, { label: "Carbs", color: S2 }, { label: "Fat", color: S3 }]} format={(v) => `${fmtInt(v)} g`} />
      </ChartCard>
    </div>
  );
}
