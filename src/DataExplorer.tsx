import { useEffect, useState } from "react";
import { ApiError, api, type DataTypeWithGrant, type PointsResponse, type RollupResponse, type Source } from "./api";

/**
 * Phase 2 debug page: fetch raw Google Health responses per data type so we
 * can verify request shapes and record fixtures before building dashboards.
 */

const localDate = (d: Date) => d.toLocaleDateString("en-CA"); // YYYY-MM-DD

function defaultRange() {
  const end = new Date();
  end.setDate(end.getDate() + 1); // exclusive end → includes today
  const start = new Date();
  start.setDate(start.getDate() - 6);
  return { start: localDate(start), end: localDate(end) };
}

type Mode = "points" | "rollup";
type Result = { mode: "points"; data: PointsResponse } | { mode: "rollup"; data: RollupResponse };

export function DataExplorer() {
  const [types, setTypes] = useState<DataTypeWithGrant[]>([]);
  const [typeId, setTypeId] = useState("steps");
  const [mode, setMode] = useState<Mode>("rollup");
  const [range, setRange] = useState(defaultRange);
  const [source, setSource] = useState<Source>("all");
  const [fresh, setFresh] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<ApiError | Error | null>(null);
  const [writeLog, setWriteLog] = useState<string | null>(null);

  useEffect(() => {
    api.dataTypes().then(setTypes, setError);
  }, []);

  const info = types.find((t) => t.id === typeId);
  const effectiveMode: Mode = info && !info.rollup ? "points" : mode;

  const run = async () => {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const q = { ...range, source, fresh };
      setResult(
        effectiveMode === "rollup"
          ? { mode: "rollup", data: await api.rollup(typeId, q) }
          : { mode: "points", data: await api.points(typeId, q) },
      );
    } catch (err) {
      setError(err as Error);
    } finally {
      setLoading(false);
    }
  };

  const writeTest = async () => {
    if (!window.confirm("Write a 1 kcal “Health Tracker test entry” snack to your real Google Health food log?")) return;
    setWriteLog("Writing…");
    try {
      const res = await api.nutritionTest({ kcal: 1, foodDisplayName: "Health Tracker test entry" });
      setWriteLog(`Create succeeded:\n${JSON.stringify(res, null, 2)}`);
      setTypeId("nutrition-log");
      setMode("points");
      setSource("self");
    } catch (err) {
      setWriteLog(`Create failed:\n${describe(err as Error)}`);
    }
  };

  const remove = async (name: string) => {
    if (!window.confirm(`Delete ${name}?`)) return;
    try {
      const res = await api.deletePoints([name]);
      setWriteLog(`Delete succeeded:\n${JSON.stringify(res, null, 2)}`);
      await run();
    } catch (err) {
      setWriteLog(`Delete failed:\n${describe(err as Error)}`);
    }
  };

  const count = result ? (result.mode === "rollup" ? result.data.days.length : result.data.dataPoints.length) : 0;
  const showDelete = result?.mode === "points" && source === "self";

  return (
    <div className="explorer">
      <section className="card card-wide">
        <h2>Data explorer</h2>
        <p className="muted">Raw Google Health API responses, for checking request shapes before the dashboards.</p>

        <div className="form-grid">
          <label>
            Data type
            <select value={typeId} onChange={(e) => setTypeId(e.target.value)}>
              {types.map((t) => (
                <option key={t.id} value={t.id} disabled={!t.granted}>
                  {t.label} ({t.id}){t.granted ? "" : " (permission not granted)"}
                </option>
              ))}
            </select>
          </label>
          <label>
            Query
            <select value={effectiveMode} onChange={(e) => setMode(e.target.value as Mode)} disabled={info && !info.rollup}>
              <option value="rollup">Daily rollup</option>
              <option value="points">Raw data points</option>
            </select>
          </label>
          <label>
            From
            <input type="date" value={range.start} onChange={(e) => setRange((r) => ({ ...r, start: e.target.value }))} />
          </label>
          <label>
            To (exclusive)
            <input type="date" value={range.end} onChange={(e) => setRange((r) => ({ ...r, end: e.target.value }))} />
          </label>
          <label>
            Sources
            <select value={source} onChange={(e) => setSource(e.target.value as Source)} disabled={info?.noSourceFamily}>
              <option value="all">All sources</option>
              <option value="googleSources">Google sources</option>
              <option value="googleWearables">Google wearables</option>
              <option value="self">Written by this app</option>
            </select>
          </label>
          <label className="check">
            <input type="checkbox" checked={fresh} onChange={(e) => setFresh(e.target.checked)} /> Bypass cache
          </label>
        </div>
        {info?.rollupMaxDays && effectiveMode === "rollup" && (
          <p className="muted">The API limits this type to {info.rollupMaxDays}-day requests; longer ranges are split automatically.</p>
        )}

        <div className="actions">
          <button className="primary" onClick={run} disabled={loading || !info?.granted}>
            {loading ? "Fetching…" : "Fetch"}
          </button>
        </div>
      </section>

      {error && (
        <section className="card card-wide">
          <h3>Error</h3>
          <pre className="json error-text">{describe(error)}</pre>
        </section>
      )}

      {result && (
        <section className="card card-wide">
          <h3>
            {count} {result.mode === "rollup" ? "days" : "data points"}
            {result.mode === "points" && result.data.truncated && " (truncated)"}
          </h3>
          <p className="muted">
            {result.data.cached ? "From cache" : "Live"} · fetched {new Date(result.data.fetchedAt).toLocaleString()}
          </p>
          {showDelete && result.mode === "points" && result.data.dataPoints.length > 0 && (
            <ul className="point-list">
              {result.data.dataPoints.map((p, i) => (
                <li key={p.name ?? i}>
                  <code>{p.name ?? "(no name)"}</code>
                  {p.name && <button onClick={() => remove(p.name!)}>Delete</button>}
                </li>
              ))}
            </ul>
          )}
          <pre className="json">{JSON.stringify(result.mode === "rollup" ? result.data.days : result.data.dataPoints, null, 2)}</pre>
        </section>
      )}

      <section className="card card-wide">
        <h3>Write check</h3>
        <p>
          Confirms Google Health accepts food entries from this app. Writes one 1 kcal snack named “Health Tracker
          test entry” to your real food log. Afterwards, query <em>Food log</em> with <em>Written by this app</em> to see
          it and delete it.
        </p>
        <div className="actions">
          <button onClick={writeTest}>Write test food entry</button>
        </div>
        {writeLog && <pre className="json">{writeLog}</pre>}
      </section>
    </div>
  );
}

function describe(err: Error): string {
  if (err instanceof ApiError) {
    const hint =
      err.body?.error === "reauth_required"
        ? "\n→ Sign in again on the Connection tab."
        : err.body?.error === "account_not_linked"
          ? "\n→ Link your account in the Google Health app."
          : "";
    return `${err.status} ${err.body?.error ?? ""}: ${err.message}${hint}${err.body?.google ? `\n\n${JSON.stringify(err.body.google, null, 2)}` : ""}`;
  }
  return err.message;
}
