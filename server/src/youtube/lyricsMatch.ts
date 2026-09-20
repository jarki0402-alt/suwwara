/**
 * Pure matching rules for lyrics lookups (no I/O, so they can be tested exhaustively).
 *
 * LRCLIB indexes a song by (title, artist, duration) as its *studio* metadata, while what we hold is a
 * YouTube Music title that often carries decoration — "(feat. X)", "(Remastered 2011)", "(From "Film")",
 * "- Live". The lookups below try the raw title first and then progressively plainer ones, and only ever
 * accept a candidate whose plain title and artist agree, so a looser query can't attach a different song's words.
 */

/** Synced (timestamped) lyrics are only trusted when the matched recording is this close in length to ours. */
export const SYNC_TOLERANCE_SEC = 2;

const FEATURED_ARTIST_RE = /\s*[([]?\s*(?:feat\.?|ft\.?|featuring)\b[^)\]]*[)\]]?\s*$/i;
const TRAILING_GROUP_RE = /\s*[([][^)\]]*[)\]]\s*$/;
// A bracket that is part of the title itself ("Song (Part 2)", "(1)") or changes what is sung ("(Instrumental)").
const KEEP_GROUP_RE = /^[([]\s*(?:part\b|pt\b|vol\b|chapter\b|\d|instrumental\b|karaoke\b)/i;
const DASH_SUFFIX_RE =
  /\s+[-–—]\s+[^-–—]*\b(?:remaster(?:ed)?|live|version|edit|mix|mono|stereo|acoustic|demo|soundtrack|from|bonus|deluxe)\b[^-–—]*$/i;

export function stripFeaturedArtist(title: string): string {
  return title.replace(FEATURED_ARTIST_RE, '').trim();
}

/** Drops trailing "(…)" / "[…]" / " - Remastered 2011" style decoration, keeping brackets that belong to the title. */
export function stripDecorations(title: string): string {
  let current = stripFeaturedArtist(title);
  for (let pass = 0; pass < 4; pass += 1) {
    let next = current;
    const group = TRAILING_GROUP_RE.exec(current);
    if (group && !KEEP_GROUP_RE.test(group[0].trim())) next = current.slice(0, group.index).trim();
    else next = current.replace(DASH_SUFFIX_RE, '').trim();
    next = stripFeaturedArtist(next);
    if (next === current || next.length === 0) break;
    current = next;
  }
  return current;
}

/** The title as-is, then without a feat. credit, then without any decoration — deduplicated, most specific first. */
export function titleVariants(title: string): string[] {
  const variants = [title.trim(), stripFeaturedArtist(title), stripDecorations(title)].filter((v) => v.length > 0);
  return [...new Set(variants)];
}

/** Case-, accent- and punctuation-insensitive form, safe for non-Latin scripts. */
export function normalizeForCompare(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** "A x B", "A, B", "A & B", "A feat. B" -> the full string, then just "A" (LRCLIB usually files the lead artist). */
export function artistVariants(artist: string): string[] {
  const full = artist.trim();
  const first = full.split(/\s*(?:,|;|&|\bx\b|\bfeat\.?|\bft\.?|\bfeaturing\b)\s*/i)[0]?.trim() ?? '';
  return [...new Set([full, first].filter((v) => v.length > 0))];
}

export function titlesMatch(a: string, b: string): boolean {
  const left = normalizeForCompare(stripDecorations(a));
  return left.length > 0 && left === normalizeForCompare(stripDecorations(b));
}

/** True when the two artist strings share at least one word ("Nissa Sabyan" ~ "Sabyan"). */
export function artistsOverlap(a: string, b: string): boolean {
  const words = (text: string) => normalizeForCompare(text).split(' ').filter((word) => word.length >= 2);
  const right = new Set(words(b));
  return words(a).some((word) => right.has(word));
}

/** Plain text from an LRC body: the timestamps and metadata tags ([ar:…], [00:12.30]) removed. */
export function plainFromLrc(lrc: string): string {
  return lrc
    .split(/\r?\n/)
    .map((line) => line.replace(/\[[^\]]*\]/g, '').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export interface LrcCandidate {
  trackName: string;
  artistName: string;
  duration: number;
  instrumental: boolean;
  syncedLyrics: string | null;
  plainLyrics: string | null;
}

export interface Wanted {
  title: string;
  artist: string;
  durationSec: number;
}

export interface Found {
  synced: { lrc: string; durationSec: number } | null;
  plain: { text: string; durationSec: number } | null;
  instrumental: boolean;
}

export const NOTHING: Found = { synced: null, plain: null, instrumental: false };

const gap = (candidate: { duration: number }, wanted: Wanted) => Math.abs(candidate.duration - wanted.durationSec);

/**
 * What a candidate list is worth for `wanted`. Candidates must agree on plain title and artist. Synced lyrics
 * additionally need a near-identical duration (their timestamps belong to one specific recording); plain text
 * doesn't depend on timing, so it is accepted at any duration — and is derived from a synced body when that is
 * all a candidate has.
 */
export function evaluateCandidates(candidates: LrcCandidate[], wanted: Wanted): Found {
  const relevant = candidates.filter((c) => titlesMatch(c.trackName, wanted.title) && artistsOverlap(c.artistName, wanted.artist));

  const synced = relevant
    .filter((c) => c.syncedLyrics && gap(c, wanted) <= SYNC_TOLERANCE_SEC)
    .sort((a, b) => gap(a, wanted) - gap(b, wanted))[0];

  const plainSource = relevant
    .filter((c) => c.plainLyrics || c.syncedLyrics)
    .sort((a, b) => gap(a, wanted) - gap(b, wanted))[0];
  const plainText = plainSource ? (plainSource.plainLyrics ?? plainFromLrc(plainSource.syncedLyrics ?? '')) : '';

  return {
    synced: synced?.syncedLyrics ? { lrc: synced.syncedLyrics, durationSec: synced.duration } : null,
    plain: plainSource && plainText.length > 0 ? { text: plainText, durationSec: plainSource.duration } : null,
    instrumental: relevant.some((c) => c.instrumental),
  };
}

/** Keeps the better of two findings: synced over none (nearer duration wins), plain over none, instrumental sticks. */
export function mergeFound(current: Found, more: Found, wanted: Wanted): Found {
  const better = <T extends { durationSec: number }>(a: T | null, b: T | null): T | null => {
    if (!a) return b;
    if (!b) return a;
    return Math.abs(b.durationSec - wanted.durationSec) < Math.abs(a.durationSec - wanted.durationSec) ? b : a;
  };
  return {
    synced: better(current.synced, more.synced),
    plain: better(current.plain, more.plain),
    instrumental: current.instrumental || more.instrumental,
  };
}
