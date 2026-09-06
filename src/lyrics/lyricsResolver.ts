import type { Song } from '../api/types';
import { getSongDetails } from '../api/endpoints/details';
import { primaryArtistNames } from '../api/mappers';
import { fetchExactMatch, searchClosestMatch, type LyricsQuery } from './lrclibClient';
import { parseLrc, type LrcLine } from './lrcParser';

export type LyricsResult =
  | { type: 'synced'; lines: LrcLine[] }
  | { type: 'plain'; text: string }
  | { type: 'none' };

const sessionCache = new Map<string, LyricsResult>();

// LRCLIB's canonical track name is usually just the song title — a YouTube upload's
// title frequently tacks on "(feat. X)"/"ft. X", which is enough to miss an otherwise
// exact match. Only strips a trailing feat/ft mention, never touches the rest of the
// title, so it can't accidentally match a genuinely different song.
const FEATURED_ARTIST_RE = /\s*[([]?\s*(?:feat\.?|ft\.?|featuring)\b[^)\]]*[)\]]?\s*$/i;

export function stripFeaturedArtist(trackName: string): string {
  return trackName.replace(FEATURED_ARTIST_RE, '').trim();
}

async function lookup(query: LyricsQuery): Promise<LyricsResult | null> {
  const exact = await fetchExactMatch(query);
  if (exact?.syncedLyrics) return { type: 'synced', lines: parseLrc(exact.syncedLyrics) };
  if (exact?.plainLyrics) return { type: 'plain', text: exact.plainLyrics };

  const fuzzy = await searchClosestMatch(query);
  if (fuzzy?.syncedLyrics) return { type: 'synced', lines: parseLrc(fuzzy.syncedLyrics) };
  if (fuzzy?.plainLyrics) return { type: 'plain', text: fuzzy.plainLyrics };

  return null;
}

/** Resolution order: LRCLIB exact match (synced) -> LRCLIB exact match (plain) -> LRCLIB
 * fuzzy search -> same again with a trailing "(feat. X)" stripped from the title -> none. */
export async function resolveLyrics(song: Song): Promise<LyricsResult> {
  const cached = sessionCache.get(song.id);
  if (cached) return cached;

  const result = await resolveUncached(song);
  sessionCache.set(song.id, result);
  return result;
}

async function resolveUncached(song: Song): Promise<LyricsResult> {
  // Prefer YouTube's own Content-ID metadata (clean official title/artist/album)
  // over the heuristically-cleaned search-result title — sharper LRCLIB matches.
  const refined = await getSongDetails(song.id).catch(() => song);

  const query: LyricsQuery = {
    trackName: refined.name,
    artistName: primaryArtistNames(refined),
    albumName: refined.album?.name,
    durationSec: song.duration,
  };

  try {
    const found = await lookup(query);
    if (found) return found;

    const strippedTrackName = stripFeaturedArtist(query.trackName);
    if (strippedTrackName !== query.trackName) {
      const foundStripped = await lookup({ ...query, trackName: strippedTrackName });
      if (foundStripped) return foundStripped;
    }
  } catch {
    // Network/API failure — degrade to "no lyrics" rather than throwing.
  }

  return { type: 'none' };
}
