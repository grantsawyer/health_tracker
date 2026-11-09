import { useEffect, useId, useRef, useState } from "react";
import { ApiError } from "../api";
import { GOAL_LIMITS, type Goals } from "../../shared/goals";
import { useGoalsContext } from "../dashboard/goalsContext";
import { Icon } from "./icons";

/**
 * Edit one goal where it's shown (next to a goal line, macro bar or the steps
 * ring). Shows "Goal 10,000" (or "Set goal"); clicking opens a small popover.
 * `scale` converts the stored unit for display, e.g. sleep minutes ↔ hours (60).
 */
export function GoalEditor({ goalKey, label, unit = "", scale = 1, format }: {
  goalKey: keyof Goals;
  label: string;
  unit?: string;
  scale?: number;
  format?: (v: number) => string;
}) {
  const { goals, save } = useGoalsContext();
  const current = goals[goalKey];
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const root = useRef<HTMLSpanElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    setValue(current === null ? "" : String(Math.round(((current as number) / scale) * 100) / 100));
    setError(null);
    setTimeout(() => input.current?.select(), 0);
    const onDoc = (e: MouseEvent) => { if (root.current && !root.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const n = Number(value) * scale;
    if (!value.trim() || !Number.isFinite(n) || n <= 0 || n > GOAL_LIMITS[goalKey]) {
      setError(`Enter a number between 1 and ${Math.floor(GOAL_LIMITS[goalKey] / scale).toLocaleString()}`);
      return;
    }
    setSaving(true);
    try {
      await save({ [goalKey]: Math.round(n * 10) / 10 } as Partial<Goals>);
      setOpen(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : (err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const shown = current === null ? "Set goal" : `Goal ${format ? format(current as number) : `${(Math.round(((current as number) / scale) * 10) / 10).toLocaleString()}${unit}`}`;
  return (
    <span className="goal-editor" ref={root}>
      <button className="goal-btn" aria-expanded={open} aria-controls={id} aria-label={`${shown} for ${label}. Edit`}
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}>
        {shown} <Icon.edit />
      </button>
      {open && (
        <form id={id} className="goal-pop" role="dialog" aria-label={`${label} goal`} onSubmit={submit}
          onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); setOpen(false); } }} onClick={(e) => e.stopPropagation()}>
          <label>
            {label} goal{unit ? ` (${unit.trim()})` : ""}
            <input ref={input} type="number" inputMode="decimal" min="0" step="any" value={value} onChange={(e) => setValue(e.target.value)} />
          </label>
          {error && <p className="error-text small" role="alert">{error}</p>}
          <div className="goal-pop-actions">
            <button type="button" onClick={() => setOpen(false)}>Cancel</button>
            <button className="primary" type="submit" disabled={saving}>{saving ? "Saving…" : "Save"}</button>
          </div>
        </form>
      )}
    </span>
  );
}
