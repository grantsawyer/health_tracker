import { useEffect, useState } from "react";
import { ApiError } from "./api";
import { useGoals } from "./dashboard/useGoals";
import { useUnits } from "./units";
import { GOAL_LIMITS, type Goals } from "../shared/goals";
import { toHHMM, toMinutes } from "./ui/ScheduleGoalEditor";

/**
 * Goals and display units. Google Health's API has no goals, so these live in
 * the app (app.db) and drive the rings, goal lines, check badges and status pills.
 */
const FIELDS: { key: keyof Goals; label: string; unit: string; scale?: number }[] = [
  { key: "steps", label: "Steps", unit: "a day" },
  { key: "activeZoneMinutes", label: "Active zone minutes", unit: "a day" },
  { key: "floors", label: "Floors", unit: "a day" },
  { key: "caloriesBurned", label: "Calories burned", unit: "kcal a day" },
  { key: "exerciseDaysPerWeek", label: "Exercise days", unit: "a week" },
  { key: "sleepMinutes", label: "Sleep", unit: "hours a night", scale: 60 },
  { key: "caloriesEaten", label: "Calories eaten", unit: "kcal a day (budget)" },
  { key: "carbsG", label: "Carbs", unit: "g a day" },
  { key: "fatG", label: "Fat", unit: "g a day" },
  { key: "proteinG", label: "Protein", unit: "g a day" },
];

export function Preferences() {
  const { goals, loaded, save } = useGoals();
  const [units, setUnits] = useUnits();
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!loaded) return;
    setDraft({
      ...Object.fromEntries(FIELDS.map((f) => {
        const v = goals[f.key];
        return [f.key, v === null ? "" : String(f.scale ? Math.round(((v as number) / f.scale) * 100) / 100 : v)];
      })),
      bedtime: toHHMM(goals.bedtime),
      wakeTime: toHHMM(goals.wakeTime),
    });
  }, [loaded, goals]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const out: Partial<Goals> = {};
    for (const f of FIELDS) {
      const raw = (draft[f.key] ?? "").trim();
      if (raw === "") {
        if (f.key === "sleepMinutes") out.sleepMinutes = null;
        else return setError(`${f.label} needs a value`);
        continue;
      }
      const n = Number(raw) * (f.scale ?? 1);
      if (!Number.isFinite(n) || n <= 0 || n > GOAL_LIMITS[f.key]) return setError(`${f.label} must be a positive number`);
      (out as Record<string, number>)[f.key] = Math.round(n * 10) / 10;
    }
    for (const [key, label] of [["bedtime", "Bedtime"], ["wakeTime", "Wake time"]] as const) {
      const raw = (draft[key] ?? "").trim();
      const m = raw ? toMinutes(raw) : null;
      if (raw && m === null) return setError(`${label} must be a time like 22:30`);
      out[key] = m;
    }
    setState("saving");
    try {
      await save(out);
      setState("saved");
      setTimeout(() => setState("idle"), 1500);
    } catch (err) {
      setState("idle");
      setError(err instanceof ApiError ? err.message : (err as Error).message);
    }
  };

  return (
    <section className="card card-wide" aria-labelledby="prefs-h">
      <h2 id="prefs-h">Goals</h2>
      <p className="muted">Used for rings, goal lines, check marks and status labels. Google Health doesn't share the goals you set in its app, so set them here.</p>
      <form onSubmit={submit}>
        <div className="goals-grid" style={{ marginTop: 12 }}>
          {FIELDS.map((f) => (
            <label key={f.key}>
              {f.label} <span className="muted">({f.unit})</span>
              <input type="number" inputMode="decimal" min="0" step="any" value={draft[f.key] ?? ""}
                placeholder={f.key === "sleepMinutes" ? "Not set" : undefined}
                onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))} />
            </label>
          ))}
        </div>
        <div className="goals-grid" style={{ marginTop: 12 }}>
          <label>
            Bedtime <span className="muted">(optional)</span>
            <input type="time" value={draft.bedtime ?? ""} onChange={(e) => setDraft((d) => ({ ...d, bedtime: e.target.value }))} />
          </label>
          <label>
            Wake time <span className="muted">(optional)</span>
            <input type="time" value={draft.wakeTime ?? ""} onChange={(e) => setDraft((d) => ({ ...d, wakeTime: e.target.value }))} />
          </label>
        </div>
        <p className="muted small">A night is on schedule when bedtime and wake time are each within 30 minutes of these.</p>
        {error && <p className="error-text" role="alert">{error}</p>}
        <div className="actions">
          <button className="primary" type="submit" disabled={!loaded || state === "saving"}>{state === "saving" ? "Saving…" : state === "saved" ? "Saved" : "Save goals"}</button>
        </div>
      </form>

      <h3>Units</h3>
      <div className="seg" role="group" aria-label="Units">
        <button className={units === "imperial" ? "seg-btn active" : "seg-btn"} aria-pressed={units === "imperial"} onClick={() => setUnits("imperial")}>lb · mi</button>
        <button className={units === "metric" ? "seg-btn active" : "seg-btn"} aria-pressed={units === "metric"} onClick={() => setUnits("metric")}>kg · km</button>
      </div>
    </section>
  );
}
