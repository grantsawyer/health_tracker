import type { CacheStore, PendingRow, PendingStore, Platform, SettingsStore } from "../../core/platform.js";

/**
 * An in-memory core/platform: no SQLite, files or server modules. Proves core/
 * runs anywhere (this is the shape the browser build will implement with
 * IndexedDB / Google Drive / GIS).
 */
export function memoryPlatform(opts: { token?: string; clientId?: string } = {}) {
  const cacheMap = new Map<string, { type: string; value: unknown; fetchedAt: number; expiresAt: number }>();
  const settingsMap = new Map<string, unknown>();
  const rows = new Map<string, PendingRow<unknown>>();
  let token: string | null = opts.token ?? "memory-token";
  let seq = 0;

  const cache: CacheStore = {
    async get<T>(key: string) {
      const e = cacheMap.get(key);
      return e && e.expiresAt > Date.now() ? { value: structuredClone(e.value) as T, fetchedAt: e.fetchedAt } : null;
    },
    async put(key, type, value, ttl) { cacheMap.set(key, { type, value: structuredClone(value), fetchedAt: Date.now(), expiresAt: Date.now() + ttl }); },
    async invalidateType(type) { for (const [k, v] of cacheMap) if (v.type === type) cacheMap.delete(k); },
    async clear() { cacheMap.clear(); },
  };
  const settings: SettingsStore = {
    async get<T>(key: string) { return settingsMap.has(key) ? (structuredClone(settingsMap.get(key)) as T) : undefined; },
    async put(key, value) { settingsMap.set(key, structuredClone(value)); },
  };
  const pending: PendingStore = {
    async enqueue(entry, startTime, label, error) {
      const id = `p${++seq}`;
      rows.set(id, { id, entry, startTime, label, attempts: 1, lastError: error, failed: false, createdAt: Date.now(), nextAttemptAt: Date.now() + 60_000 });
      return id;
    },
    async list<T>() { return [...rows.values()] as PendingRow<T>[]; },
    async due<T>(now = Date.now()) { return [...rows.values()].filter((r) => !r.failed && r.nextAttemptAt <= now) as PendingRow<T>[]; },
    async remove(id) { return rows.delete(id); },
    async markAttempt(id, error, permanent, attempts) {
      const r = rows.get(id);
      if (r) Object.assign(r, { attempts, lastError: error, failed: permanent, nextAttemptAt: Date.now() + 60_000 });
    },
    async makeDueNow(includeFailed) { for (const r of rows.values()) { r.nextAttemptAt = 0; if (includeFailed) r.failed = false; } },
  };
  const platform: Platform = {
    fetch: (...args) => globalThis.fetch(...args),
    async getAccessToken() {
      if (!token) throw new (await import("../../core/errors.js")).ReauthRequiredError("Not signed in");
      return token;
    },
    async invalidateAccessToken() { /* memory tokens don't expire */ },
    clientId: () => opts.clientId ?? "123456789012-testclientid.apps.googleusercontent.com",
    cache, settings, pending,
    off: { headers: { "User-Agent": "HealthTracker/test" }, search: "searchalicious" },
    log: { info() {}, warn() {} },
  };
  return { platform, settingsMap, rows, signOut: () => { token = null; } };
}
