/**
 * A minimal promise layer over IndexedDB, shared by the browser cache, retry
 * queue and settings stores. One database, three object stores; every record
 * carries the signed-in user's key so two Google accounts in the same browser
 * never see each other's data.
 *
 * Only plain keys are used (no IDBKeyRange), so the same code runs on the real
 * browser API and on fake-indexeddb in unit tests.
 */

export const DB_NAME = "health-tracker";
export const DB_VERSION = 1;

export const STORES = {
  /** API response cache: keyPath [user, key]; index byUserType [user, type]; index byUser. */
  cache: "cache",
  /** Retry queue: keyPath id; index byUser. */
  pending: "pending",
  /** Settings (goals, layout, favorites): keyPath [user, key]; index byUser. */
  settings: "settings",
} as const;
export type StoreName = (typeof STORES)[keyof typeof STORES];

/** Open (and on first use, create) the app database. `factory` is injectable for tests. */
export function openDb(factory: IDBFactory = indexedDB, name = DB_NAME): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = factory.open(name, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORES.cache)) {
        const s = db.createObjectStore(STORES.cache, { keyPath: ["user", "key"] });
        s.createIndex("byUserType", ["user", "type"]);
        s.createIndex("byUser", "user");
      }
      if (!db.objectStoreNames.contains(STORES.pending)) {
        const s = db.createObjectStore(STORES.pending, { keyPath: "id" });
        s.createIndex("byUser", "user");
      }
      if (!db.objectStoreNames.contains(STORES.settings)) {
        const s = db.createObjectStore(STORES.settings, { keyPath: ["user", "key"] });
        s.createIndex("byUser", "user");
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("Couldn't open the local database"));
    req.onblocked = () => reject(new Error("The local database is open in an older tab; close other Health Tracker tabs and reload"));
  });
}

/**
 * Run one request in its own transaction and resolve with its result once the
 * transaction commits (so a resolved write is durable).
 */
export function run<T>(
  db: IDBDatabase,
  store: StoreName,
  mode: IDBTransactionMode,
  body: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const req = body(tx.objectStore(store));
    tx.oncomplete = () => resolve(req.result);
    tx.onerror = () => reject(tx.error ?? req.error);
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
  });
}

/** Every record in `index` matching `key` (or the whole store when no index is given). */
export function getAll<T>(db: IDBDatabase, store: StoreName, index?: string, key?: IDBValidKey): Promise<T[]> {
  return run(db, store, "readonly", (s) => (index ? s.index(index).getAll(key) : s.getAll()) as IDBRequest<T[]>);
}

/** Delete every record in `index` matching `key` (optionally only those passing `filter`). Resolves with the count. */
export function deleteWhere<T>(
  db: IDBDatabase,
  store: StoreName,
  index: string,
  key: IDBValidKey,
  filter: (record: T) => boolean = () => true,
): Promise<number> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    let count = 0;
    const cursorReq = tx.objectStore(store).index(index).openCursor(key);
    cursorReq.onsuccess = () => {
      const cursor = cursorReq.result;
      if (!cursor) return;
      if (filter(cursor.value as T)) {
        cursor.delete();
        count++;
      }
      cursor.continue();
    };
    tx.oncomplete = () => resolve(count);
    tx.onerror = () => reject(tx.error ?? cursorReq.error);
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
  });
}

/** Read-modify-write one record atomically. `update` returns the new record, or undefined to leave it unchanged. */
export function updateOne<T>(
  db: IDBDatabase,
  store: StoreName,
  key: IDBValidKey,
  update: (current: T | undefined) => T | undefined,
): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    const s = tx.objectStore(store);
    let result: T | undefined;
    const getReq = s.get(key);
    getReq.onsuccess = () => {
      result = update(getReq.result as T | undefined);
      if (result !== undefined) s.put(result);
    };
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error ?? getReq.error);
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
  });
}
