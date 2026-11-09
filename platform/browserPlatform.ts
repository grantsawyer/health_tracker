import type { Platform } from "../core/platform.js";
import type { GisAuth } from "./auth.js";
import { createIdbCache } from "./cache.js";
import { REQUESTED_SCOPES } from "../shared/scopes.js";
import { DRIVE_APPDATA_SCOPE, DriveUnavailableError, createDriveAppData } from "./drive.js";
import { createIdbPending } from "./queue.js";
import { createSyncedSettings, type SyncStatus, type SyncedSettings } from "./settings.js";

/**
 * The browser's core/platform (phase 2 of docs/browser-migration-plan.md):
 * GIS sign-in, IndexedDB cache + retry queue, settings in IndexedDB synced to
 * Drive appData. Phase 3 registers it with configurePlatform() in place of the
 * /api calls.
 */

/**
 * Scopes for the Health token: Google Health + openid/email, nothing else. The Google Health API rejects a token
 * that carries any other scope ("Request contains disallowed OAuth scope(s)", seen live 2026-11-08), so Drive gets
 * its own token (DRIVE_SCOPES) from a second GIS client.
 */
export const browserScopes = () => [...REQUESTED_SCOPES];
export const DRIVE_SCOPES = [DRIVE_APPDATA_SCOPE];

export interface BrowserPlatformOptions {
  clientId: string;
  /** Google Health sign-in (browserScopes()). */
  auth: GisAuth;
  /** Separate Drive sign-in (DRIVE_SCOPES) for settings sync; null = settings stay in this browser. */
  driveAuth: GisAuth | null;
  db: IDBDatabase;
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
  /**
   * Get the Drive token (its own Google pop-up, so call it from a click) and sync. Browsers allow one pop-up per
   * click, and the Health sign-in uses it, so Drive can't be connected in the same click.
   */
  connectDrive(): Promise<SyncStatus>;
}

export function createBrowserPlatform(o: BrowserPlatformOptions): BrowserPlatform {
  const doFetch = o.fetch ?? ((...a: Parameters<typeof fetch>) => globalThis.fetch(...a));
  const userKey = () => o.auth.email() ?? "local";
  const cache = createIdbCache(o.db, userKey, o.now);
  const pending = createIdbPending(o.db, userKey, o.now);
  const driveAuth = o.driveAuth;
  const drive = !driveAuth
    ? null
    : createDriveAppData({
        fetch: doFetch,
        getAccessToken: async () => {
          // Declined on the consent screen: skip the round trip and let settings report "unavailable".
          if (driveAuth.session() && !driveAuth.hasScope(DRIVE_APPDATA_SCOPE)) {
            throw new DriveUnavailableError("Settings sync wasn't allowed on the Google consent screen");
          }
          // Not connected in this tab yet: ReauthRequiredError → settings report "paused" (needs a click).
          return driveAuth.getAccessToken();
        },
        invalidateAccessToken: () => driveAuth.invalidateAccessToken(),
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
    // Browsers can't set User-Agent, and a custom header would force a CORS preflight (which fails whenever OFF is
    // busy), so identify with query parameters. No contact details.
    off: { headers: {}, query: { app_name: "HealthTracker", app_version: o.version }, search: "legacy" },
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
      await o.driveAuth?.signOut();
      await o.auth.signOut();
    },
    connectDrive() {
      // Synchronous up to GIS's requestAccessToken, so it stays inside the click (pop-up permission).
      if (!driveAuth) return Promise.resolve(settings.status());
      return driveAuth.signIn().then(() => settings.sync(), () => settings.sync());
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
