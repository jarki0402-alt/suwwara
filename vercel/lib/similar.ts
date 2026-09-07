import type { SearchSong } from './search';
import { cleanTitle } from './textClean';
import { getYTMusic } from './ytmusic';

interface CacheEntry {
  songs: SearchSong[];
  expiresAt: number;
}

const CACHE_TTL_MS = 60 * 60 * 1000;
const cache = new Map<string, CacheEntry>();

function parseDurationText(text: unknown): number {
  if (typeof text !== 'string') return 0;
  const parts = text.split(':').map((part) => Number.parseInt(part, 10));
  if (parts.some((part) => Number.isNaN(part))) return 0;
  return parts.reduce((total, part) => total * 60 + part, 0);
}

/** Ported as-is from server/src/youtube/similar.ts. */
export async function getSimilarSongs(videoId: string, limit = 20): Promise<SearchSong[]> {
  const cached = cache.get(videoId);
  if (cached && cached.expiresAt > Date.now()) return cached.songs.slice(0, limit);

  const ytmusic = await getYTMusic();
  const upNext = await ytmusic.getUpNexts(videoId);

  const songs: SearchSong[] = [];
  for (const entry of upNext as unknown as Array<{
    type: string;
    videoId: string;
    title: string;
    artists?: unknown;
    duration?: unknown;
    thumbnail?: string;
  }>) {
    if (entry.type !== 'SONG' || !entry.videoId || entry.videoId === videoId) continue;
    const artistName = typeof entry.artists === 'string' ? entry.artists : 'Unknown Artist';
    songs.push({
      id: entry.videoId,
      title: cleanTitle(entry.title),
      artist: artistName,
      durationSec: parseDurationText(entry.duration),
      thumbnail: entry.thumbnail || '',
      isOfficial: true,
    });
  }

  cache.set(videoId, { songs, expiresAt: Date.now() + CACHE_TTL_MS });
  return songs.slice(0, limit);
}
