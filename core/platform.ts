/**
 * Everything the core logic needs from its host, behind small interfaces.
 *
 * core/ never touches the file system, process.env or the DOM. The browser
 * registers IndexedDB / Google Drive / GIS implementations (platform/), the demo
 * an in-memory one (src/demo/), and unit tests theirs (tests/helpers/). All
 * storage is async so IndexedDB fits.
 */

export interface CacheHit<T> {
  value: T;
  fetchedAt: number;
}

/** Response cache. Keys are namespaced by data type so a write can invalidate just that type. */
export interface CacheStore {
  get<T>(key: string): Promise<CacheHit<T> | null>;
  put(key: string, dataType: string, value: unknown, ttlMs: number): Promise<void>;
  invalidateType(dataType: string): Promise<void>;
  clear(): Promise<void>;
}

/** Small JSON settings for the signed-in user (goals, Today layout, favorites). */
export interface SettingsStore {
  get<T>(key: string): Promise<T | undefined>;
  put(key: string, value: unknown): Promise<void>;
}

export interface PendingRow<T> {
  id: string;
  entry: T;
  /** Exact interval.startTime sent to Google; used to detect an earlier attempt that actually succeeded. */
  startTime: string;
  label: string;
  attempts: number;
  lastError?: string;
  failed: boolean;
  createdAt: number;
  nextAttemptAt: number;
}

/** Food entries Google couldn't accept yet, for the signed-in user. */
export interface PendingStore {
  enqueue(entry: unknown, startTime: string, label: string, error: string): Promise<string>;
  list<T>(): Promise<PendingRow<T>[]>;
  /** Due rows across the store (the retry loop runs for whoever is signed in). */
  due<T>(now?: number): Promise<PendingRow<T>[]>;
  /** `scoped` limits removal to the signed-in user's rows (user actions); the retry loop removes any. */
  remove(id: string, scoped: boolean): Promise<boolean>;
  markAttempt(id: string, error: string, permanent: boolean, attempts: number): Promise<void>;
  makeDueNow(includeFailed: boolean): Promise<void>;
}

export interface OffConfig {
  /**
   * Identifies the app (OFF's API policy asks for it). Browsers can't set `User-Agent`, and any custom header
   * (X-User-Agent) forces a CORS preflight, so the app sends `app_name` / `app_version` query parameters and keeps
   * requests "simple" (one GET, no preflight).
   */
  query: Record<string, string>;
}

export interface Platform {
  /** Network access (Google Health, Open Food Facts). */
  fetch: typeof fetch;
  /** A valid access token, refreshing if needed. Throws ReauthRequiredError when there's no usable sign-in. */
  getAccessToken(): Promise<string>;
  /** Called after a 401 so the next getAccessToken() fetches a fresh token. */
  invalidateAccessToken(): Promise<void>;
  /** This app's OAuth client ID: entries written with it are the ones the app may edit. */
  clientId(): string;
  cache: CacheStore;
  settings: SettingsStore;
  pending: PendingStore;
  /** How this host talks to Open Food Facts (see core/openFoodFacts.ts). */
  off: OffConfig;
  log: { info(msg: string): void; warn(msg: string): void };
}

let current: Platform | null = null;

/** Register the host's implementations. Call once at startup (tests may re-register). */
export function configurePlatform(p: Platform): void {
  current = p;
}

export function platform(): Platform {
  if (!current) throw new Error("core platform not configured: call configurePlatform() at startup");
  return current;
}
