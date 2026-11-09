import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { DEFAULT_LAYOUT, type TodayLayout } from "../../shared/layout";

/** The Today page layout from app.db (defaults until loaded, so the page renders immediately). */
export function useLayout() {
  const [layout, setLayout] = useState<TodayLayout>(DEFAULT_LAYOUT);
  useEffect(() => {
    api.layout().then(setLayout, () => undefined);
  }, []);
  const save = useCallback(async (l: TodayLayout) => setLayout(await api.saveLayout(l)), []);
  const reset = useCallback(async () => setLayout(await api.resetLayout()), []);
  return { layout, save, reset };
}
