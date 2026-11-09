// Types shared by the server and the browser app.

export type ScopeKey =
  | "activity_and_fitness.readonly"
  | "sleep.readonly"
  | "nutrition.readonly"
  | "nutrition.writeonly"
  | "health_metrics_and_measurements.readonly"
  | "profile.readonly";

export interface ScopeStatus {
  key: ScopeKey;
  label: string;
  granted: boolean;
}

export type ConnectionState =
  /** Client ID / secret missing from ~/.health_tracker/.env */
  | "not_configured"
  /** No stored token: user needs to sign in */
  | "signed_out"
  /** Refresh token rejected (expired after 7 days in Testing mode, or revoked) */
  | "reauth_required"
  /** Signed in, but the Google account isn't linked in the Google Health app */
  | "account_not_linked"
  /** Signed in and linked */
  | "connected"
  /** Unexpected error talking to Google */
  | "error";

export interface StatusResponse {
  state: ConnectionState;
  email?: string;
  healthUserId?: string;
  scopes?: ScopeStatus[];
  /** ISO timestamp when the refresh token is expected to expire, if Google reported it */
  refreshTokenExpiresAt?: string;
  message?: string;
}

/**
 * How the app reaches Google: `browser` (default) calls Google directly with a
 * client ID only; `server` goes through the local Node server (client secret,
 * refresh token), kept as a fallback until migration phase 6.
 */
export type BackendMode = "browser" | "server";

/** Values the in-app setup screen shows for copying into Google Cloud Console. */
export interface SetupInfo {
  mode: BackendMode;
  configured: boolean;
  /** Tail of the saved client ID, so the user can tell which one is in use. */
  clientIdHint?: string;
  /** Browser mode: the full client ID in use (not secret), to prefill the form and check against Google Cloud. */
  clientId?: string;
  /** Server mode: the OAuth redirect URI to register. */
  redirectUri?: string;
  /** The origin to register under "Authorized JavaScript origins" (browser mode). */
  javascriptOrigin: string;
  /** Scopes to add on the consent screen's Data Access page. */
  scopes: string[];
  /** Server mode: where the credentials are saved. */
  envFile?: string;
  /** Browser mode: the client ID ships with this build (VITE_GOOGLE_CLIENT_ID) rather than being saved in this browser. */
  clientIdFromBuild?: boolean;
}

/** Settings sync state (browser mode), for the Account page. */
export type SettingsSyncInfo =
  | { state: "off" }
  | { state: "local" | "paused" | "unavailable" | "error"; reason: string }
  | { state: "synced"; at: string };
