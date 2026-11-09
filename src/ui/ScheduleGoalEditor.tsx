import { useEffect, useId, useRef, useState } from "react";
import { ApiError } from "../api";
import { useGoalsContext } from "../dashboard/goalsContext";
import { fmtClock } from "../viz/ScheduleChart";
import { Icon } from "./icons";

/** "HH:MM" (from <input type="time">) ↔ minutes after midnight. */
export const toMinutes = (hhmm: string): number | null => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return null;
  const h = Number(m[1]), min = Number(m[2]);
  return h < 24 && min < 60 ? h * 60 + min : null;
};
export const toHHMM = (mins: number | null) => (mins === null ? "" : `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`);

/**
 * Edit the bedtime and wake-time goals where the sleep schedule is shown, like GoalEditor does for amounts.
 * Either time may be left empty; "Clear" removes both.
 */
export function ScheduleGoalEditor() {
  const { goals, save } = useGoalsContext();
  const [open, setOpen] = useState(false);
  const [bed, setBed] = useState("");
  const [wake, setWake] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const root = useRef<HTMLSpanElement>(null);
  const first = useRef<HTMLInputElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    setBed(toHHMM(goals.bedtime));
    setWake(toHHMM(goals.wakeTime));
    setError(null);
    setTimeout(() => first.current?.focus(), 0);
    const onDoc = (e: MouseEvent) => { if (root.current && !root.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const store = async (bedtime: number | null, wakeTime: number | null) => {
    setSaving(true);
    try {
      await save({ bedtime, wakeTime });
      setOpen(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : (err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const b = bed.trim() ? toMinutes(bed) : null;
    const w = wake.trim() ? toMinutes(wake) : null;
    if ((bed.trim() && b === null) || (wake.trim() && w === null)) return setError("Enter times like 22:30");
    if (b === null && w === null) return setError("Enter a bedtime, a wake time, or both");
    void store(b, w);
  };

  const set = goals.bedtime !== null || goals.wakeTime !== null;
  const shown = !set ? "Set goal"
    : `Goal ${goals.bedtime !== null ? fmtClock(goals.bedtime) : "any"} – ${goals.wakeTime !== null ? fmtClock(goals.wakeTime) : "any"}`;
  return (
    <span className="goal-editor" ref={root}>
      <button className="goal-btn" aria-expanded={open} aria-controls={id} aria-label={`${shown} for Sleep schedule. Edit`}
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}>
        {shown} <Icon.edit />
      </button>
      {open && (
        <form id={id} className="goal-pop" role="dialog" aria-label="Sleep schedule goal" onSubmit={submit}
          onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); setOpen(false); } }} onClick={(e) => e.stopPropagation()}>
          <label>
            Bedtime
            <input ref={first} type="time" value={bed} onChange={(e) => setBed(e.target.value)} />
          </label>
          <label>
            Wake time
            <input type="time" value={wake} onChange={(e) => setWake(e.target.value)} />
          </label>
          {error && <p className="error-text small" role="alert">{error}</p>}
          <div className="goal-pop-actions">
            {set && <button type="button" onClick={() => void store(null, null)} disabled={saving}>Clear</button>}
            <button type="button" onClick={() => setOpen(false)}>Cancel</button>
            <button className="primary" type="submit" disabled={saving}>{saving ? "Saving…" : "Save"}</button>
          </div>
        </form>
      )}
    </span>
  );
}
