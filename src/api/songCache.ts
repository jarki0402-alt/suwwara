import type { Song } from './types';

const STORAGE_KEY = 'suwwara-song-cache';
const MAX_ENTRIES = 300;

/**
 * A small persisted id -> Song cache. History only stores songId/artistIds
 * (kept intentionally tiny), so this is what lets "Recently Played" and the
 * recommendation engine's history-derived candidates render full song data
 * (art, artist, duration) without an extra network round trip.
 */
function loadCache(): Map<string, Song> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Map();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Map();
    return new Map(parsed as [string, Song][]);
  } catch {
    return new Map();
  }
}

function saveCache(cache: Map<string, Song>): void {
  try {
    const entries = [...cache.entries()].slice(-MAX_ENTRIES);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // storage unavailable/full — cache degrades to in-memory-only for this session
  }
}

export function cacheSongs(songs: Song[]): void {
  if (songs.length === 0) return;
  const cache = loadCache();
  for (const song of songs) {
    cache.delete(song.id);
    cache.set(song.id, song);
  }
  saveCache(cache);
}

export function getCachedSong(id: string): Song | null {
  return loadCache().get(id) ?? null;
}

export function getCachedSongs(ids: string[]): Song[] {
  const cache = loadCache();
  return ids.map((id) => cache.get(id)).filter((song): song is Song => song !== undefined);
}
