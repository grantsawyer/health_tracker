import { useEffect, useState } from "react";
import { ApiError } from "../api";
import { useUnits } from "../units";
import { BodyView, FitnessView, SleepView, TodayView } from "./Dashboards";
import { useSummary, type RangeDays } from "./useSummary";
import { FoodView } from "../food/FoodView";
import { dataTypeById } from "../../shared/dataTypes";
import type { DashboardTab } from "../App";
import "../viz/viz.css";

const RANGE_KEY = "health-tracker:range";
const RANGES: RangeDays[] = [7, 30, 90];

function initialRange(): RangeDays {
  try {
    const v = Number(localStorage.getItem(RANGE_KEY));
    return (RANGES as number[]).includes(v) ? (v as RangeDays) : 30;
  } catch {
    return 30;
  }
}

/**
 * Shared frame for the dashboards: one filter row (date range first, then
 * units, refresh) scoping every chart below it, and a single summary fetch
 * reused across tabs.
 */
export function DashboardShell({ tab, onReauth }: { tab: DashboardTab; onReauth: () => void }) {
  const [days, setDaysState] = useState<RangeDays>(initialRange);
  const [units, setUnits] = useUnits();
  const { data, loading, error, refresh, reload } = useSummary(days);

  const setDays = (d: RangeDays) => {
    setDaysState(d);
    try {
      localStorage.setItem(RANGE_KEY, String(d));
    } catch {
      /* not persisted */
    }
  };

  // Session expired mid-use: let the app re-check status (it routes to Account).
  useEffect(() => {
    if (error instanceof ApiError && error.body?.error === "reauth_required") onReauth();
  }, [error, onReauth]);

  const errorTypes = data ? Object.entries(data.errors) : [];

  return (
    <div className="viz dash-root">
      <div className="filter-row" role="toolbar" aria-label="Dashboard filters">
        <div className="seg" role="group" aria-label="Date range">
          {RANGES.map((r) => (
            <button key={r} className={r === days ? "seg-btn active" : "seg-btn"} aria-pressed={r === days} onClick={() => setDays(r)}>
              {r === 7 ? "7 days" : `${r} days`}
            </button>
          ))}
        </div>
        <div className="seg" role="group" aria-label="Units">
          <button className={units === "imperial" ? "seg-btn active" : "seg-btn"} aria-pressed={units === "imperial"} onClick={() => setUnits("imperial")}>lb · mi</button>
          <button className={units === "metric" ? "seg-btn active" : "seg-btn"} aria-pressed={units === "metric"} onClick={() => setUnits("metric")}>kg · km</button>
        </div>
        <button className="refresh-btn" onClick={refresh} disabled={loading}>{loading ? "Loading…" : "Refresh"}</button>
        {data && (
          <span className="muted updated">Updated {new Date(data.fetchedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>
        )}
      </div>

      {error && !(error instanceof ApiError && error.body?.error === "reauth_required") && (
        <div className="banner banner-error" role="alert">Couldn't load your data: {error.message}</div>
      )}
      {errorTypes.length > 0 && (
        <div className="banner banner-warn" role="status">
          Some data couldn't be loaded: {errorTypes.map(([id, msg]) => `${dataTypeById(id)?.label ?? id} (${msg})`).join("; ")}
        </div>
      )}

      {!data ? (
        !error && <p className="muted">Loading your data…</p>
      ) : tab === "today" ? (
        <TodayView data={data} loading={loading} units={units} />
      ) : tab === "fitness" ? (
        <FitnessView data={data} loading={loading} units={units} />
      ) : tab === "sleep" ? (
        <SleepView data={data} loading={loading} units={units} />
      ) : tab === "food" ? (
        <FoodView data={data} loading={loading} onChanged={reload} />
      ) : (
        <BodyView data={data} loading={loading} units={units} />
      )}
    </div>
  );
}
