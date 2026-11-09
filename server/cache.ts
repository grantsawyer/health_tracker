import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { HOME_DIR } from "./config.js";

/**
 * Response cache in ~/.health_tracker/cache.db.
 *
 * Only a cache. Google Health is the source of truth, so deleting the file is
 * always safe. Keys are namespaced by data type so a write can invalidate
 * just that type.
 */
const db = new DatabaseSync(join(HOME_DIR, "cache.db"));
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS api_cache (
    key        TEXT PRIMARY KEY,
    data_type  TEXT NOT NULL,
    value      TEXT NOT NULL,
    fetched_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS api_cache_type ON api_cache(data_type);
`);

const getStmt = db.prepare("SELECT value, fetched_at FROM api_cache WHERE key = ? AND expires_at > ?");
const putStmt = db.prepare(
  "INSERT OR REPLACE INTO api_cache (key, data_type, value, fetched_at, expires_at) VALUES (?, ?, ?, ?, ?)",
);

export interface CacheHit<T> {
  value: T;
  fetchedAt: number;
}

export function cacheGet<T>(key: string): CacheHit<T> | null {
  const row = getStmt.get(key, Date.now()) as { value: string; fetched_at: number } | undefined;
  return row ? { value: JSON.parse(row.value) as T, fetchedAt: row.fetched_at } : null;
}

export function cachePut(key: string, dataType: string, value: unknown, ttlMs: number): void {
  const now = Date.now();
  putStmt.run(key, dataType, JSON.stringify(value), now, now + ttlMs);
}

export function cacheInvalidateType(dataType: string): void {
  db.prepare("DELETE FROM api_cache WHERE data_type = ?").run(dataType);
}

export function cacheClear(): void {
  db.exec("DELETE FROM api_cache");
}
