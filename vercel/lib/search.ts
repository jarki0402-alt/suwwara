import { cleanTitle } from './textClean';
import { getYTMusic } from './ytmusic';

export interface SearchSong {
  id: string;
  title: string;
  artist: string;
  durationSec: number;
  thumbnail: string;
  isOfficial: boolean;
}

const MAX_DURATION_SEC = 15 * 60;

function bestThumbnail(thumbnails: { url: string; width: number }[] | undefined): string {
  if (!thumbnails || thumbnails.length === 0) return '';
  return thumbnails.reduce((best, current) => (current.width > best.width ? current : best)).url;
}

/** Ported as-is from server/src/youtube/search.ts. */
export async function searchSongs(query: string, limit = 20): Promise<SearchSong[]> {
  const trimmed = query.trim();
  if (trimmed.length === 0) return [];

  const ytmusic = await getYTMusic();
  const results = await ytmusic.searchSongs(trimmed);

  const songs: SearchSong[] = [];
  for (const song of results) {
    if (!song.videoId || !song.name) continue;
    const durationSec = song.duration ?? 0;
    if (durationSec > 0 && durationSec > MAX_DURATION_SEC) continue;

    songs.push({
      id: song.videoId,
      title: cleanTitle(song.name),
      artist: song.artist?.name || 'Unknown Artist',
      durationSec,
      thumbnail: bestThumbnail(song.thumbnails),
      isOfficial: true,
    });

    if (songs.length >= limit) break;
  }

  return songs;
}

export async function getSearchSuggestions(query: string): Promise<string[]> {
  const trimmed = query.trim();
  if (trimmed.length === 0) return [];

  const ytmusic = await getYTMusic();
  return ytmusic.getSearchSuggestions(trimmed);
}
