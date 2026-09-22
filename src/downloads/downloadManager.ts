import type { Song } from '../api/types';
// A static, mutually-circular import with AudioCache.ts (which imports this file too, to skip caching what's
// already downloaded) — safe because both sides only ever touch the other's exports from inside a function
// body, never at module-evaluation time, which is what ES modules' live-binding circular imports require.
// eslint-disable-next-line import/no-cycle
import { AudioCache } from '../audio-engine/AudioCache';
import { resolveAudioUrl } from '../audio-engine/bitrateResolver';
import { useSettingsStore } from '../stores/settingsStore';

const DB_NAME = 'suwwara-downloads';
const DB_VERSION = 1;
const STORE_NAME = 'songs';
// Anything smaller than this can't be a real track — an error page that slipped through with a 200
// must never be kept as a "downloaded" song (same guard AudioCache.ts uses for the opportunistic cache).
const MIN_VALID_BLOB_BYTES = 16 * 1024;
// A stalled download must not sit in the one-at-a-time queue forever and block every download after it.
const DOWNLOAD_TIMEOUT_MS = 60000;

export interface DownloadRecord {
  song: Song;
  size: number;
  downloadedAt: number;
  quality: 'low' | 'high';
}

interface DownloadEntry extends DownloadRecord {
  songId: string;
  blob: Blob;
}

export type DownloadResult = { ok: true } | { ok: false; reason: 'quota' | 'network' | 'unsupported' };

let dbPromise: Promise<IDBDatabase> | null = null;

function getDB(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME, { keyPath: 'songId' });
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

/**
 * Deliberate, user-triggered "keep this song for offline" downloads — a separate IndexedDB store from
 * AudioCache's own opportunistic cache (audio-engine/AudioCache.ts), on purpose: that one evicts whatever
 * wasn't played recently to stay under its budget, which is exactly the behavior a song someone downloaded
 * for a flight must never be subject to. Nothing in here is ever auto-evicted — only an explicit remove()
 * or clearAll() ever deletes a row, and download() itself refuses to add a new one once the user's own
 * quota (Pengaturan → Unduhan offline) is reached.
 */
export const downloadManager = {
  isSupported: typeof indexedDB !== 'undefined',

  // One download at a time — this is a full file proxied through a 1GB VM that also runs yt-dlp and
  // Chrome (bgutil-provider), and the user is usually mid-session when they tap "Unduh", not queuing a
  // whole playlist to fetch in parallel (same reasoning as AudioCache's own prefetch queue).
  queueTail: Promise.resolve() as Promise<void>,
  inFlight: new Map<string, Promise<DownloadResult>>(),

  // Every place that shows "is this downloaded?" (a song's own "⋯" menu, the standalone Now Playing button, a
  // playlist's bulk button, the Koleksi → Diunduh tab) subscribes here instead of only checking once on mount —
  // deleting a song from one of them would otherwise leave the others quietly showing stale state until their
  // component happened to remount.
  listeners: new Set<() => void>(),

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  },

  notify(): void {
    this.listeners.forEach((listener) => listener());
  },

  download(song: Song): Promise<DownloadResult> {
    if (!this.isSupported) return Promise.resolve({ ok: false, reason: 'unsupported' });
    const existing = this.inFlight.get(song.id);
    if (existing) return existing;

    const task = this.queueTail.then(() => this.run(song));
    const tracked = task.finally(() => this.inFlight.delete(song.id));
    this.inFlight.set(song.id, tracked);
    this.queueTail = tracked.then(() => {});
    return tracked;
  },

  async run(song: Song): Promise<DownloadResult> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
    try {
      const db = await getDB();
      const already = await promisify(db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).getKey(song.id));
      if (already !== undefined) return { ok: true }; // already downloaded — nothing to do

      // Downloads get first claim on the shared "Tersimpan Offline" budget (settingsStore.offlineQuotaMB) — the
      // opportunistic cache only ever gets what's left over (see AudioCache.enforceLimits()), so it's never this
      // check's job to make room; a full cache never blocks a deliberate download.
      const quotaBytes = useSettingsStore.getState().offlineQuotaMB * 1024 * 1024;
      if ((await this.usedBytes()) >= quotaBytes) return { ok: false, reason: 'quota' };

      const dataSaver = useSettingsStore.getState().dataSaver;
      const quality: 'low' | 'high' = dataSaver ? 'low' : 'high';
      const response = await fetch(resolveAudioUrl(song.id, dataSaver), { signal: controller.signal });
      if (!response.ok) return { ok: false, reason: 'network' };
      const blob = await response.blob();
      if (blob.size < MIN_VALID_BLOB_BYTES) return { ok: false, reason: 'network' };

      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).put({ songId: song.id, song, blob, size: blob.size, downloadedAt: Date.now(), quality } satisfies DownloadEntry);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });

      // Drops any now-redundant opportunistic copy of the same song and lets the cache immediately shrink to
      // whatever's left of the quota — without this, "Tersimpan Offline" could show this download's bytes
      // twice until the next unrelated cache sweep happened to run.
      await AudioCache.forget(song.id);
      void AudioCache.enforceLimits();
      this.notify();
      return { ok: true };
    } catch {
      return { ok: false, reason: 'network' };
    } finally {
      clearTimeout(timeoutId);
    }
  },

  async remove(songId: string): Promise<void> {
    if (!this.isSupported) return;
    try {
      const db = await getDB();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).delete(songId);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
      this.notify();
    } catch {
      // best-effort
    }
  },

  async has(songId: string): Promise<boolean> {
    if (!this.isSupported) return false;
    try {
      const db = await getDB();
      const key = await promisify(db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).getKey(songId));
      return key !== undefined;
    } catch {
      return false;
    }
  },

  /** A fresh blob: URL to play `songId` from, or null if it was never downloaded. Called on every track
   * load (AudioEngine.localUrlFor), so this stays a single indexed get — no scanning. */
  async getBlobUrl(songId: string): Promise<string | null> {
    if (!this.isSupported) return null;
    try {
      const db = await getDB();
      const entry = await promisify<DownloadEntry | undefined>(db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(songId));
      return entry ? URL.createObjectURL(entry.blob) : null;
    } catch {
      return null;
    }
  },

  /** Every downloaded song's own metadata (not the blob), newest first — for the "Diunduh" list in Pengaturan. */
  async list(): Promise<DownloadRecord[]> {
    if (!this.isSupported) return [];
    try {
      const db = await getDB();
      return await new Promise((resolve, reject) => {
        const records: DownloadRecord[] = [];
        const request = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).openCursor();
        request.onsuccess = () => {
          const cursor = request.result;
          if (!cursor) {
            resolve(records.sort((a, b) => b.downloadedAt - a.downloadedAt));
            return;
          }
          const entry = cursor.value as DownloadEntry;
          records.push({ song: entry.song, size: entry.size, downloadedAt: entry.downloadedAt, quality: entry.quality });
          cursor.continue();
        };
        request.onerror = () => reject(request.error);
      });
    } catch {
      return [];
    }
  },

  async usedBytes(): Promise<number> {
    const records = await this.list();
    return records.reduce((sum, record) => sum + record.size, 0);
  },

  async clearAll(): Promise<void> {
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
      this.notify();
    } catch {
      // nothing to clear, or storage blocked
    }
  },
};
