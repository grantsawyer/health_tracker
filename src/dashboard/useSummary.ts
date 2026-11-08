import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api";
import type { SummaryResponse } from "../../shared/summary";

export type RangeDays = 7 | 30 | 90;

const localDate = (d: Date) => d.toLocaleDateString("en-CA"); // YYYY-MM-DD

/** [start, end) covering the last `days` days including today. */
export function rangeFor(days: number): { start: string; end: string } {
  const end = new Date();
  end.setDate(end.getDate() + 1);
  const start = new Date();
  start.setDate(start.getDate() - (days - 1));
  return { start: localDate(start), end: localDate(end) };
}

/**
 * Loads the dashboard summary for a range. While refetching, the previous
 * data stays on screen (charts dim instead of flashing to a skeleton).
 */
export function useSummary(days: RangeDays) {
  const [data, setData] = useState<SummaryResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const reqId = useRef(0);

  const load = useCallback(
    async (fresh = false) => {
      const id = ++reqId.current;
      setLoading(true);
      setError(null);
      try {
        const res = await api.summary({ ...rangeFor(days), fresh });
        if (id === reqId.current) setData(res);
      } catch (err) {
        if (id === reqId.current) setError(err as Error);
      } finally {
        if (id === reqId.current) setLoading(false);
      }
    },
    [days],
  );

  useEffect(() => {
    void load();
  }, [load]);

  return { data, loading, error, refresh: () => load(true), reload: () => load(false) };
}
