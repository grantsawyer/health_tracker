import { config as loadDotenv } from "dotenv";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * All secrets, tokens, and cached health data live here — never in the repo.
 * Override with HEALTH_TRACKER_HOME.
 */
export const HOME_DIR = process.env.HEALTH_TRACKER_HOME ?? join(homedir(), ".health_tracker");

// Everything this server creates (tokens, cache.db + its WAL/SHM files) is owner-only.
process.umask(0o077);

mkdirSync(HOME_DIR, { recursive: true, mode: 0o700 });
chmodSync(HOME_DIR, 0o700);

loadDotenv({ path: join(HOME_DIR, ".env"), quiet: true }); // ENV_FILE (declared below)

export const PORT = Number(process.env.PORT ?? 8787);

/** Where the browser app is served. In dev this is the Vite server; in prod it's this server. */
export const APP_ORIGIN = process.env.APP_ORIGIN ?? `http://localhost:${PORT}`;

/** Must exactly match an Authorized redirect URI on the Google Cloud OAuth client. */
export const REDIRECT_URI = `http://localhost:${PORT}/auth/callback`;

export const ENV_FILE = join(HOME_DIR, ".env");

/** Mutable so the in-app setup screen can save credentials without a restart. */
export const credentials = {
  clientId: process.env.GOOGLE_CLIENT_ID?.trim() ?? "",
  clientSecret: process.env.GOOGLE_CLIENT_SECRET?.trim() ?? "",
};

export const isConfigured = () => credentials.clientId !== "" && credentials.clientSecret !== "";

/** Google web client IDs look like `1234-abc.apps.googleusercontent.com`. */
export { CLIENT_ID_PATTERN } from "../shared/scopes.js";

/**
 * Save credentials to ~/.health_tracker/.env (0600) and apply them immediately.
 * Other lines in the file (e.g. PORT) are preserved.
 */
export function saveCredentials(clientId: string, clientSecret: string): void {
  const keep = existsSync(ENV_FILE)
    ? readFileSync(ENV_FILE, "utf8")
        .split("\n")
        .filter((line) => line.trim() !== "" && !/^\s*GOOGLE_CLIENT_(ID|SECRET)\s*=/.test(line))
    : [];
  const lines = [
    "# Written by Health Tracker's setup screen. Do not commit.",
    ...keep.filter((l) => !l.startsWith("# Written by Health Tracker")),
    `GOOGLE_CLIENT_ID=${clientId}`,
    `GOOGLE_CLIENT_SECRET=${clientSecret}`,
  ];
  writeFileSync(ENV_FILE, lines.join("\n") + "\n", { mode: 0o600 });
  chmodSync(ENV_FILE, 0o600);
  credentials.clientId = clientId;
  credentials.clientSecret = clientSecret;
}

export const TOKEN_FILE = join(HOME_DIR, "token.enc");
export const KEY_FILE = join(HOME_DIR, "token.key");
