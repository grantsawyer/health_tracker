import type { Platform } from "../core/platform.js";
import type { GisAuth } from "./auth.js";
import { createIdbCache } from "./cache.js";
import { REQUESTED_SCOPES } from "../shared/scopes.js";
import { DRIVE_APPDATA_SCOPE, DriveUnavailableError, createDriveAppData } from "./drive.js";
import { createIdbPending } from "./queue.js";
import { createSyncedSettings, type SyncedSettings } from "./settings.js";

/**
 * The browser's core/platform (phase 2 of docs/browser-migration-plan.md):
 * GIS sign-in, IndexedDB cache + retry queue, settings in IndexedDB synced to
 * Drive appData. Phase 3 registers it with configurePlatform() in place of the
 * /api calls.
 */

/** Scopes for the single GIS consent screen: Google Health + openid/email, plus Drive appData when sync is on. */
export const browserScopes = (driveSync = true) => [...REQUESTED_SCOPES, ...(driveSync ? [DRIVE_APPDATA_SCOPE] : [])];

export interface BrowserPlatformOptions {
  clientId: string;
  auth: GisAuth;
  db: IDBDatabase;
  /** Sync settings to Google Drive appData (default true). False = this browser only. */
  driveSync?: boolean;
  /** App version, sent to Open Food Facts as an identifier (no contact details). */
  version: string;
  fetch?: typeof fetch;
  now?: () => number;
  autoSyncMs?: number;
  log?: Platform["log"];
}

export interface BrowserPlatform {
  platform: Platform;
  settings: SyncedSettings;
  /** Records are stored under the signed-in email ("local" before the first sign-in). */
  userKey(): string;
  /** Run after a sign-in: drop expired cache rows, pull settings from Drive. */
  afterSignIn(): Promise<void>;
  /**
   * Sign out: revoke the token and clear this user's cached health data. Queued food entries and the local
   * settings copy are kept unless `forgetDevice` (the UI should warn first when `pending.list()` isn't empty,
   * because a removed entry is never sent).
   */
  signOut(opts?: { forgetDevice?: boolean }): Promise<void>;
}

export function createBrowserPlatform(o: BrowserPlatformOptions): BrowserPlatform {
  const doFetch = o.fetch ?? ((...a: Parameters<typeof fetch>) => globalThis.fetch(...a));
  const userKey = () => o.auth.email() ?? "local";
  const cache = createIdbCache(o.db, userKey, o.now);
  const pending = createIdbPending(o.db, userKey, o.now);
  const drive =
    o.driveSync === false
      ? null
      : createDriveAppData({
          fetch: doFetch,
          getAccessToken: async () => {
            // Without the scope Drive answers 403; skip the round trip and let settings report "unavailable".
            if (o.auth.session() && !o.auth.hasScope(DRIVE_APPDATA_SCOPE)) {
              throw new DriveUnavailableError("Settings sync wasn't allowed on the Google consent screen");
            }
            return o.auth.getAccessToken();
          },
          invalidateAccessToken: () => o.auth.invalidateAccessToken(),
        });
  const settings = createSyncedSettings({ db: o.db, userKey, drive, now: o.now, autoSyncMs: o.autoSyncMs });

  const platform: Platform = {
    fetch: doFetch,
    getAccessToken: () => o.auth.getAccessToken(),
    invalidateAccessToken: () => o.auth.invalidateAccessToken(),
    clientId: () => o.clientId,
    cache,
    settings,
    pending,
    // Browsers can't set User-Agent; phase 3 sends this as X-User-Agent (allowed by OFF's CORS policy).
    offUserAgent: `HealthTracker/${o.version}`,
    log: o.log ?? { info: (m) => console.info(m), warn: (m) => console.warn(m) },
  };

  return {
    platform,
    settings,
    userKey,
    async afterSignIn() {
      await cache.pruneExpired();
      await settings.sync();
    },
    async signOut(opts = {}) {
      await cache.clear();
      if (opts.forgetDevice) {
        await pending.clearUser();
        await settings.clearLocal();
      }
      await o.auth.signOut();
    },
  };
}

/**
 * Run the retry queue while the app is open: now, every `intervalMs`, and when
 * the browser comes back online. A static site has no background process, so
 * queued entries wait while every tab is closed (plan §10). Returns a stop function.
 */
export function startRetryLoop(
  process: () => Promise<unknown>,
  opts: { intervalMs?: number; events?: Pick<EventTarget, "addEventListener" | "removeEventListener">; onError?: (e: unknown) => void } = {},
): () => void {
  const events = opts.events ?? (typeof window === "undefined" ? undefined : window);
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await process();
    } catch (e) {
      opts.onError?.(e); // e.g. not signed in yet: the next tick tries again
    } finally {
      running = false;
    }
  };
  const onOnline = () => void tick();
  void tick();
  const timer = setInterval(tick, opts.intervalMs ?? 60_000);
  events?.addEventListener("online", onOnline);
  return () => {
    clearInterval(timer);
    events?.removeEventListener("online", onOnline);
  };
}
