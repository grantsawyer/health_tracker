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

/** Values the in-app setup screen shows for copying into Google Cloud Console. */
export interface SetupInfo {
  configured: boolean;
  /** Tail of the saved client ID, so the user can tell which one is in use. */
  clientIdHint?: string;
  redirectUri: string;
  javascriptOrigin: string;
  /** Google Health scopes to add on the consent screen's Data Access page. */
  scopes: string[];
  envFile: string;
}
