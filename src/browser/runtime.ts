import { configurePlatform } from "../../core/platform";
import { processPendingWrites } from "../../core/food";
import { createGisAuth, loadGisScript, type GisAuth } from "../../platform/auth";
import { DRIVE_SCOPES, browserScopes, createBrowserPlatform, startRetryLoop, type BrowserPlatform } from "../../platform/browserPlatform";
import { openDb } from "../../platform/idb";
import { CLIENT_ID_PATTERN } from "../../shared/scopes";
import { APP_VERSION } from "../../shared/version";

/**
 * The browser backend's wiring (docs/browser-migration-plan.md §13): one
 * IndexedDB, GIS sign-in, and the browser Platform registered with core/.
 * Created on first use; recreated when the client ID changes.
 */

const CLIENT_ID_KEY = "health-tracker:client-id";
/** How long the first screen waits for Drive settings before showing local ones. */
const FIRST_SYNC_WAIT_MS = 4000;

export interface Runtime {
  clientId: string | null;
  /** True when the client ID ships with the build (VITE_GOOGLE_CLIENT_ID) and none is saved in this browser. */
  clientIdFromBuild: boolean;
  auth: GisAuth | null;
  bp: BrowserPlatform | null;
  /** Set when Google's sign-in script couldn't load (offline, content blocker). */
  gisError: Error | null;
  /** Pull settings from Drive once per signed-in account (bounded wait). */
  ensureSynced(): Promise<void>;
  stop(): void;
}

let dbPromise: Promise<IDBDatabase> | null = null;
let pending: Promise<Runtime> | null = null;
let ready: Runtime | null = null;

function readStored(): string | null {
  try {
    const v = localStorage.getItem(CLIENT_ID_KEY);
    return v && CLIENT_ID_PATTERN.test(v) ? v : null;
  } catch {
    return null;
  }
}

const buildClientId = (): string | null => {
  const v = (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined)?.trim();
  return v && CLIENT_ID_PATTERN.test(v) ? v : null;
};

export function saveClientId(clientId: string): void {
  localStorage.setItem(CLIENT_ID_KEY, clientId);
}

async function create(): Promise<Runtime> {
  const stored = readStored();
  const clientId = stored ?? buildClientId();
  const base = { clientId, clientIdFromBuild: !stored && Boolean(clientId), gisError: null as Error | null };
  if (!clientId) {
    return { ...base, auth: null, bp: null, ensureSynced: async () => {}, stop: () => {} };
  }

  dbPromise ??= openDb();
  const db = await dbPromise;
  // Two token clients: Google Health rejects tokens that carry any other scope, so Drive gets its own.
  const auth = createGisAuth({ clientId, scopes: browserScopes(), gis: () => loadGisScript() });
  const driveAuth = createGisAuth({ clientId, scopes: DRIVE_SCOPES, gis: () => loadGisScript(), storageName: "drive", loginHint: () => auth.email() });
  const bp = createBrowserPlatform({ clientId, auth, driveAuth, db, version: APP_VERSION });
  configurePlatform(bp.platform);
  try {
    await auth.load();
    await driveAuth.load();
  } catch (err) {
    base.gisError = err as Error;
  }
  const stopRetry = startRetryLoop(processPendingWrites, { onError: () => {} }); // not signed in yet: next tick retries

  // One pull per account; concurrent callers (e.g. React's double effect in dev) share it.
  let syncFor: { who: string | null; done: Promise<void> } | null = null;
  return {
    ...base,
    auth,
    bp,
    async ensureSynced() {
      if (!auth.session()) return;
      const who = auth.email() ?? null;
      if (syncFor?.who !== who) syncFor = { who, done: bp.afterSignIn() };
      await Promise.race([syncFor.done, new Promise((r) => setTimeout(r, FIRST_SYNC_WAIT_MS))]);
    },
    stop: stopRetry,
  };
}

/** The runtime, created on first call. */
export function runtime(): Promise<Runtime> {
  pending ??= create().then((r) => (ready = r));
  return pending;
}

/** The runtime if it's ready (sign-in must start synchronously inside a click, so it can't await). */
export const currentRuntime = (): Runtime | null => ready;

/** Drop the runtime (after the client ID changes); the next call recreates it. */
export function resetRuntime(): void {
  ready?.stop();
  ready = null;
  pending = null;
}
