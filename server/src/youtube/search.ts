import { BoundedTtlCache } from './boundedCache';
import { cleanTitle } from './textClean';
import { getYTMusic } from './ytmusic';

export interface SearchSong {
  id: string;
  title: string;
  artist: string;
  /** YouTube Music's own artist id (`UC…`) when the source provides it — what an artist page is keyed by. */
  artistId?: string | null;
  durationSec: number;
  thumbnail: string;
  isOfficial: boolean;
  /** The release it is on, when the source says (album pages are keyed by `albumId`, `MPREb_…`). */
  album?: string | null;
  albumId?: string | null;
}

const MAX_DURATION_SEC = 15 * 60;

export function bestThumbnail(thumbnails: { url: string; width: number }[] | undefined): string {
  if (!thumbnails || thumbnails.length === 0) return '';
  return thumbnails.reduce((best, current) => (current.width > best.width ? current : best)).url;
}

/**
 * Searches YouTube Music's own catalog (not generic youtube.com) — every
 * result here is a real song/track YT Music itself indexes, which is what
 * keeps random non-music videos (vlogs, reactions, fancams) out of results
 * without needing manual title/channel heuristics like the old
 * youtube-sr-based implementation required.
 */
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
      artistId: song.artist?.artistId ?? null,
      durationSec,
      thumbnail: bestThumbnail(song.thumbnails),
      album: song.album?.name ?? null,
      albumId: song.album?.albumId ?? null,
      // Every result from YT Music's "songs" search is catalog content by
      // definition (as opposed to arbitrary uploads), so this is always true
      // here — kept as a field since the app's Song mapping still reads it.
      isOfficial: true,
    });

    if (songs.length >= limit) break;
  }

  return songs;
}

/** YT Music's own query-completion suggestions (autocomplete-as-you-type), distinct
 * from a user's own recent-searches history (kept client-side, not this). */
export async function getSearchSuggestions(query: string): Promise<string[]> {
  const trimmed = query.trim();
  if (trimmed.length === 0) return [];

  const ytmusic = await getYTMusic();
  return ytmusic.getSearchSuggestions(trimmed);
}

export interface ArtistHit {
  artistId: string;
  name: string;
  thumbnail: string;
}

// Keyed by the lowercased query: the desktop search box asks on every debounced pause, and the same
// few artist names get typed over and over. Hard cap + short TTL (CLAUDE.md rule #1).
const artistSearches = new BoundedTtlCache<ArtistHit[]>(200, 30 * 60 * 1000);

/** Artists matching a query — lets search offer "open the profile" when the query is really a person, not a song. */
export async function searchArtists(query: string, limit = 3): Promise<ArtistHit[]> {
  const trimmed = query.trim();
  if (trimmed.length === 0 || trimmed.length > 120) return [];

  const hits = await artistSearches.getOrLoad(trimmed.toLowerCase(), async () => {
    const ytmusic = await getYTMusic();
    const results = await ytmusic.searchArtists(trimmed);
    return results
      .filter((artist) => artist.artistId && artist.name)
      .slice(0, 5)
      .map((artist) => ({ artistId: artist.artistId, name: artist.name, thumbnail: bestThumbnail(artist.thumbnails) }));
  });
  return hits.slice(0, limit);
}
