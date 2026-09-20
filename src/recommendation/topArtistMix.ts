import { getArtistTopSongs } from '../api/endpoints/artist';
import type { ImageVariant, Song } from '../api/types';
import { useLibraryStore } from '../stores/libraryStore';
import { loadHistory } from './historyLog';
import { computeArtistAffinity } from './scoring';

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
// A shelf on Home (ArtistMixesSection), scrolled sideways — so it can be longer than the old 2-tile grid,
// but every artist costs the backend two YT Music calls, so it still stays small.
const MAX_ARTISTS = 6;
// Fetched a few at a time: the whole shelf firing at once is a burst the backend then has to fan out upstream.
const FETCH_BATCH = 3;

export interface ArtistMix {
  artistName: string;
  /** The artist's own photo when YT Music has one. */
  image: ImageVariant[];
  songs: Song[];
}

let cache: { mixes: ArtistMix[]; fetchedAt: number } | null = null;

/**
 * artistIds in history are literally the artist's display name (see
 * mapBackendSong in mappers.ts — this app has no stable per-artist id, only
 * the name string), so the top-affinity keys from computeArtistAffinity are
 * already names ready to search with. When the history names fewer artists than the shelf holds
 * (a new install, or mostly library use), the artists of liked songs and playlists fill the rest —
 * they are what the user picked on purpose, so they are as good a "who you listen to" signal.
 */
function topArtistNames(limit: number): string[] {
  const history = loadHistory();
  const affinity = computeArtistAffinity(history, Date.now());
  const names = Array.from(affinity.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([artistName]) => artistName);

  const { likedSongs, playlists } = useLibraryStore.getState();
  const libraryCounts = new Map<string, number>();
  for (const song of [...likedSongs, ...playlists.flatMap((playlist) => playlist.songs)]) {
    for (const artist of song.artists.primary) libraryCounts.set(artist.name, (libraryCounts.get(artist.name) ?? 0) + 1);
  }
  names.push(...Array.from(libraryCounts.entries()).sort((a, b) => b[1] - a[1]).map(([artistName]) => artistName));

  const seen = new Set<string>();
  return names
    .filter((name) => {
      const key = name.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, limit);
}

/**
 * "Mix {artist}" cards — one per artist among the user's top listened, shown as a
 * sideways shelf on Home, same as Spotify's own multiple Daily Mix cards. Empty array when there's not enough history
 * yet to name a clear top artist — same honest-empty-state philosophy as
 * weeklyDiscovery.ts.
 */
export async function getTopArtistMixes(): Promise<ArtistMix[]> {
  const now = Date.now();
  if (cache && now - cache.fetchedAt < CACHE_TTL_MS) return cache.mixes;

  const names = topArtistNames(MAX_ARTISTS);
  if (names.length === 0) return [];

  const mixes: ArtistMix[] = [];
  const seenNames = new Set<string>();
  for (let start = 0; start < names.length; start += FETCH_BATCH) {
    const results = await Promise.allSettled(names.slice(start, start + FETCH_BATCH).map((name) => getArtistTopSongs(name)));
    for (const result of results) {
      if (result.status !== 'fulfilled' || !result.value || result.value.songs.length === 0) continue;
      // Two spellings can resolve to the same artist — one card each would look like a bug.
      const key = result.value.artistName.toLowerCase();
      if (seenNames.has(key)) continue;
      seenNames.add(key);
      mixes.push({ artistName: result.value.artistName, image: result.value.image, songs: result.value.songs });
    }
  }

  // An empty result is a failed round of lookups, not an answer worth remembering for six hours.
  if (mixes.length > 0) cache = { mixes, fetchedAt: now };
  return mixes;
}

/** A single artist's mix by exact name — used when opening one specific tile (see useGeneratedCollection.ts), reusing the same cached batch when available instead of re-fetching. */
export async function getArtistMixByName(artistName: string): Promise<ArtistMix | null> {
  if (cache) {
    const found = cache.mixes.find((mix) => mix.artistName === artistName);
    if (found) return found;
  }
  const result = await getArtistTopSongs(artistName);
  if (!result || result.songs.length === 0) return null;
  return result;
}
