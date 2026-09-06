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
