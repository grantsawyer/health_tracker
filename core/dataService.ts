import { dailyRollUp, listDataPoints, type DailyRollupPoint, type DataPoint } from "./healthClient.js";
import { platform } from "./platform.js";
import type { DataTypeInfo } from "../shared/dataTypes.js";

/**
 * Cached reads shared by the raw data routes, the dashboard summary and food.
 * Keys are per (kind, type, range, source), so callers reuse each other's fetches.
 */
export interface Cached<T> {
  value: T;
  cached: boolean;
  fetchedAt: string;
}

/** Ranges that include today (or later) change constantly; past days rarely do. */
export function ttlForRange(endDateExclusive: string, now = new Date()): number {
  const today = now.toLocaleDateString("en-CA"); // YYYY-MM-DD in local time
  return endDateExclusive > today ? 5 * 60_000 : 24 * 60 * 60_000;
}

export async function withCache<T>(key: string, dataType: string, ttlMs: number, fresh: boolean, load: () => Promise<T>): Promise<Cached<T>> {
  const cache = platform().cache;
  if (!fresh) {
    const hit = await cache.get<T>(key);
    if (hit) return { value: hit.value, cached: true, fetchedAt: new Date(hit.fetchedAt).toISOString() };
  }
  const value = await load();
  await cache.put(key, dataType, value, ttlMs);
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
  return withCache(key, info.id, ttlForRange(o.end), Boolean(o.fresh), () =>
    listDataPoints(info, { start: o.start, end: o.end, dataSourceFamily: o.source }),
  );
}

export function getRollup(info: DataTypeInfo, o: ReadOptions): Promise<Cached<{ days: DailyRollupPoint[] }>> {
  const key = `rollup:${info.id}:${o.start}:${o.end}:${o.source ?? "all"}`;
  return withCache(key, info.id, ttlForRange(o.end), Boolean(o.fresh), async () => ({ days: await dailyRollUp(info, o.start, o.end, o.source) }));
}
