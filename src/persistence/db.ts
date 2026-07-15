/**
 * Minimal promise wrapper over raw IndexedDB — no dependencies. Every
 * operation runs inside a single transaction: Safari auto-closes
 * transactions that span an await, so ops never hold one across turns.
 */

const DB_NAME = 'scratchy';
const DB_VERSION = 3;

export const STORE_BOARDS = 'boards';
export const STORE_TAKES = 'takes';
export const STORE_META = 'meta';
/** Imported image/PDF-page bitmaps as Blobs, keyed by asset id (v3). */
export const STORE_ASSETS = 'assets';
/** In-flight/interrupted recording manifests, keyed by sessionId (v2). */
export const STORE_REC_SESSIONS = 'recSessions';
/** Recording chunks, keyed [sessionId, index] so a range read returns them in order (v2). */
export const STORE_REC_CHUNKS = 'recChunks';

let dbPromise: Promise<IDBDatabase> | null = null;

export function idbAvailable(): boolean {
  try {
    return typeof indexedDB !== 'undefined' && indexedDB !== null;
  } catch {
    return false;
  }
}

function open(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_BOARDS)) {
          db.createObjectStore(STORE_BOARDS, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(STORE_TAKES)) {
          db.createObjectStore(STORE_TAKES, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(STORE_META)) {
          db.createObjectStore(STORE_META);
        }
        if (!db.objectStoreNames.contains(STORE_REC_SESSIONS)) {
          db.createObjectStore(STORE_REC_SESSIONS, { keyPath: 'sessionId' });
        }
        if (!db.objectStoreNames.contains(STORE_REC_CHUNKS)) {
          db.createObjectStore(STORE_REC_CHUNKS, { keyPath: ['sessionId', 'index'] });
        }
        if (!db.objectStoreNames.contains(STORE_ASSETS)) {
          db.createObjectStore(STORE_ASSETS, { keyPath: 'id' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
    });
    // Allow a retry on the next call instead of caching the failure forever.
    dbPromise.catch(() => {
      dbPromise = null;
    });
  }
  return dbPromise;
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
  });
}

export async function idbGet<T>(store: string, key: IDBValidKey): Promise<T | undefined> {
  const db = await open();
  return request(db.transaction(store, 'readonly').objectStore(store).get(key));
}

export async function idbGetAll<T>(store: string): Promise<T[]> {
  const db = await open();
  return request(db.transaction(store, 'readonly').objectStore(store).getAll());
}

export async function idbPut(store: string, value: unknown, key?: IDBValidKey): Promise<void> {
  const db = await open();
  await request(db.transaction(store, 'readwrite').objectStore(store).put(value, key));
}

export async function idbDelete(store: string, key: IDBValidKey): Promise<void> {
  const db = await open();
  await request(db.transaction(store, 'readwrite').objectStore(store).delete(key));
}

/** getAll over a key range — results come back in key order. */
export async function idbGetAllRange<T>(store: string, range: IDBKeyRange): Promise<T[]> {
  const db = await open();
  return request(db.transaction(store, 'readonly').objectStore(store).getAll(range));
}

export async function idbDeleteRange(store: string, range: IDBKeyRange): Promise<void> {
  const db = await open();
  await request(db.transaction(store, 'readwrite').objectStore(store).delete(range));
}
