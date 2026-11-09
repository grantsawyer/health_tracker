import { useCallback, useEffect, useMemo, useState } from "react";
import { ApiError } from "../api";
import { useUnits } from "../units";
import { Icon } from "../ui/icons";
import { BodyView, FitnessView, SleepView, TodayView, type Tab, type ViewCtx } from "./Dashboards";
import { FoodView } from "../food/FoodView";
import { useSummary } from "./useSummary";
import { GoalsProvider, useGoalsContext } from "./goalsContext";
import {
  PERIODS, addDaysISO, canStepForward, displayDates, fetchRange, isCurrent, periodTitle, step, todayISO,
  type Period, type PeriodKind,
} from "./period";
import { dataTypeById } from "../../shared/dataTypes";
import "../viz/viz.css";

const KIND_KEY = "health-tracker:period";

function initialPeriod(): Period {
  const today = todayISO();
  // Optional deep link: ?date=YYYY-MM-DD opens that day (ignored if malformed or in the future).
  const q = new URLSearchParams(window.location.search).get("date");
  if (q && /^\d{4}-\d{2}-\d{2}$/.test(q) && q <= today) return { kind: "D", anchor: q };
  let kind: PeriodKind = "D";
  try {
    const k = localStorage.getItem(KIND_KEY);
    if (k && (PERIODS as string[]).includes(k)) kind = k as PeriodKind;
  } catch {
    /* storage unavailable */
  }
  return { kind, anchor: today };
}

/**
 * Shared frame for the dashboard tabs: the period bar (D / W / M / 3M, title,
 * ‹ › and back-to-today) scoping everything below it, one summary fetch for the
 * displayed range plus a 30-day baseline for "your typical range", and goals.
 */
type ShellProps = { tab: Tab; onReauth: () => void; onNavigate: (t: Tab) => void };

export function DashboardShell(props: ShellProps) {
  return <GoalsProvider><Shell {...props} /></GoalsProvider>;
}

function Shell({ tab, onReauth, onNavigate }: ShellProps) {
  const [chosen, setChosen] = useState<Period>(initialPeriod);
  const [units] = useUnits();
  const { goals } = useGoalsContext();
  const [autoOpenAdd, setAutoOpenAdd] = useState(false);
  const today = todayISO();

  // The Today tab is always a single day; other tabs use the chosen period.
  const period: Period = tab === "today" ? { kind: "D", anchor: chosen.anchor } : chosen;
  const setKind = (kind: PeriodKind) => {
    setChosen((p) => ({ ...p, kind }));
    try {
      localStorage.setItem(KIND_KEY, kind);
    } catch {
      /* not persisted */
    }
  };

  const range = useMemo(() => fetchRange(period, today), [period.kind, period.anchor, today]); // eslint-disable-line react-hooks/exhaustive-deps
  const baselineRange = useMemo(() => {
    const end = addDaysISO(period.anchor, 1);
    return { start: addDaysISO(period.anchor, -29), end: end > addDaysISO(today, 1) ? addDaysISO(today, 1) : end };
  }, [period.anchor, today]);
  const main = useSummary(range);
  const baseline = useSummary(baselineRange);

  useEffect(() => {
    if (main.error instanceof ApiError && main.error.body?.error === "reauth_required") onReauth();
  }, [main.error, onReauth]);

  const reloadAll = useCallback(() => {
    void main.reload();
    void baseline.reload();
  }, [main, baseline]);
  const refreshAll = () => {
    void main.refresh();
    void baseline.refresh();
  };

  const errorTypes = main.data ? Object.entries(main.data.errors) : [];
  const ctx: ViewCtx | null = main.data
    ? {
        period, today, dates: displayDates(period), data: main.data, baseline: baseline.data, goals, units,
        loading: main.loading, open: onNavigate,
        logFood: () => { setAutoOpenAdd(true); onNavigate("food"); },
      }
    : null;

  return (
    <div className="viz dash-root">
      <div className="period-bar">
        <div className="period-title">
          <h1>{periodTitle(period, today)}</h1>
          <button className="icon-btn" aria-label="Previous" onClick={() => setChosen((p) => ({ ...p, anchor: step({ kind: period.kind, anchor: p.anchor }, -1).anchor }))}><Icon.chevronLeft /></button>
          <button className="icon-btn" aria-label="Next" disabled={!canStepForward(period, today)} onClick={() => setChosen((p) => ({ ...p, anchor: step({ kind: period.kind, anchor: p.anchor }, 1).anchor }))}><Icon.chevronRight /></button>
          {!isCurrent(period, today) && (
            <button className="icon-btn" aria-label="Back to today" title="Back to today" onClick={() => setChosen((p) => ({ ...p, anchor: today }))}><Icon.reset /></button>
          )}
        </div>
        <div className="period-controls">
          {tab !== "today" && (
            <div className="seg" role="group" aria-label="Period">
              {PERIODS.map((k) => (
                <button key={k} className={k === period.kind ? "seg-btn active" : "seg-btn"} aria-pressed={k === period.kind} onClick={() => setKind(k)}
                  aria-label={{ D: "Day", W: "Week", M: "Month", "3M": "3 months" }[k]}>{k}</button>
              ))}
            </div>
          )}
          <button className="icon-btn" aria-label="Refresh from Google Health" title="Refresh from Google Health" onClick={refreshAll} disabled={main.loading}><Icon.refresh /></button>
          {main.data && <span className="muted updated">Updated {new Date(main.data.fetchedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>}
        </div>
      </div>

      {main.error && !(main.error instanceof ApiError && main.error.body?.error === "reauth_required") && (
        <div className="banner banner-error" role="alert">Couldn't load your data: {main.error.message}</div>
      )}
      {errorTypes.length > 0 && (
        <div className="banner banner-warn" role="status">
          Some data couldn't be loaded: {errorTypes.map(([id, msg]) => `${dataTypeById(id)?.label ?? id} (${msg})`).join("; ")}
        </div>
      )}

      {!ctx ? (
        !main.error && <p className="muted">Loading your data…</p>
      ) : tab === "today" ? (
        <TodayView {...ctx} />
      ) : tab === "fitness" ? (
        <FitnessView {...ctx} />
      ) : tab === "sleep" ? (
        <SleepView {...ctx} />
      ) : tab === "food" ? (
        <FoodView ctx={ctx} onChanged={reloadAll} autoOpenAdd={autoOpenAdd} onAutoOpened={() => setAutoOpenAdd(false)} />
      ) : (
        <BodyView {...ctx} />
      )}
    </div>
  );
}
