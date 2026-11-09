import type { PendingRow, PendingStore } from "../core/platform.js";
import { deleteWhere, getAll, run, STORES, updateOne } from "./idb.js";

type PendingRecord = PendingRow<unknown> & { user: string };

/** Same rules as server/appStore.ts: first retry after 1 minute, then 1, 2, 4 … 60 min; at most 20 rows per pass. */
export const FIRST_RETRY_MS = 60_000;
export const MAX_DUE = 20;
export const backoffMs = (attempts: number) => Math.min(60, 2 ** Math.max(0, attempts - 1)) * 60_000;

const strip = <T>({ user: _user, ...row }: PendingRecord) => row as PendingRow<T>;
const byCreated = (a: PendingRecord, b: PendingRecord) => a.createdAt - b.createdAt;

/**
 * The browser's retry queue for food entries Google couldn't accept yet
 * (replaces app.db's pending_writes).
 *
 * One difference from the server: `due()` returns only the signed-in user's
 * rows. In a browser the only token available is that user's, so sending
 * another account's queued entry would log their food into the wrong account.
 */
export function createIdbPending(db: IDBDatabase, userKey: () => string, now: () => number = Date.now): PendingStore & {
  /** Remove every queued row for the signed-in user (used by "forget this device"). */
  clearUser(): Promise<number>;
} {
  const mine = async () => (await getAll<PendingRecord>(db, STORES.pending, "byUser", userKey())).sort(byCreated);

  return {
    async enqueue(entry, startTime, label, error) {
      const id = crypto.randomUUID();
      const t = now();
      const rec: PendingRecord = {
        id, user: userKey(), entry, startTime, label, attempts: 1, lastError: error, failed: false,
        createdAt: t, nextAttemptAt: t + FIRST_RETRY_MS,
      };
      await run(db, STORES.pending, "readwrite", (s) => s.add(rec));
      return id;
    },
    async list<T>() {
      return (await mine()).map((r) => strip<T>(r));
    },
    async due<T>(at = now()) {
      return (await mine()).filter((r) => !r.failed && r.nextAttemptAt <= at).slice(0, MAX_DUE).map((r) => strip<T>(r));
    },
    async remove(id, scoped) {
      const user = userKey();
      let removed = false;
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORES.pending, "readwrite");
        const s = tx.objectStore(STORES.pending);
        const get = s.get(id);
        get.onsuccess = () => {
          const rec = get.result as PendingRecord | undefined;
          if (rec && (!scoped || rec.user === user)) {
            s.delete(id);
            removed = true;
          }
        };
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
      });
      return removed;
    },
    async markAttempt(id, error, permanent, attempts) {
      await updateOne<PendingRecord>(db, STORES.pending, id, (r) =>
        r && { ...r, attempts, lastError: error, failed: permanent, nextAttemptAt: now() + backoffMs(attempts) });
    },
    async makeDueNow(includeFailed) {
      for (const r of await mine()) {
        await updateOne<PendingRecord>(db, STORES.pending, r.id, (cur) =>
          cur && { ...cur, nextAttemptAt: 0, failed: includeFailed ? false : cur.failed });
      }
    },
    async clearUser() {
      return deleteWhere(db, STORES.pending, "byUser", userKey());
    },
  };
}
