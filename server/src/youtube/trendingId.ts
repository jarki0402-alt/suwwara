import type { SearchSong } from './search';
import { cleanTitle } from './textClean';
import { getYTMusicID } from './ytmusic';

interface CacheEntry {
  songs: SearchSong[];
  expiresAt: number;
}

// Same cadence as browse.ts's own home-shelf cache — refreshed by YouTube
// Music itself on their own schedule, so there's nothing to gain from
// re-fetching more often than this.
const CACHE_TTL_MS = 3 * 60 * 60 * 1000;
const MIN_SONGS_PER_SECTION = 3;
const FAILURE_CACHE_TTL_MS = 5 * 60 * 1000;

let cache: CacheEntry | null = null;

function bestThumbnail(thumbnails: { url: string; width: number }[]): string {
  if (thumbnails.length === 0) return '';
  return thumbnails.reduce((best, current) => (current.width > best.width ? current : best)).url;
}

/**
 * Indonesia-region "Lagi Viral di Indonesia" home section — uses the
 * ID/id-locale YT Music client (getYTMusicID(), a separate singleton from
 * the US/English one every *other* endpoint in this app deliberately forces,
 * see ytmusic.ts's own comment on why) specifically so its home shelves
 * reflect YouTube Music's own idea of what's trending in Indonesia, not a
 * generic/global chart with Indonesian keywords bolted on.
 */
export async function getTrendingSongsIndonesia(): Promise<SearchSong[]> {
  if (cache && cache.expiresAt > Date.now()) return cache.songs;

  const ytmusic = await getYTMusicID();
  let rawSections: Awaited<ReturnType<typeof ytmusic.getHomeSections>>;
  try {
    rawSections = await ytmusic.getHomeSections();
  } catch (error) {
    // Same strict-schema failure as browse.ts: fall back to none, and the route tops up from its keyword searches.
    // eslint-disable-next-line no-console
    console.error(`[trending-id] home sections unavailable: ${(error as Error).name}: ${(error as Error).message.slice(0, 160)}`);
    cache = { songs: [], expiresAt: Date.now() + FAILURE_CACHE_TTL_MS };
    return [];
  }

  const seen = new Set<string>();
  const songs: SearchSong[] = [];

  for (const section of rawSections) {
    const sectionSongs: SearchSong[] = [];
    for (const item of section.contents) {
      // ytmusic-api leaves a null where one item failed its schema check (and logs the ZodError); skip it, keep the rest.
      if (!item || item.type !== 'SONG' || !item.videoId) continue;
      sectionSongs.push({
        id: item.videoId,
        title: cleanTitle(item.name),
        artist: item.artist?.name || 'Unknown Artist',
        artistId: item.artist?.artistId ?? null,
        durationSec: item.duration ?? 0,
        thumbnail: bestThumbnail(item.thumbnails),
        album: item.album?.name ?? null,
        albumId: item.album?.albumId ?? null,
        isOfficial: true,
      });
    }
    // A shelf that's mostly albums/artists (nothing directly playable) isn't
    // worth pulling from — same reasoning as browse.ts's own MIN_SONGS_PER_SECTION.
    if (sectionSongs.length < MIN_SONGS_PER_SECTION) continue;
    for (const song of sectionSongs) {
      if (seen.has(song.id)) continue;
      seen.add(song.id);
      songs.push(song);
    }
  }

  cache = { songs, expiresAt: Date.now() + CACHE_TTL_MS };
  return songs;
}
