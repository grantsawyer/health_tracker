import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { DEFAULT_GOALS, type Goals } from "../../shared/goals";

/** Goals from the server (app.db). Falls back to defaults until loaded so views can render. */
export function useGoals() {
  const [goals, setGoals] = useState<Goals>(DEFAULT_GOALS);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    api.goals().then((g) => { setGoals(g); setLoaded(true); }, () => setLoaded(true));
  }, []);
  const save = useCallback(async (g: Partial<Goals>) => {
    const next = await api.saveGoals(g);
    setGoals(next);
    return next;
  }, []);
  return { goals, loaded, save };
}
