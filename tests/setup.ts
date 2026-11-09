import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach } from "vitest";

// Must run before any server module is imported: config.ts reads these at import time.
// Each test file gets its own module graph and therefore its own empty data dir.
process.env.HEALTH_TRACKER_HOME = mkdtempSync(join(tmpdir(), "health-tracker-test-"));
process.env.GOOGLE_CLIENT_ID = "123456789012-testclientid.apps.googleusercontent.com";
process.env.GOOGLE_CLIENT_SECRET = "GOCSPX-test-secret-value";
process.env.APP_ORIGIN = "http://localhost:5173";
process.env.PORT = "8787";
delete process.env.OFF_CONTACT;

// Register the server implementation of core/platform (SQLite in the temp dir above).
// Dynamic import: it must run after the env vars are set.
await import("../server/platform.js");

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});
