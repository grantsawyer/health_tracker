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
`);

export const currentUserKey = () => loadTokens()?.email ?? "local";

// ── Favorites ────────────────────────────────────────────────────────────────
export interface FavoriteRow<T> {
  id: string;
  label: string;
  payload: T;
  createdAt: number;
}

export function listFavorites<T>(userKey: string): FavoriteRow<T>[] {
  const rows = db.prepare("SELECT id, label, payload, created_at FROM favorites WHERE user_key = ? ORDER BY label COLLATE NOCASE").all(userKey) as {
    id: string; label: string; payload: string; created_at: number;
  }[];
  return rows.map((r) => ({ id: r.id, label: r.label, payload: JSON.parse(r.payload) as T, createdAt: r.created_at }));
}

export function addFavorite(userKey: string, label: string, payload: unknown): string {
  const id = randomUUID();
  db.prepare("INSERT INTO favorites (id, user_key, label, payload, created_at) VALUES (?, ?, ?, ?, ?)").run(id, userKey, label, JSON.stringify(payload), Date.now());
  return id;
}

export function deleteFavorite(userKey: string, id: string): boolean {
  return db.prepare("DELETE FROM favorites WHERE id = ? AND user_key = ?").run(id, userKey).changes > 0;
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
