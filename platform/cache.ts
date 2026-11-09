import type { CacheHit, CacheStore } from "../core/platform.js";
import { deleteWhere, getAll, run, STORES } from "./idb.js";

interface CacheRecord {
  user: string;
  key: string;
  type: string;
  value: unknown;
  fetchedAt: number;
  expiresAt: number;
}

/**
 * The browser's response cache (replaces server/cache.ts's cache.db), with the
 * same contract: TTL chosen by core/dataService, keys namespaced by data type
 * so a write invalidates just that type. Entries are per user: `clear()` and
 * `invalidateType()` only touch the signed-in user's rows.
 */
export function createIdbCache(db: IDBDatabase, userKey: () => string, now: () => number = Date.now): CacheStore & {
  /** Delete expired rows for every user (run once at startup; reads already ignore them). */
  pruneExpired(): Promise<number>;
} {
  return {
    async get<T>(key: string): Promise<CacheHit<T> | null> {
      const rec = await run(db, STORES.cache, "readonly", (s) => s.get([userKey(), key]) as IDBRequest<CacheRecord | undefined>);
      return rec && rec.expiresAt > now() ? { value: rec.value as T, fetchedAt: rec.fetchedAt } : null;
    },
    async put(key, type, value, ttlMs) {
      const t = now();
      const rec: CacheRecord = { user: userKey(), key, type, value, fetchedAt: t, expiresAt: t + ttlMs };
      await run(db, STORES.cache, "readwrite", (s) => s.put(rec));
    },
    async invalidateType(type) {
      await deleteWhere(db, STORES.cache, "byUserType", [userKey(), type]);
    },
    async clear() {
      await deleteWhere(db, STORES.cache, "byUser", userKey());
    },
    async pruneExpired() {
      const t = now();
      const users = new Set((await getAll<CacheRecord>(db, STORES.cache)).filter((r) => r.expiresAt <= t).map((r) => r.user));
      let n = 0;
      for (const u of users) n += await deleteWhere<CacheRecord>(db, STORES.cache, "byUser", u, (r) => r.expiresAt <= t);
      return n;
    },
  };
}
