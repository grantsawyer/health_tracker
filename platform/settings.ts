import type { SettingsStore } from "../core/platform.js";
import { ReauthRequiredError } from "../core/errors.js";
import { DriveUnavailableError, type DriveAppData } from "./drive.js";
import { deleteWhere, getAll, run, STORES } from "./idb.js";

/**
 * Settings (goals, Today layout, favorites) for the signed-in user.
 *
 * The local IndexedDB copy is the one core/ reads and writes, so the app works
 * offline and when Drive is declined. When Drive is available, `sync()` merges
 * the local copy with one `settings.json` in the user's Drive appDataFolder,
 * key by key, latest `updatedAt` wins. That's what lets goals follow the user
 * to another browser or their phone.
 *
 * Known limit (accepted for a few small keys): if two devices sync in the same
 * second, the later upload can drop the other device's newest change to a
 * different key until that device syncs again (it re-uploads because its
 * value is still newer than the file's).
 */

interface SettingRecord {
  user: string;
  key: string;
  value: unknown;
  updatedAt: number;
  /** False until this value has reached Drive. */
  synced: boolean;
}

export interface SettingsFile {
  format: "health-tracker-settings";
  version: 1;
  entries: Record<string, { value: unknown; updatedAt: number }>;
}

export type SyncStatus =
  /** No Drive client (local-only mode chosen) or not signed in yet. */
  | { state: "local"; reason: string }
  /** Drive declined or disabled; local changes are kept. */
  | { state: "unavailable"; reason: string }
  /** A transient failure (offline, 5xx); local changes are kept and retried on the next sync. */
  | { state: "error"; reason: string }
  | { state: "synced"; pulled: number; pushed: number; at: number };

export interface SyncedSettings extends SettingsStore {
  /** Merge with Drive now. Never throws: the outcome is in the returned status. */
  sync(): Promise<SyncStatus>;
  status(): SyncStatus;
  /** Keys changed locally that haven't reached Drive yet. */
  unsyncedKeys(): Promise<string[]>;
  /** Every setting for the signed-in user, for "Export my settings". */
  exportAll(): Promise<Record<string, unknown>>;
  /** Load an export (marks the values as new, so they win the next sync). */
  importAll(values: Record<string, unknown>): Promise<void>;
  /** Remove this browser's copy for the signed-in user (Drive copy untouched). */
  clearLocal(): Promise<number>;
  onChange(listener: (s: SyncStatus) => void): () => void;
}

export interface SettingsDeps {
  db: IDBDatabase;
  userKey: () => string;
  /** null = local-only mode. */
  drive: DriveAppData | null;
  now?: () => number;
  /** Debounce before an automatic sync after put(); 0 disables automatic sync (tests call sync()). */
  autoSyncMs?: number;
}

const isFile = (x: unknown): x is SettingsFile =>
  !!x && typeof x === "object" && (x as SettingsFile).format === "health-tracker-settings" && typeof (x as SettingsFile).entries === "object";

export function createSyncedSettings(deps: SettingsDeps): SyncedSettings {
  const { db, userKey, drive } = deps;
  const now = deps.now ?? Date.now;
  const autoSyncMs = deps.autoSyncMs ?? 1500;
  const listeners = new Set<(s: SyncStatus) => void>();
  let current: SyncStatus = drive ? { state: "local", reason: "Not synced yet" } : { state: "local", reason: "Settings sync is off" };
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inflight: Promise<SyncStatus> | null = null;

  const setStatus = (s: SyncStatus) => {
    current = s;
    for (const l of listeners) l(s);
    return s;
  };
  const records = () => getAll<SettingRecord>(db, STORES.settings, "byUser", userKey());
  const putRecord = (rec: SettingRecord) => run(db, STORES.settings, "readwrite", (s) => s.put(rec));

  const scheduleSync = () => {
    if (!drive || autoSyncMs <= 0) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void api.sync();
    }, autoSyncMs);
  };

  async function doSync(): Promise<SyncStatus> {
    if (!drive) return setStatus({ state: "local", reason: "Settings sync is off" });
    const user = userKey(); // pin the user for the whole merge, even if sign-in changes mid-flight
    try {
      const remote = await drive.read<unknown>();
      const remoteEntries = remote && isFile(remote.doc) ? remote.doc.entries : {};
      const local = new Map((await getAll<SettingRecord>(db, STORES.settings, "byUser", user)).map((r) => [r.key, r]));

      let pulled = 0;
      let pushed = 0;
      const merged: SettingsFile = { format: "health-tracker-settings", version: 1, entries: {} };
      for (const key of new Set([...Object.keys(remoteEntries), ...local.keys()])) {
        const r = remoteEntries[key];
        const l = local.get(key);
        if (r && (!l || r.updatedAt > l.updatedAt)) {
          merged.entries[key] = r;
          await putRecord({ user, key, value: r.value, updatedAt: r.updatedAt, synced: true });
          pulled++;
        } else if (l) {
          merged.entries[key] = { value: l.value, updatedAt: l.updatedAt };
          if (!r || l.updatedAt > r.updatedAt) pushed++;
        }
      }
      if (pushed > 0 || !remote || !isFile(remote.doc)) await drive.write(remote?.id ?? null, merged);
      // Everything now matches the file. Don't flag values changed during the upload (newer updatedAt).
      for (const [key, entry] of Object.entries(merged.entries)) {
        const l = local.get(key);
        if (l && !l.synced && l.updatedAt === entry.updatedAt) {
          const fresh = await run(db, STORES.settings, "readonly", (s) => s.get([user, key]) as IDBRequest<SettingRecord | undefined>);
          if (fresh && fresh.updatedAt === entry.updatedAt) await putRecord({ ...fresh, synced: true });
        }
      }
      return setStatus({ state: "synced", pulled, pushed, at: now() });
    } catch (err) {
      if (err instanceof DriveUnavailableError) return setStatus({ state: "unavailable", reason: err.message });
      if (err instanceof ReauthRequiredError) return setStatus({ state: "local", reason: "Sign in to sync settings" });
      return setStatus({ state: "error", reason: (err as Error).message });
    }
  }

  const api: SyncedSettings = {
    async get<T>(key: string) {
      const rec = await run(db, STORES.settings, "readonly", (s) => s.get([userKey(), key]) as IDBRequest<SettingRecord | undefined>);
      return rec?.value as T | undefined;
    },
    async put(key, value) {
      // Strictly increasing per key, so two saves in the same millisecond still order correctly.
      const prev = await run(db, STORES.settings, "readonly", (s) => s.get([userKey(), key]) as IDBRequest<SettingRecord | undefined>);
      const updatedAt = Math.max(now(), (prev?.updatedAt ?? 0) + 1);
      await putRecord({ user: userKey(), key, value, updatedAt, synced: false });
      scheduleSync();
    },
    sync() {
      // One merge at a time; a sync requested meanwhile reuses the running one's result.
      inflight ??= doSync().finally(() => {
        inflight = null;
      });
      return inflight;
    },
    status: () => current,
    async unsyncedKeys() {
      return (await records()).filter((r) => !r.synced).map((r) => r.key);
    },
    async exportAll() {
      return Object.fromEntries((await records()).map((r) => [r.key, r.value]));
    },
    async importAll(values) {
      for (const [key, value] of Object.entries(values)) await api.put(key, value);
    },
    async clearLocal() {
      return deleteWhere(db, STORES.settings, "byUser", userKey());
    },
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return api;
}
