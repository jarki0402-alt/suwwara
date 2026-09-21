import { useSettingsStore } from '../stores/settingsStore';
import { resolveAudioUrl } from './bitrateResolver';
import { planEviction, type CacheLimits, type CacheRecord } from './cachePolicy';

const isIOS = typeof navigator !== 'undefined' && (/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));

const DB_NAME = 'suwwara-audio-cache';
const DB_VERSION = 2;
const STORE_NAME = 'tracks';
const TIMESTAMP_INDEX = 'timestamp';
// ~4MB per track at the high tier. The size budget and the retention window are the user's (Pengaturan → Penyimpanan);
// this is only a ceiling on the NUMBER of entries, so the key list the eviction pass walks stays small.
const MAX_ENTRIES = 600;
// Retention is also enforced once per launch, a little after start, so expired tracks go even if nothing new is downloaded.
const STARTUP_SWEEP_DELAY_MS = 20_000;
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
  /** Last play (or the download, if never played) — what both the LRU budget and the retention window go by. */
  timestamp: number;
  /** Blob size, so usage can be summed without touching the blob. Absent on entries saved before this existed. */
  size?: number;
}

function currentLimits(): CacheLimits {
  const { audioCacheMB, audioCacheDays } = useSettingsStore.getState();
  return {
    maxBytes: audioCacheMB * 1024 * 1024,
    maxAgeMs: audioCacheDays > 0 ? audioCacheDays * 24 * 60 * 60 * 1000 : Infinity,
    maxEntries: MAX_ENTRIES,
  };
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
    setTimeout(() => void this.enforceLimits(), STARTUP_SWEEP_DELAY_MS);
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
        tx.objectStore(STORE_NAME).put({ id, blob, timestamp: Date.now(), size: blob.size } satisfies AudioEntry);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });

      await this.enforceLimits();
    } catch {
      // Silently swallow errors during background prefetch to not spam the console
    } finally {
      clearTimeout(timeoutId);
    }
  },

  /** Every entry's key, size and last-play time, oldest first. The blobs themselves are never read into memory. */
  async listRecords(): Promise<CacheRecord[]> {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const records: CacheRecord[] = [];
      const request = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).index(TIMESTAMP_INDEX).openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return resolve(records);
        const entry = cursor.value as AudioEntry;
        records.push({ key: entry.id, size: entry.size ?? entry.blob.size, timestamp: entry.timestamp });
        cursor.continue();
      };
      request.onerror = () => reject(request.error);
    });
  },

  /** What is stored right now, for Pengaturan. */
  async usage(): Promise<{ count: number; bytes: number } | null> {
    if (isIOS) return null;
    try {
      const records = await this.listRecords();
      return { count: records.length, bytes: records.reduce((sum, record) => sum + record.size, 0) };
    } catch {
      return null;
    }
  },

  // One pass at a time: a download finishing while the user is changing the limit must not run two overlapping deletes.
  enforcing: null as Promise<void> | null,

  /** Applies the user's size budget and retention window (see cachePolicy.ts). Best-effort; the next pass retries. */
  enforceLimits(): Promise<void> {
    if (isIOS) return Promise.resolve();
    if (this.enforcing) return this.enforcing;
    const pass = (async () => {
      try {
        const doomed = planEviction(await this.listRecords(), currentLimits(), Date.now());
        if (doomed.length === 0) return;
        const db = await getDB();
        const store = db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME);
        for (const key of doomed) store.delete(key);
      } catch {
        // eviction is best-effort
      }
    })().finally(() => {
      this.enforcing = null;
    });
    this.enforcing = pass;
    return pass;
  },

  /** Removes every stored track ("Bersihkan Cache"). A track that is playing right now keeps playing: its blob URL holds its own reference. */
  async clear(): Promise<void> {
    if (isIOS) return;
    try {
      const db = await getDB();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).clear();
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
    } catch {
      // nothing to clear, or storage blocked
    }
  },
};
