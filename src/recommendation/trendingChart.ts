import { apiGet } from '../api/musicClient';
import { mapBackendSongs, type BackendSong } from '../api/mappers';
import type { Song } from '../api/types';

const CACHE_TTL_MS = 30 * 60 * 1000;
let cache: { songs: Song[]; fetchedAt: number } | null = null;

/** Home "Top Chart" section — backed by our backend's global (non-region-specific) trending seed searches. */
export async function getTrendingSongs(limit = 20): Promise<Song[]> {
  const now = Date.now();
  if (cache && now - cache.fetchedAt < CACHE_TTL_MS) {
    return cache.songs.slice(0, limit);
  }

  const data = await apiGet<{ songs: BackendSong[] }>('/api/trending');
  const songs = mapBackendSongs(data.songs);
  cache = { songs, fetchedAt: now };
  return songs.slice(0, limit);
}

let cacheId: { songs: Song[]; fetchedAt: number } | null = null;

/** "Lagi Viral di Indonesia" section — backed by a separate, Indonesia-region YT Music client on the backend (see server/src/youtube/trendingId.ts), not just Indonesian keywords against the global chart. */
export async function getTrendingSongsIndonesia(limit = 20): Promise<Song[]> {
  const now = Date.now();
  if (cacheId && now - cacheId.fetchedAt < CACHE_TTL_MS) {
    return cacheId.songs.slice(0, limit);
  }

  const data = await apiGet<{ songs: BackendSong[] }>('/api/trending/id');
  const songs = mapBackendSongs(data.songs);
  cacheId = { songs, fetchedAt: now };
  return songs.slice(0, limit);
}
