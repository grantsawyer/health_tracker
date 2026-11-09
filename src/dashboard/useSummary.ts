import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api";
import type { SummaryResponse } from "../../shared/summary";

/**
 * Loads the dashboard summary for [start, end). While refetching, the previous
 * data stays on screen (charts dim instead of flashing to a skeleton).
 */
export function useSummary(range: { start: string; end: string } | null) {
  const [data, setData] = useState<SummaryResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const reqId = useRef(0);
  const start = range?.start, end = range?.end;

  const load = useCallback(
    async (fresh = false) => {
      if (!start || !end) return;
      const id = ++reqId.current;
      setLoading(true);
      setError(null);
      try {
        const res = await api.summary({ start, end, fresh });
        if (id === reqId.current) setData(res);
      } catch (err) {
        if (id === reqId.current) setError(err as Error);
      } finally {
        if (id === reqId.current) setLoading(false);
      }
    },
    [start, end],
  );

  useEffect(() => {
    void load();
  }, [load]);

  return { data, loading, error, refresh: () => load(true), reload: () => load(false) };
}
