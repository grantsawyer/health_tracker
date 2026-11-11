import type { CacheHit, CacheStore, PendingStore, Platform } from "../../core/platform";
import { configurePlatform } from "../../core/platform";
import type { GisAuth, PublicSession } from "../../platform/auth";
import type { BrowserPlatform } from "../../platform/browserPlatform";
import type { SyncStatus, SyncedSettings } from "../../platform/settings";
import { REQUESTED_SCOPES } from "../../shared/scopes";
import type { Runtime } from "../browser/runtime";
import { DEMO_CLIENT_ID, DEMO_EMAIL } from "./data";
import { createDemoFetch } from "./demoFetch";
import { exitDemo } from "./mode";

/**
 * The demo's runtime: the app's real core/ code on a Platform whose network is
 * the synthetic generator (demoFetch.ts). Already "signed in", no Google sign-in
 * script, no Drive, nothing stored: cache, settings and food changes live in
 * memory and are gone on reload.
 */

/** Generic published references (the same kind of values as the app's defaults), saved so no first-run card shows. */
const DEMO_GOALS = { steps: 10000, activeZoneMinutes: 22, floors: 10, caloriesBurned: 2300, caloriesEaten: 2000, carbsG: 275, fatG: 78, proteinG: 50, exerciseDaysPerWeek: 3, sleepMinutes: 450, bedtime: 23 * 60, wakeTime: 7 * 60 };
const LOCAL: SyncStatus = { state: "local", reason: "In the demo they are kept only until you reload" };

function memoryCache(): CacheStore {
  const rows = new Map<string, { value: unknown; type: string; fetchedAt: number; expires: number }>();
  return {
    async get<T>(key: string): Promise<CacheHit<T> | null> {
      const r = rows.get(key);
      return r && r.expires > Date.now() ? { value: r.value as T, fetchedAt: r.fetchedAt } : null;
    },
    async put(key, type, value, ttlMs) {
      rows.set(key, { value, type, fetchedAt: Date.now(), expires: Date.now() + ttlMs });
    },
    async invalidateType(type) {
      for (const [k, r] of rows) if (r.type === type) rows.delete(k);
    },
    async clear() {
      rows.clear();
    },
  };
}

function memorySettings(): SyncedSettings {
  const values = new Map<string, unknown>([["goals", DEMO_GOALS]]);
  const clone = <T>(v: T): T => (v === undefined ? v : structuredClone(v));
  return {
    async get<T>(key: string) {
      return clone(values.get(key)) as T | undefined;
    },
    async put(key, value) {
      values.set(key, clone(value));
    },
    sync: async () => LOCAL,
    status: () => LOCAL,
    unsyncedKeys: async () => [],
    exportAll: async () => Object.fromEntries([...values].map(([k, v]) => [k, clone(v)])),
    async importAll(all) {
      for (const [k, v] of Object.entries(all)) values.set(k, clone(v));
    },
    async clearLocal() {
      const n = values.size;
      values.clear();
      return n;
    },
    onChange: () => () => {},
  };
}

/** Writes always reach the demo "Google", so nothing is ever queued. */
const noQueue: PendingStore = {
  enqueue: async () => {
    throw new Error("Demo: nothing is queued");
  },
  list: async () => [],
  due: async () => [],
  remove: async () => false,
  markAttempt: async () => {},
  makeDueNow: async () => {},
};

function demoAuth(): GisAuth {
  const session: PublicSession = { email: DEMO_EMAIL, scopes: [...REQUESTED_SCOPES], expiresAt: Number.MAX_SAFE_INTEGER };
  return {
    load: async () => {},
    signIn: async () => session,
    getAccessToken: async () => "demo-token",
    invalidateAccessToken: async () => {},
    session: () => session,
    hasScope: (s) => session.scopes.includes(s),
    email: () => DEMO_EMAIL,
    signOut: async () => exitDemo(),
    onChange: () => () => {},
  };
}

export function createDemoRuntime(): Runtime {
  const auth = demoAuth();
  const settings = memorySettings();
  const cache = memoryCache();
  const platform: Platform = {
    fetch: createDemoFetch(),
    getAccessToken: () => auth.getAccessToken(),
    invalidateAccessToken: () => auth.invalidateAccessToken(),
    clientId: () => DEMO_CLIENT_ID,
    cache,
    settings,
    pending: noQueue,
    off: { query: {} },
    log: { info: () => {}, warn: (m) => console.warn(m) },
  };
  configurePlatform(platform);
  const bp: BrowserPlatform = {
    platform,
    settings,
    userKey: () => DEMO_EMAIL,
    afterSignIn: async () => {},
    signOut: async () => exitDemo(), // "Sign out" and "Forget this device" both leave the demo
    connectDrive: async () => LOCAL,
  };
  return { clientId: DEMO_CLIENT_ID, clientIdFromBuild: false, auth, bp, gisError: null, ensureSynced: async () => {}, stop: () => {} };
}
