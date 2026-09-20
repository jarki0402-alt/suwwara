import { resolveAudioUrl } from './bitrateResolver';

const DB_NAME = 'suwwara-audio-cache';
const STORE_NAME = 'tracks';
const MAX_ENTRIES = 50;

interface AudioEntry {
  id: string; // "songId:quality"
  blob: Blob;
  timestamp: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function getDB(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE_NAME)) {
          request.result.createObjectStore(STORE_NAME, { keyPath: 'id' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  return dbPromise;
}

export const AudioCache = {
  async get(songId: string, dataSaver: boolean): Promise<string | null> {
    try {
      const db = await getDB();
      const quality = dataSaver ? 'low' : 'high';
      const id = `${songId}:${quality}`;

      return new Promise((resolve) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const request = store.get(id);

        request.onsuccess = () => {
          if (request.result) {
            // Update timestamp for LRU
            this.updateTimestamp(id, request.result.blob);
            resolve(URL.createObjectURL(request.result.blob));
          } else {
            resolve(null);
          }
        };
        request.onerror = () => resolve(null);
      });
    } catch {
      return null;
    }
  },

  async updateTimestamp(id: string, blob: Blob) {
    try {
      const db = await getDB();
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put({ id, blob, timestamp: Date.now() });
    } catch {}
  },

  // Map to track ongoing fetches to prevent duplicate downloads
  inFlight: new Map<string, Promise<void>>(),

  async prefetchAndCache(songId: string, dataSaver: boolean): Promise<void> {
    const quality = dataSaver ? 'low' : 'high';
    const id = `${songId}:${quality}`;

    if (this.inFlight.has(id)) return this.inFlight.get(id);

    const promise = (async () => {
      try {
        const db = await getDB();
        // Check if already in cache
        const exists = await new Promise<boolean>((resolve) => {
          const tx = db.transaction(STORE_NAME, 'readonly');
          const request = tx.objectStore(STORE_NAME).getKey(id);
          request.onsuccess = () => resolve(request.result !== undefined);
          request.onerror = () => resolve(false);
        });

        if (exists) return;

        // Fetch from network
        const url = resolveAudioUrl(songId, dataSaver);
        // Add priority=low so it yields to manual plays
        const fetchUrl = url + (url.includes('?') ? '&' : '?') + 'priority=low';
        
        const response = await fetch(fetchUrl);
        if (!response.ok) throw new Error(`Fetch failed: ${response.status}`);

        const blob = await response.blob();

        // Store
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction(STORE_NAME, 'readwrite');
          tx.objectStore(STORE_NAME).put({ id, blob, timestamp: Date.now() });
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        });

        await this.enforceMaxEntries();
      } catch (e) {
        // Silently swallow errors during background prefetch to not spam the console
      } finally {
        this.inFlight.delete(id);
      }
    })();

    this.inFlight.set(id, promise);
    return promise;
  },

  async enforceMaxEntries() {
    try {
      const db = await getDB();
      const entries = await new Promise<AudioEntry[]>((resolve) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const request = store.getAll();
        request.onsuccess = () => resolve(request.result);
      });

      if (entries.length > MAX_ENTRIES) {
        entries.sort((a, b) => b.timestamp - a.timestamp); // Descending
        const toDelete = entries.slice(MAX_ENTRIES);

        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        for (const entry of toDelete) {
          store.delete(entry.id);
        }
      }
    } catch {}
  }
};
