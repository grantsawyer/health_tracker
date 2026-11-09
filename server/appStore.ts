import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { HOME_DIR } from "./config.js";
import { loadTokens } from "./tokenStore.js";

/**
 * The app's own durable data in ~/.health_tracker/app.db: favorites and the
 * pending-write (retry) queue. Unlike cache.db, this is NOT safe to delete.
 * Rows are keyed by user (the signed-in Google email) so the schema already
 * supports more than one account if the app ever grows past single-user.
 */
const db = new DatabaseSync(join(HOME_DIR, "app.db"));
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS favorites (
    id         TEXT PRIMARY KEY,
    user_key   TEXT NOT NULL,
    label      TEXT NOT NULL,
    payload    TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS favorites_user ON favorites(user_key, created_at);
  CREATE TABLE IF NOT EXISTS pending_writes (
    id              TEXT PRIMARY KEY,
    user_key        TEXT NOT NULL,
    entry           TEXT NOT NULL,
    start_time      TEXT NOT NULL,
    label           TEXT NOT NULL,
    attempts        INTEGER NOT NULL DEFAULT 0,
    last_error      TEXT,
    failed          INTEGER NOT NULL DEFAULT 0,
    created_at      INTEGER NOT NULL,
    next_attempt_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS pending_due ON pending_writes(failed, next_attempt_at);
  CREATE TABLE IF NOT EXISTS user_settings (
    user_key   TEXT NOT NULL,
    key        TEXT NOT NULL,
    value      TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (user_key, key)
  );
`);

export const currentUserKey = () => loadTokens()?.email ?? "local";

// ── Legacy favorites table ───────────────────────────────────────────────────
// Favorites now live in user_settings ("favorites"), the same shape the browser
// build uses. This read-only accessor exists only for the one-time migration in
// server/platform.ts; the table is no longer written.
export function legacyFavoritesByUser(): Map<string, { id: string; label: string; payload: unknown; createdAt: number }[]> {
  const rows = db.prepare("SELECT id, user_key, label, payload, created_at FROM favorites ORDER BY created_at").all() as {
    id: string; user_key: string; label: string; payload: string; created_at: number;
  }[];
  const out = new Map<string, { id: string; label: string; payload: unknown; createdAt: number }[]>();
  for (const r of rows) {
    const list = out.get(r.user_key) ?? [];
    list.push({ id: r.id, label: r.label, payload: JSON.parse(r.payload), createdAt: r.created_at });
    out.set(r.user_key, list);
  }
  return out;
}

// ── Pending writes (retry queue) ─────────────────────────────────────────────
export interface PendingRow<T> {
  id: string;
  userKey: string;
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

type RawPending = {
  id: string; user_key: string; entry: string; start_time: string; label: string; attempts: number;
  last_error: string | null; failed: number; created_at: number; next_attempt_at: number;
};
const toPending = <T>(r: RawPending): PendingRow<T> => ({
  id: r.id, userKey: r.user_key, entry: JSON.parse(r.entry) as T, startTime: r.start_time, label: r.label,
  attempts: r.attempts, lastError: r.last_error ?? undefined, failed: r.failed === 1, createdAt: r.created_at, nextAttemptAt: r.next_attempt_at,
});

export function enqueuePending(userKey: string, entry: unknown, startTime: string, label: string, error: string): string {
  const id = randomUUID();
  const now = Date.now();
  db.prepare(
    "INSERT INTO pending_writes (id, user_key, entry, start_time, label, attempts, last_error, created_at, next_attempt_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)",
  ).run(id, userKey, JSON.stringify(entry), startTime, label, error, now, now + 60_000);
  return id;
}

export function listPending<T>(userKey: string): PendingRow<T>[] {
  return (db.prepare("SELECT * FROM pending_writes WHERE user_key = ? ORDER BY created_at").all(userKey) as RawPending[]).map((r) => toPending<T>(r));
}

export function duePending<T>(now = Date.now()): PendingRow<T>[] {
  return (db.prepare("SELECT * FROM pending_writes WHERE failed = 0 AND next_attempt_at <= ? ORDER BY created_at LIMIT 20").all(now) as RawPending[]).map((r) => toPending<T>(r));
}

export function removePending(id: string, userKey?: string): boolean {
  const res = userKey
    ? db.prepare("DELETE FROM pending_writes WHERE id = ? AND user_key = ?").run(id, userKey)
    : db.prepare("DELETE FROM pending_writes WHERE id = ?").run(id);
  return res.changes > 0;
}

/** Record a failed attempt. Transient failures back off (1, 2, 4 … 60 min); permanent ones stop retrying. */
export function markAttempt(id: string, error: string, permanent: boolean, attempts: number): void {
  const backoffMin = Math.min(60, 2 ** Math.max(0, attempts - 1));
  db.prepare("UPDATE pending_writes SET attempts = ?, last_error = ?, failed = ?, next_attempt_at = ? WHERE id = ?")
    .run(attempts, error, permanent ? 1 : 0, Date.now() + backoffMin * 60_000, id);
}

/** Make every non-failed entry (or all, including failed) for a user due now. */
export function makeDueNow(userKey: string, includeFailed: boolean): void {
  db.prepare(`UPDATE pending_writes SET next_attempt_at = 0${includeFailed ? ", failed = 0" : ""} WHERE user_key = ?`).run(userKey);
}

// ── Per-user settings (e.g. goals) ───────────────────────────────────────────
export function getSetting<T>(userKey: string, key: string): T | undefined {
  const row = db.prepare("SELECT value FROM user_settings WHERE user_key = ? AND key = ?").get(userKey, key) as { value: string } | undefined;
  return row ? (JSON.parse(row.value) as T) : undefined;
}

export function putSetting(userKey: string, key: string, value: unknown): void {
  db.prepare("INSERT OR REPLACE INTO user_settings (user_key, key, value, updated_at) VALUES (?, ?, ?, ?)").run(userKey, key, JSON.stringify(value), Date.now());
}
