import { getArtistTopSongs } from '../api/endpoints/artist';
import type { Song } from '../api/types';
import { loadHistory } from './historyLog';
import { computeArtistAffinity } from './scoring';

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
// Capped at 2 (not more) so "Dibuat Untukmu" tops out at 4 tiles total —
// weekly-discovery + viral-indonesia + up to 2 artist mixes — short enough to
// fit on mobile without turning into most of a screen's worth of scrolling
// before reaching anything else on Home (see MadeForYouSection's own mobile
// 2-column layout, sized around this same total).
const MAX_ARTISTS = 2;

export interface ArtistMix {
  artistName: string;
  songs: Song[];
}

let cache: { mixes: ArtistMix[]; fetchedAt: number } | null = null;

/**
 * artistIds in history are literally the artist's display name (see
 * mapBackendSong in mappers.ts — this app has no stable per-artist id, only
 * the name string), so the top-affinity keys from computeArtistAffinity are
 * already names ready to search with.
 */
function topArtistNames(limit: number): string[] {
  const history = loadHistory();
  const affinity = computeArtistAffinity(history, Date.now());
  return Array.from(affinity.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([artistName]) => artistName);
}

/**
 * "Mix {artist}" home tiles — one per artist among the user's top listened,
 * not just a single one, so a "Dibuat Untukmu" row with genuinely varied
 * listening history shows several of these side by side, same as Spotify's
 * own multiple Daily Mix cards. Empty array when there's not enough history
 * yet to name a clear top artist — same honest-empty-state philosophy as
 * weeklyDiscovery.ts.
 */
export async function getTopArtistMixes(): Promise<ArtistMix[]> {
  const now = Date.now();
  if (cache && now - cache.fetchedAt < CACHE_TTL_MS) return cache.mixes;

  const names = topArtistNames(MAX_ARTISTS);
  if (names.length === 0) return [];

  const results = await Promise.allSettled(names.map((name) => getArtistTopSongs(name)));
  const mixes: ArtistMix[] = [];
  for (const result of results) {
    if (result.status === 'fulfilled' && result.value && result.value.songs.length > 0) {
      mixes.push({ artistName: result.value.artistName, songs: result.value.songs });
    }
  }

  cache = { mixes, fetchedAt: now };
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
