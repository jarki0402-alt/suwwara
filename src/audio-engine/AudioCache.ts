import { resolveAudioUrl } from './bitrateResolver';

const isIOS = typeof navigator !== 'undefined' && (/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));

const DB_NAME = 'suwwara-audio-cache';
const DB_VERSION = 2;
const STORE_NAME = 'tracks';
const TIMESTAMP_INDEX = 'timestamp';
// ~3.5MB per track at the app's quality tiers, so 30 entries stays around 100MB —
// comfortably inside what a phone browser will keep without evicting the whole origin.
const MAX_ENTRIES = 30;
// A full-track download that hasn't finished in this long is a dead connection, not a
// slow one — give up so it can't hold the sequential prefetch queue (below) forever.
const PREFETCH_TIMEOUT_MS = 60000;
// Anything smaller than this can't be a real track — an error page that slipped
// through with a 200 must never be cached as audio.
const MIN_VALID_BLOB_BYTES = 16 * 1024;
// get() bumps an entry's LRU timestamp, but that means rewriting the whole blob
// (IndexedDB has no partial update) — so only do it when the stamp is actually stale,
// not on every single play.
const TOUCH_AFTER_MS = 60 * 60 * 1000;

interface AudioEntry {
  id: string; // "songId:quality"
  blob: Blob;
  timestamp: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function getDB(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        const store = db.objectStoreNames.contains(STORE_NAME)
          ? request.transaction!.objectStore(STORE_NAME)
          : db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        // Lets eviction walk entries oldest-first by key alone (openKeyCursor) instead
        // of getAll()-ing every blob into memory just to sort them.
        if (!store.indexNames.contains(TIMESTAMP_INDEX)) store.createIndex(TIMESTAMP_INDEX, TIMESTAMP_INDEX);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    }).catch((error) => {
      dbPromise = null; // don't cache a failure (e.g. storage blocked) — allow a later retry
      throw error;
    });
  }
  return dbPromise;
}

function promisify<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export const AudioCache = {
  /** Whether this browser can play audio back from IndexedDB blobs (everything but iOS). */
  isSupported: !isIOS,

  /** Opens the database ahead of time so the first track change doesn't pay for it. */
  warm(): void {
    if (isIOS) return;
    getDB().catch(() => {});
  },

  async get(songId: string, dataSaver: boolean): Promise<string | null> {
    if (isIOS) return null; // iOS WebKit fails to play blob: URLs reliably. Bypass.

    try {
      const db = await getDB();
      const id = `${songId}:${dataSaver ? 'low' : 'high'}`;
      const entry = await promisify<AudioEntry | undefined>(db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(id));
      if (!entry) return null;

      if (Date.now() - entry.timestamp > TOUCH_AFTER_MS) void this.updateTimestamp(entry);
      return URL.createObjectURL(entry.blob);
    } catch {
      return null;
    }
  },

  async updateTimestamp(entry: AudioEntry): Promise<void> {
    try {
      const db = await getDB();
      db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).put({ ...entry, timestamp: Date.now() });
    } catch {
      // LRU freshness is best-effort
    }
  },

  // Full-track downloads run strictly one at a time. Each one is a whole file
  // proxied through the backend (a 1GB VM that is also running yt-dlp and Chrome),
  // and they used to be fired for several tracks at once every time the queue
  // changed — the burst landed exactly when the user was waiting on the track they
  // just tapped.
  queueTail: Promise.resolve() as Promise<void>,
  inFlight: new Map<string, Promise<void>>(),
  // Entries still worth downloading. A queued download whose track has since dropped
  // out of the upcoming list (the user skipped ahead, the queue was reshuffled) is
  // skipped when its turn comes instead of costing a whole file for nothing.
  wanted: new Set<string>(),

  /** Replaces the set of tracks worth prefetching and queues any that are missing. */
  prefetchTracks(songIds: string[], dataSaver: boolean): void {
    if (isIOS) return;
    const quality = dataSaver ? 'low' : 'high';
    this.wanted = new Set(songIds.map((songId) => `${songId}:${quality}`));
    for (const songId of songIds) void this.prefetchAndCache(songId, dataSaver);
  },

  /** Downloads a track into IndexedDB in the background. Resolves once it's stored
   * (or skipped/failed — errors are swallowed on purpose, it's only an optimization). */
  prefetchAndCache(songId: string, dataSaver: boolean): Promise<void> {
    if (isIOS) return Promise.resolve(); // Do not fill IndexedDB on iOS as we won't use it.

    const id = `${songId}:${dataSaver ? 'low' : 'high'}`;
    const existing = this.inFlight.get(id);
    if (existing) return existing;

    const task = this.queueTail.then(() => this.download(id, songId, dataSaver));
    const tracked = task.finally(() => this.inFlight.delete(id));
    this.inFlight.set(id, tracked);
    this.queueTail = tracked.catch(() => {});
    return tracked;
  },

  async download(id: string, songId: string, dataSaver: boolean): Promise<void> {
    if (!this.wanted.has(id)) return;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), PREFETCH_TIMEOUT_MS);
    try {
      const db = await getDB();
      const already = await promisify(db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).getKey(id));
      if (already !== undefined) return;

      const url = resolveAudioUrl(songId, dataSaver);
      // priority=low keeps this behind the track being played in the backend's resolve queue.
      const response = await fetch(url + (url.includes('?') ? '&' : '?') + 'priority=low', { signal: controller.signal });
      if (!response.ok) return;
      const blob = await response.blob();
      if (blob.size < MIN_VALID_BLOB_BYTES) return;

      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).put({ id, blob, timestamp: Date.now() } satisfies AudioEntry);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });

      await this.enforceMaxEntries();
    } catch {
      // Silently swallow errors during background prefetch to not spam the console
    } finally {
      clearTimeout(timeoutId);
    }
  },

  async enforceMaxEntries(): Promise<void> {
    try {
      const db = await getDB();
      const count = await promisify(db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).count());
      let excess = count - MAX_ENTRIES;
      if (excess <= 0) return;

      // Keys only, oldest first — never loads a blob.
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const cursorRequest = store.index(TIMESTAMP_INDEX).openKeyCursor();
      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result;
        if (!cursor || excess <= 0) return;
        store.delete(cursor.primaryKey);
        excess -= 1;
        cursor.continue();
      };
    } catch {
      // eviction is best-effort; the next prefetch retries it
    }
  },
};
