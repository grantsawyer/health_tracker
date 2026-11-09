import type { ScopeKey } from "./types.js";

/** Google Health OAuth scopes, shared by the server sign-in and (later) the browser sign-in. */
export const SCOPE_PREFIX = "https://www.googleapis.com/auth/googlehealth.";

/** Google Health scopes this app requests. Write scopes do NOT grant read access. */
export const HEALTH_SCOPES: { key: ScopeKey; label: string }[] = [
  { key: "activity_and_fitness.readonly", label: "Read activity & fitness" },
  { key: "sleep.readonly", label: "Read sleep" },
  { key: "nutrition.readonly", label: "Read nutrition" },
  { key: "nutrition.writeonly", label: "Log food (write nutrition)" },
  { key: "health_metrics_and_measurements.readonly", label: "Read health metrics (weight, heart rate…)" },
  { key: "profile.readonly", label: "Read profile" },
];

export const fullScope = (key: ScopeKey) => SCOPE_PREFIX + key;

/** openid + email only so the UI can show which Google account is connected. */
export const REQUESTED_SCOPES = ["openid", "email", ...HEALTH_SCOPES.map((s) => fullScope(s.key))];

