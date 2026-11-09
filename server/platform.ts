import { cacheClear, cacheGet, cacheInvalidateType, cachePut } from "./cache.js";
import { credentials } from "./config.js";
import { getAccessToken } from "./oauth.js";
import { loadTokens, saveTokens } from "./tokenStore.js";
import {
  currentUserKey, duePending, enqueuePending, getSetting, legacyFavoritesByUser, listPending, makeDueNow, markAttempt,
  putSetting, removePending,
} from "./appStore.js";
import { configurePlatform, type Platform } from "../core/platform.js";

/**
 * The local server's implementation of core/platform: SQLite cache, app.db
 * settings + retry queue (per signed-in user), the encrypted token file, and
 * the OAuth client ID from ~/.health_tracker/.env. Importing this module
 * registers it.
 */
export const serverPlatform: Platform = {
  fetch: (...args) => globalThis.fetch(...args), // looked up per call so tests can swap fetch
  getAccessToken,
  async invalidateAccessToken() {
    const t = loadTokens();
    if (t) saveTokens({ ...t, accessTokenExpiresAt: 0 });
  },
  clientId: () => credentials.clientId,
  cache: {
    get: async (key) => cacheGet(key),
    put: async (key, type, value, ttl) => cachePut(key, type, value, ttl),
    invalidateType: async (type) => cacheInvalidateType(type),
    clear: async () => cacheClear(),
  },
  settings: {
    get: async (key) => getSetting(currentUserKey(), key),
    put: async (key, value) => putSetting(currentUserKey(), key, value),
  },
  pending: {
    enqueue: async (entry, startTime, label, error) => enqueuePending(currentUserKey(), entry, startTime, label, error),
    list: async () => listPending(currentUserKey()),
    due: async (now) => duePending(now),
    remove: async (id, scoped) => removePending(id, scoped ? currentUserKey() : undefined),
    markAttempt: async (id, error, permanent, attempts) => markAttempt(id, error, permanent, attempts),
    makeDueNow: async (includeFailed) => makeDueNow(currentUserKey(), includeFailed),
  },
  get off() {
    return {
      headers: { "User-Agent": `HealthTracker/0.1 (${process.env.OFF_CONTACT?.trim() || "personal non-commercial use"})` },
      search: "searchalicious" as const,
    };
  },
  log: { info: (m) => console.log(m), warn: (m) => console.warn(m) },
};

/** One-time copy of favorites from the old table into each user's settings (skipped once present). */
function migrateLegacyFavorites(): void {
  for (const [userKey, rows] of legacyFavoritesByUser()) {
    if (getSetting(userKey, "favorites") !== undefined) continue;
    putSetting(userKey, "favorites", rows.map((r) => ({ id: r.id, label: r.label, template: r.payload, createdAt: r.createdAt })));
  }
}

configurePlatform(serverPlatform);
migrateLegacyFavorites();
