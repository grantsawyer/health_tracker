import type { CacheStore, PendingRow, PendingStore, Platform, SettingsStore } from "../../core/platform.js";

/**
 * An in-memory core/platform for unit tests: proves core/ runs anywhere. Like
 * the browser platform, settings, the retry queue and the cache belong to the
 * signed-in account, so per-user isolation can be tested with `signIn(email)`.
 */
export function memoryPlatform(opts: { token?: string; clientId?: string; email?: string } = {}) {
  let user = opts.email ?? "tester@example.com";
  const perUser = <V>() => {
    const all = new Map<string, Map<string, V>>();
    return () => {
      if (!all.has(user)) all.set(user, new Map());
      return all.get(user)!;
    };
  };
  const cacheOf = perUser<{ type: string; value: unknown; fetchedAt: number; expiresAt: number }>();
  const settingsOf = perUser<unknown>();
  const rowsOf = perUser<PendingRow<unknown>>();
  let token: string | null = opts.token ?? "memory-token";
  let seq = 0;
  let invalidations = 0;

  const cache: CacheStore = {
    async get<T>(key: string) {
      const e = cacheOf().get(key);
      return e && e.expiresAt > Date.now() ? { value: structuredClone(e.value) as T, fetchedAt: e.fetchedAt } : null;
    },
    async put(key, type, value, ttl) { cacheOf().set(key, { type, value: structuredClone(value), fetchedAt: Date.now(), expiresAt: Date.now() + ttl }); },
    async invalidateType(type) { for (const [k, v] of cacheOf()) if (v.type === type) cacheOf().delete(k); },
    async clear() { cacheOf().clear(); },
  };
  const settings: SettingsStore = {
    async get<T>(key: string) { return settingsOf().has(key) ? (structuredClone(settingsOf().get(key)) as T) : undefined; },
    async put(key, value) { settingsOf().set(key, structuredClone(value)); },
  };
  const pending: PendingStore = {
    async enqueue(entry, startTime, label, error) {
      const id = `p${++seq}`;
      rowsOf().set(id, { id, entry, startTime, label, attempts: 1, lastError: error, failed: false, createdAt: Date.now(), nextAttemptAt: Date.now() + 60_000 });
      return id;
    },
    async list<T>() { return [...rowsOf().values()] as PendingRow<T>[]; },
    async due<T>(now = Date.now()) { return [...rowsOf().values()].filter((r) => !r.failed && r.nextAttemptAt <= now) as PendingRow<T>[]; },
    async remove(id) { return rowsOf().delete(id); },
    async markAttempt(id, error, permanent, attempts) {
      const r = rowsOf().get(id);
      if (r) Object.assign(r, { attempts, lastError: error, failed: permanent, nextAttemptAt: Date.now() + 60_000 });
    },
    async makeDueNow(includeFailed) { for (const r of rowsOf().values()) { r.nextAttemptAt = 0; if (includeFailed) r.failed = false; } },
  };
  const platform: Platform = {
    fetch: (...args) => globalThis.fetch(...args),
    async getAccessToken() {
      if (!token) throw new (await import("../../core/errors.js")).ReauthRequiredError("Not signed in");
      return token;
    },
    async invalidateAccessToken() { invalidations++; },
    clientId: () => opts.clientId ?? "123456789012-testclientid.apps.googleusercontent.com",
    cache, settings, pending,
    off: { query: { app_name: "HealthTracker", app_version: "test" } },
    log: { info() {}, warn() {} },
  };
  return {
    platform,
    get settingsMap() { return settingsOf(); },
    get rows() { return rowsOf(); },
    get invalidations() { return invalidations; },
    /** Act as this account from now on (its own settings, queue and cache). */
    signIn(email = "tester@example.com", accessToken = opts.token ?? "memory-token") { user = email; token = accessToken; },
    signOut: () => { token = null; },
  };
}
