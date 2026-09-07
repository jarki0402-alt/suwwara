import YouTube from 'youtube-sr';
import { cleanChannelName, cleanTitle } from './textClean';

export interface SongDetails {
  id: string;
  title: string;
  artist: string;
  album: string | null;
  durationSec: number;
  thumbnail: string;
}

interface CacheEntry {
  details: SongDetails;
  expiresAt: number;
}

const CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const cache = new Map<string, CacheEntry>();

/** Ported as-is from server/src/youtube/details.ts. */
export async function getSongDetails(videoId: string): Promise<SongDetails> {
  const cached = cache.get(videoId);
  if (cached && cached.expiresAt > Date.now()) return cached.details;

  const video = await YouTube.getVideo(`https://www.youtube.com/watch?v=${videoId}`);
  const musicInfo = video.music?.[0];
  const rawChannelName = video.channel?.name ?? 'Unknown Artist';

  const details: SongDetails = {
    id: videoId,
    title: musicInfo?.title || cleanTitle(video.title ?? 'Untitled'),
    artist: musicInfo?.artist || cleanChannelName(rawChannelName),
    album: musicInfo?.album || null,
    durationSec: Math.round((video.duration ?? 0) / 1000),
    thumbnail: musicInfo?.cover || video.thumbnail?.url || '',
  };

  cache.set(videoId, { details, expiresAt: Date.now() + CACHE_TTL_MS });
  return details;
}
