import type { LrcCandidate } from './lyricsMatch';

const BASE_URL = 'https://lrclib.net/api';
const REQUEST_TIMEOUT_MS = 5000;
// LRCLIB asks clients to identify themselves.
const USER_AGENT = 'Suwwara/1.0 (https://suwwara.fajarrizky.my.id)';
const MAX_SEARCH_RESULTS = 20;

/**
 * Three outcomes, not two. The old client treated every failure (timeout, 429, 5xx, no signal) the same as
 * "this song has no lyrics" and remembered it — so a bad moment on the network became "Lirik tidak tersedia".
 * Only `notfound` is an answer; `error` means "ask again later".
 */
export type LrcResponse<T> = { kind: 'ok'; value: T } | { kind: 'notfound' } | { kind: 'error' };

async function request(path: string, params: Record<string, string>, signal: AbortSignal): Promise<LrcResponse<unknown>> {
  const url = new URL(`${BASE_URL}${path}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]),
    });
    if (response.status === 404) return { kind: 'notfound' };
    if (!response.ok) return { kind: 'error' };
    return { kind: 'ok', value: await response.json() };
  } catch {
    return { kind: 'error' };
  }
}

function toCandidate(raw: unknown): LrcCandidate | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const item = raw as Record<string, unknown>;
  if (typeof item.trackName !== 'string') return null;
  return {
    trackName: item.trackName,
    artistName: typeof item.artistName === 'string' ? item.artistName : '',
    duration: typeof item.duration === 'number' ? item.duration : 0,
    instrumental: item.instrumental === true,
    syncedLyrics: typeof item.syncedLyrics === 'string' && item.syncedLyrics.trim() ? item.syncedLyrics : null,
    plainLyrics: typeof item.plainLyrics === 'string' && item.plainLyrics.trim() ? item.plainLyrics : null,
  };
}

/** Exact lookup: LRCLIB matches (title, artist, duration ±2s) itself. */
export async function lrclibGet(
  query: { title: string; artist: string; durationSec: number },
  signal: AbortSignal,
): Promise<LrcResponse<LrcCandidate>> {
  const response = await request(
    '/get',
    { track_name: query.title, artist_name: query.artist, duration: String(Math.round(query.durationSec)) },
    signal,
  );
  if (response.kind !== 'ok') return response;
  const candidate = toCandidate(response.value);
  return candidate ? { kind: 'ok', value: candidate } : { kind: 'notfound' };
}

/** Fuzzy lookup by field (`track_name` + `artist_name`) or free text (`q`). */
export async function lrclibSearch(params: { title: string; artist: string } | { q: string }, signal: AbortSignal): Promise<LrcResponse<LrcCandidate[]>> {
  const response = await request(
    '/search',
    'q' in params ? { q: params.q } : { track_name: params.title, artist_name: params.artist },
    signal,
  );
  if (response.kind !== 'ok') return response;
  if (!Array.isArray(response.value)) return { kind: 'notfound' };
  const candidates = response.value
    .slice(0, MAX_SEARCH_RESULTS)
    .map(toCandidate)
    .filter((c): c is LrcCandidate => c !== null);
  return { kind: 'ok', value: candidates };
}
