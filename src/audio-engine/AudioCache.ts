import { downloadManager } from '../downloads/downloadManager';
import { useSettingsStore } from '../stores/settingsStore';
import { resolveAudioUrl } from './bitrateResolver';
import { planEviction, type CacheLimits, type CacheRecord } from './cachePolicy';

const DB_NAME = 'suwwara-audio-cache';
const DB_VERSION = 2;
const STORE_NAME = 'tracks';
const TIMESTAMP_INDEX = 'timestamp';
// A ceiling on the NUMBER of entries (not a user setting) so the key list the eviction pass walks stays small,
// regardless of how the shared quota (settingsStore.offlineQuotaMB) below is split with downloads.
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

/** The `songId` half of an entry's `"songId:quality"` key — video ids never contain ':', so this is exact. */
const baseSongId = (key: string): string => key.split(':')[0];

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
  /** Whether this browser can store audio blobs at all. Used to be hard-`false` on iOS — Safari has a
   * documented history of unreliable blob: URL audio — but that left iPhone/iPad users on a permanently
   * slower/network-only path even after the underlying bug might be long fixed. It's tried here instead,
   * and settingsStore.localAudioEnabled (checked in get() below) is what actually protects a device where
   * it turns out to still fail: AudioEngine flips that off automatically after repeated playback failures. */
  isSupported: typeof indexedDB !== 'undefined',

  /** Opens the database ahead of time so the first track change doesn't pay for it. */
  warm(): void {
    if (!this.isSupported) return;
    getDB().catch(() => {});
    setTimeout(() => void this.enforceLimits(), STARTUP_SWEEP_DELAY_MS);
  },

  async get(songId: string, dataSaver: boolean): Promise<string | null> {
    if (!this.isSupported) return null;
    // A device that has recently shown it can't reliably play blob: audio (AudioEngine records this via
    // recordLocalAudioFailure whenever a cached track fails to become playable) skips the cache entirely —
    // the network URL below always works, so there's no point retrying a path already proven flaky here.
    if (!useSettingsStore.getState().localAudioEnabled) return null;

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
  // The track being listened to right now. Kept out of `wanted` replacement below: the lookahead re-arms on every queue
  // change and would otherwise drop it from the set before its turn in the serial download queue comes.
  keptId: null as string | null,
  activeDownload: null as AbortController | null,

  /**
   * Drops every background download the moment the user picks another track: a tap is the one thing that must never
   * wait behind lookahead work for the backend's CPU and its single resolve slot. The lookahead re-arms itself once
   * the new track is playing (see PREFETCH_SETTLE_MS), so nothing is lost — only reordered behind the tap.
   */
  cancelBackground(): void {
    this.wanted = new Set();
    this.keptId = null;
    this.activeDownload?.abort();
  },

  /**
   * Stores the track that is playing right now, so playing it again later (tomorrow, after the backend's resolve cache
   * expired) starts from disk instead of paying a cold resolve. Only ever called once the user has listened for a while
   * — a track skipped after 3 seconds isn't worth a whole file. The backend still holds the chunks it just served, so
   * this second read is mostly a memory hit there rather than another trip to googlevideo.
   */
  keepPlaying(songId: string, dataSaver: boolean): void {
    if (!this.isSupported || !useSettingsStore.getState().localAudioEnabled) return;
    const id = `${songId}:${dataSaver ? 'low' : 'high'}`;
    this.keptId = id;
    this.wanted.add(id);
    void this.prefetchAndCache(songId, dataSaver);
  },

  /** Replaces the set of tracks worth prefetching and queues any that are missing. */
  prefetchTracks(songIds: string[], dataSaver: boolean): void {
    if (!this.isSupported || !useSettingsStore.getState().localAudioEnabled) return;
    const quality = dataSaver ? 'low' : 'high';
    this.wanted = new Set(songIds.map((songId) => `${songId}:${quality}`));
    if (this.keptId) this.wanted.add(this.keptId);
    for (const songId of songIds) void this.prefetchAndCache(songId, dataSaver);
  },

  /** Downloads a track into IndexedDB in the background. Resolves once it's stored
   * (or skipped/failed — errors are swallowed on purpose, it's only an optimization). */
  prefetchAndCache(songId: string, dataSaver: boolean): Promise<void> {
    // No point filling storage with blobs a device with unreliable local playback won't end up using.
    if (!this.isSupported || !useSettingsStore.getState().localAudioEnabled) return Promise.resolve();

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
    // A song the user deliberately kept ("Unduh untuk Offline") doesn't need a second, opportunistic copy of
    // the same audio taking up the one shared quota too — see the merge note on settingsStore.offlineQuotaMB.
    if (await downloadManager.has(songId)) return;
    const controller = new AbortController();
    this.activeDownload = controller;
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
      if (this.activeDownload === controller) this.activeDownload = null;
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
    if (!this.isSupported) return null;
    try {
      const records = await this.listRecords();
      return { count: records.length, bytes: records.reduce((sum, record) => sum + record.size, 0) };
    } catch {
      return null;
    }
  },

  // One pass at a time: a download finishing while the user is changing the limit must not run two overlapping deletes.
  enforcing: null as Promise<void> | null,

  /**
   * Applies the *shared* "Tersimpan Offline" budget (settingsStore.offlineQuotaMB): downloads get first claim
   * on it (their own admission check in downloadManager.run() already refuses a new one once they alone fill
   * it), so what's left over is all this cache is entitled to. It shrinks on its own as downloads grow, rather
   * than the two competing over two separate numbers. Also applies the user's own retention window
   * (settingsStore.audioCacheDays — their call, independent of whether the quota is even full), and drops any
   * entry that's now redundant because the same song got permanently downloaded since it was cached (regardless
   * of budget or retention — there's no reason to hold the same audio twice). Best-effort; the next pass (a
   * setting change, a new download, the startup sweep) retries.
   */
  enforceLimits(): Promise<void> {
    if (!this.isSupported) return Promise.resolve();
    if (this.enforcing) return this.enforcing;
    const pass = (async () => {
      try {
        const [records, downloads] = await Promise.all([this.listRecords(), downloadManager.list()]);
        const downloadedIds = new Set(downloads.map((entry) => entry.song.id));
        const redundant = records.filter((record) => downloadedIds.has(baseSongId(record.key)));
        const rest = records.filter((record) => !downloadedIds.has(baseSongId(record.key)));

        const downloadedBytes = downloads.reduce((sum, entry) => sum + entry.size, 0);
        const { offlineQuotaMB, audioCacheDays } = useSettingsStore.getState();
        const quotaBytes = offlineQuotaMB * 1024 * 1024;
        const maxAgeMs = audioCacheDays > 0 ? audioCacheDays * 24 * 60 * 60 * 1000 : Infinity;
        const limits: CacheLimits = { maxBytes: Math.max(0, quotaBytes - downloadedBytes), maxAgeMs, maxEntries: MAX_ENTRIES };
        const doomed = new Set([...redundant.map((record) => record.key), ...planEviction(rest, limits, Date.now())]);
        if (doomed.size === 0) return;

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

  /** Removes any opportunistic-cache copies of `songId` (both qualities) — called once a permanent download of
   * the same song lands, so the two don't both hold the same audio against the one shared quota. */
  async forget(songId: string): Promise<void> {
    if (!this.isSupported) return;
    try {
      const db = await getDB();
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(`${songId}:low`);
      tx.objectStore(STORE_NAME).delete(`${songId}:high`);
    } catch {
      // best-effort
    }
  },

  /** Removes every stored track ("Bersihkan Cache"). A track that is playing right now keeps playing: its blob URL holds its own reference. */
  async clear(): Promise<void> {
    if (!this.isSupported) return;
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
