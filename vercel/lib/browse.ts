import type { SearchSong } from './search';
import { cleanTitle } from './textClean';
import { getYTMusic } from './ytmusic';

export interface BrowseSection {
  title: string;
  songs: SearchSong[];
}

interface CacheEntry {
  sections: BrowseSection[];
  expiresAt: number;
}

const CACHE_TTL_MS = 3 * 60 * 60 * 1000;
const MIN_SONGS_PER_SECTION = 4;

let cache: CacheEntry | null = null;

function bestThumbnail(thumbnails: { url: string; width: number }[]): string {
  if (thumbnails.length === 0) return '';
  return thumbnails.reduce((best, current) => (current.width > best.width ? current : best)).url;
}

/** Ported as-is from server/src/youtube/browse.ts. */
export async function getBrowseSections(): Promise<BrowseSection[]> {
  if (cache && cache.expiresAt > Date.now()) return cache.sections;

  const ytmusic = await getYTMusic();
  const rawSections = await ytmusic.getHomeSections();

  const sections: BrowseSection[] = [];
  for (const section of rawSections) {
    const songs: SearchSong[] = [];
    for (const item of section.contents) {
      if (item.type !== 'SONG') continue;
      songs.push({
        id: item.videoId,
        title: cleanTitle(item.name),
        artist: item.artist?.name || 'Unknown Artist',
        durationSec: item.duration ?? 0,
        thumbnail: bestThumbnail(item.thumbnails),
        isOfficial: true,
      });
    }
    if (songs.length >= MIN_SONGS_PER_SECTION) sections.push({ title: section.title, songs });
  }

  cache = { sections, expiresAt: Date.now() + CACHE_TTL_MS };
  return sections;
}
