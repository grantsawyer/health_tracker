import { cacheGet, cachePut, ttlForRange } from "./cache.js";
import { dailyRollUp, listDataPoints, type DailyRollupPoint, type DataPoint } from "./googleHealth.js";
import type { DataTypeInfo } from "../shared/dataTypes.js";

/**
 * Cached reads shared by the raw data routes and the dashboard summary.
 * Keys are per (kind, type, range, source), so the explorer and dashboards
 * reuse each other's fetches.
 */
export interface Cached<T> {
  value: T;
  cached: boolean;
  fetchedAt: string;
}

async function withCache<T>(key: string, dataType: string, end: string, fresh: boolean, load: () => Promise<T>): Promise<Cached<T>> {
  if (!fresh) {
    const hit = cacheGet<T>(key);
    if (hit) return { value: hit.value, cached: true, fetchedAt: new Date(hit.fetchedAt).toISOString() };
  }
  const value = await load();
  cachePut(key, dataType, value, ttlForRange(end));
  return { value, cached: false, fetchedAt: new Date().toISOString() };
}

export interface ReadOptions {
  start: string;
  end: string;
  source?: string;
  fresh?: boolean;
}

export function getPoints(info: DataTypeInfo, o: ReadOptions): Promise<Cached<{ dataPoints: DataPoint[]; truncated: boolean }>> {
  const key = `points:${info.id}:${o.start}:${o.end}:${o.source ?? "all"}`;
  return withCache(key, info.id, o.end, Boolean(o.fresh), () =>
    listDataPoints(info, { start: o.start, end: o.end, dataSourceFamily: o.source }),
  );
}

export function getRollup(info: DataTypeInfo, o: ReadOptions): Promise<Cached<{ days: DailyRollupPoint[] }>> {
  const key = `rollup:${info.id}:${o.start}:${o.end}:${o.source ?? "all"}`;
  return withCache(key, info.id, o.end, Boolean(o.fresh), async () => ({ days: await dailyRollUp(info, o.start, o.end, o.source) }));
}
