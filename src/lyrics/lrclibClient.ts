const BASE_URL = 'https://lrclib.net/api';
const FETCH_TIMEOUT_MS = 6000;
const DURATION_TOLERANCE_SEC = 2;

export interface LrcLibTrack {
  id: number;
  trackName: string;
  artistName: string;
  albumName: string;
  duration: number;
  instrumental: boolean;
  plainLyrics: string | null;
  syncedLyrics: string | null;
}

export interface LyricsQuery {
  trackName: string;
  artistName: string;
  albumName?: string;
  durationSec: number;
}

async function getJson(url: string): Promise<unknown> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

function toTrack(raw: unknown): LrcLibTrack | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const item = raw as Record<string, unknown>;
  if (typeof item.id !== 'number' || typeof item.trackName !== 'string') return null;
  return {
    id: item.id,
    trackName: item.trackName,
    artistName: typeof item.artistName === 'string' ? item.artistName : '',
    albumName: typeof item.albumName === 'string' ? item.albumName : '',
    duration: typeof item.duration === 'number' ? item.duration : 0,
    instrumental: item.instrumental === true,
    plainLyrics: typeof item.plainLyrics === 'string' ? item.plainLyrics : null,
    syncedLyrics: typeof item.syncedLyrics === 'string' ? item.syncedLyrics : null,
  };
}

/** Exact-match lookup — LRCLIB uses (trackName, artistName, duration) to find a precise match. */
export async function fetchExactMatch(query: LyricsQuery): Promise<LrcLibTrack | null> {
  const url = new URL(`${BASE_URL}/get`);
  url.searchParams.set('track_name', query.trackName);
  url.searchParams.set('artist_name', query.artistName);
  if (query.albumName) url.searchParams.set('album_name', query.albumName);
  url.searchParams.set('duration', String(Math.round(query.durationSec)));
  return toTrack(await getJson(url.toString()));
}

/** Fuzzy fallback when the exact lookup 404s — takes the closest duration match within tolerance. */
export async function searchClosestMatch(query: LyricsQuery): Promise<LrcLibTrack | null> {
  const url = new URL(`${BASE_URL}/search`);
  url.searchParams.set('track_name', query.trackName);
  url.searchParams.set('artist_name', query.artistName);
  const data = await getJson(url.toString());
  if (!Array.isArray(data)) return null;

  const candidates = data.map(toTrack).filter((track): track is LrcLibTrack => track !== null);
  const withinTolerance = candidates
    .filter((track) => Math.abs(track.duration - query.durationSec) <= DURATION_TOLERANCE_SEC)
    .sort((a, b) => Math.abs(a.duration - query.durationSec) - Math.abs(b.duration - query.durationSec));

  return withinTolerance[0] ?? null;
}
