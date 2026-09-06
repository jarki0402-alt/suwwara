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

// Home sections mirror YT Music's own curated home page (trending, quick picks,
// genre/mood shelves) — refreshed by YouTube on their own cadence, so a several-hour
// cache here still stays meaningfully current without re-fetching on every request.
const CACHE_TTL_MS = 3 * 60 * 60 * 1000;
// A shelf that turns out to be mostly albums/playlists/artists (nothing directly
// playable) isn't worth showing — those content types don't map onto this app's
// single-song queue model.
const MIN_SONGS_PER_SECTION = 4;

let cache: CacheEntry | null = null;

function bestThumbnail(thumbnails: { url: string; width: number }[]): string {
  if (thumbnails.length === 0) return '';
  return thumbnails.reduce((best, current) => (current.width > best.width ? current : best)).url;
}

/**
 * YouTube Music's own curated home shelves — genuinely refreshed by them, unlike the
 * fixed seed queries trending.ts used to rely on exclusively. Each section keeps its
 * own title (e.g. "Trending now", a mood/genre shelf) so the frontend can render them
 * as separate discovery rows instead of one flat merged list.
 */
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
