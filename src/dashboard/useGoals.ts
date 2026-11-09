import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { DEFAULT_GOALS, type Goals } from "../../shared/goals";

/** The user's goals. Falls back to defaults until loaded so views can render; `saved` is false until they save any. */
export function useGoals() {
  const [goals, setGoals] = useState<Goals>(DEFAULT_GOALS);
  const [loaded, setLoaded] = useState(false);
  const [saved, setSaved] = useState(true); // assume saved until we know, so the first-run card never flashes
  const reload = useCallback(() => Promise.all([api.goals(), api.goalsSaved()]).then(
    ([g, s]) => { setGoals(g); setSaved(s); setLoaded(true); },
    () => setLoaded(true),
  ), []);
  useEffect(() => {
    void reload();
  }, [reload]);
  const save = useCallback(async (g: Partial<Goals>) => {
    const next = await api.saveGoals(g);
    setGoals(next);
    setSaved(true);
    return next;
  }, []);
  return { goals, loaded, saved, save, reload };
}
