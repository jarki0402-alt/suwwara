import { sql } from '../db/client';
import { getSongDetails } from './details';
import { lrclibGet, lrclibSearch, type LrcResponse } from './lrclib';
import {
  artistVariants,
  evaluateCandidates,
  mergeFound,
  NOTHING,
  titleVariants,
  type Found,
  type LrcCandidate,
  type Wanted,
} from './lyricsMatch';
import { PriorityLimiter } from './priorityLimiter';
import { getYTMusic } from './ytmusic';

export type LyricsPayload =
  | { type: 'synced'; source: 'lrclib'; lrc: string; matchedDurationSec: number }
  | { type: 'plain'; source: 'lrclib' | 'ytmusic'; text: string; matchedDurationSec: number | null }
  | { type: 'instrumental' }
  | { type: 'none' };

/** Every source answered and none of them has this song — or ALL of them failed, which is not the same thing. */
export class LyricsUnavailableError extends Error {
  constructor() {
    super('Lyrics sources could not be reached.');
    this.name = 'LyricsUnavailableError';
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;
// When each kind of answer is worth asking about again. Plain text is rechecked weekly because a synced version may
// have been contributed since; "none" daily because catalogs fill in; a plain answer that was reached while another
// lookup was failing is retried within the hour.
const TTL_MS = { synced: 30 * DAY_MS, instrumental: 30 * DAY_MS, plain: 7 * DAY_MS, plainDegraded: 60 * 60 * 1000, none: DAY_MS };

const RESOLVE_DEADLINE_MS = 10_000;
// A resolve is a handful of small HTTP calls, not a yt-dlp run — but a burst of songs (fast skipping with lyrics
// open) shouldn't fan out into a burst of upstream requests either.
const limiter = new PriorityLimiter(3);
const inFlight = new Map<string, Promise<LyricsPayload>>();

const MAX_ROWS = 50_000;
const PRUNE_AFTER_MS = 30 * DAY_MS; // past its refresh time by this long, a row is no longer worth serving stale

interface Meta {
  title: string;
  artist: string;
  durationSec: number;
}

/**
 * Title / artist / duration of the video, from YouTube Music's own player data. `getSong` answers in ~100ms and is
 * cleaner than the youtube-sr scrape the client used to ask for (~500ms, and it reported artist "Release" for a
 * song by "NIRWANA COMEBACK x ADINDA RAHMA"); the scrape stays as the fallback. Deliberately not taken from the
 * caller: anyone could then store wrong words under a video id for everybody.
 */
async function loadMeta(videoId: string): Promise<Meta | null> {
  try {
    const ytmusic = await getYTMusic();
    const song = await ytmusic.getSong(videoId);
    if (song.name && song.artist?.name) return { title: song.name, artist: song.artist.name, durationSec: song.duration ?? 0 };
  } catch {
    // fall through to the scrape
  }
  try {
    const details = await getSongDetails(videoId);
    return { title: details.title, artist: details.artist, durationSec: details.durationSec };
  } catch {
    return null;
  }
}

interface Attempt {
  sawError: boolean;
}

function unwrap<T>(response: LrcResponse<T>, attempt: Attempt): T | null {
  if (response.kind === 'error') attempt.sawError = true;
  return response.kind === 'ok' ? response.value : null;
}

/**
 * LRCLIB, cheapest lookup first, stopping the moment synced lyrics turn up: exact match on the raw title, on the lead
 * artist, then a by-field search; then the same for plainer titles; finally one free-text search.
 */
async function lookupLrclib(meta: Meta, signal: AbortSignal, attempt: Attempt): Promise<Found> {
  const wanted: Wanted = { title: meta.title, artist: meta.artist, durationSec: meta.durationSec };
  const artists = artistVariants(meta.artist);
  let found = NOTHING;

  const take = (candidates: LrcCandidate[]) => {
    found = mergeFound(found, evaluateCandidates(candidates, wanted), wanted);
  };

  const titles = titleVariants(meta.title);
  for (const [index, title] of titles.entries()) {
    for (const artist of index === 0 ? artists : artists.slice(0, 1)) {
      if (signal.aborted) return found;
      const exact = unwrap(await lrclibGet({ title, artist, durationSec: meta.durationSec }, signal), attempt);
      // /get's own match is by title+artist+duration, so it is trusted as-is (the agreement check is for search hits).
      if (exact) take([{ ...exact, trackName: meta.title, artistName: meta.artist }]);
      if (found.synced) return found;
    }
    if (signal.aborted) return found;
    const searched = unwrap(await lrclibSearch({ title, artist: artists[0] }, signal), attempt);
    if (searched) take(searched);
    if (found.synced) return found;
  }

  if (!signal.aborted) {
    const freeText = unwrap(await lrclibSearch({ q: `${titles[titles.length - 1]} ${artists[artists.length - 1]}` }, signal), attempt);
    if (freeText) take(freeText);
  }
  return found;
}

/** YouTube Music's own lyrics tab, keyed by the exact video — no title matching to get wrong, but text only. */
async function lookupYtMusic(videoId: string, attempt: Attempt): Promise<string | null> {
  try {
    const ytmusic = await getYTMusic();
    const lines = await ytmusic.getLyrics(videoId);
    const text = lines?.join('\n').trim() ?? '';
    return text.length >= 20 ? text : null;
  } catch {
    attempt.sawError = true;
    return null;
  }
}

async function resolveFresh(videoId: string): Promise<{ payload: LyricsPayload; ttlMs: number } | null> {
  const signal = AbortSignal.timeout(RESOLVE_DEADLINE_MS);
  const attempt: Attempt = { sawError: false };

  const meta = await loadMeta(videoId);
  if (!meta) attempt.sawError = true;
  const found = meta ? await lookupLrclib(meta, signal, attempt) : NOTHING;
  // A deadline that cut the search short is a failure to look, not a finding of absence.
  if (signal.aborted) attempt.sawError = true;

  if (found.synced) {
    return { payload: { type: 'synced', source: 'lrclib', lrc: found.synced.lrc, matchedDurationSec: found.synced.durationSec }, ttlMs: TTL_MS.synced };
  }
  if (found.plain) {
    return {
      payload: { type: 'plain', source: 'lrclib', text: found.plain.text, matchedDurationSec: found.plain.durationSec },
      ttlMs: attempt.sawError ? TTL_MS.plainDegraded : TTL_MS.plain,
    };
  }
  if (found.instrumental) return { payload: { type: 'instrumental' }, ttlMs: TTL_MS.instrumental };

  const fromYt = await lookupYtMusic(videoId, attempt);
  if (fromYt) {
    return { payload: { type: 'plain', source: 'ytmusic', text: fromYt, matchedDurationSec: null }, ttlMs: attempt.sawError ? TTL_MS.plainDegraded : TTL_MS.plain };
  }

  return attempt.sawError ? null : { payload: { type: 'none' }, ttlMs: TTL_MS.none };
}

interface Row {
  type: LyricsPayload['type'];
  source: string | null;
  synced: string | null;
  plain: string | null;
  matched_duration_sec: number | null;
  expires_at: Date;
}

function payloadFromRow(row: Row): LyricsPayload {
  switch (row.type) {
    case 'synced':
      return { type: 'synced', source: 'lrclib', lrc: row.synced ?? '', matchedDurationSec: row.matched_duration_sec ?? 0 };
    case 'plain':
      return { type: 'plain', source: row.source === 'ytmusic' ? 'ytmusic' : 'lrclib', text: row.plain ?? '', matchedDurationSec: row.matched_duration_sec };
    case 'instrumental':
      return { type: 'instrumental' };
    default:
      return { type: 'none' };
  }
}

async function readRow(videoId: string): Promise<Row | null> {
  try {
    const rows = await sql<Row[]>`
      select type, source, synced, plain, matched_duration_sec, expires_at from lyrics_cache where video_id = ${videoId}`;
    return rows[0] ?? null;
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn('[lyrics] cache read failed, resolving without it:', (error as Error).message);
    return null;
  }
}

async function writeRow(videoId: string, payload: LyricsPayload, ttlMs: number): Promise<void> {
  const synced = payload.type === 'synced' ? payload.lrc : null;
  const plain = payload.type === 'plain' ? payload.text : null;
  const source = payload.type === 'synced' || payload.type === 'plain' ? payload.source : null;
  const matched = payload.type === 'synced' || payload.type === 'plain' ? payload.matchedDurationSec : null;
  try {
    await sql`
      insert into lyrics_cache (video_id, type, source, synced, plain, matched_duration_sec, expires_at, fetched_at)
      values (${videoId}, ${payload.type}, ${source}, ${synced}, ${plain}, ${matched}, ${new Date(Date.now() + ttlMs)}, now())
      on conflict (video_id) do update set
        type = excluded.type, source = excluded.source, synced = excluded.synced, plain = excluded.plain,
        matched_duration_sec = excluded.matched_duration_sec, expires_at = excluded.expires_at, fetched_at = now()`;
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn('[lyrics] cache write failed:', (error as Error).message);
  }
}

/**
 * Lyrics for a video: from Postgres when fresh; otherwise looked up (LRCLIB, then YouTube Music), stored, and
 * returned. Concurrent requests for the same video share one lookup. If the lookup can't reach anything, a stale
 * row is served rather than an error — and nothing is stored, so the next request tries again.
 */
export async function getLyrics(videoId: string): Promise<LyricsPayload> {
  const row = await readRow(videoId);
  if (row && row.expires_at.getTime() > Date.now()) return payloadFromRow(row);

  const pending = inFlight.get(videoId);
  if (pending) return pending;

  const loading = (async (): Promise<LyricsPayload> => {
    const fresh = await limiter.schedule('high', () => resolveFresh(videoId)).promise;
    if (fresh) {
      await writeRow(videoId, fresh.payload, fresh.ttlMs);
      return fresh.payload;
    }
    if (row) return payloadFromRow(row);
    throw new LyricsUnavailableError();
  })().finally(() => {
    inFlight.delete(videoId);
  });
  inFlight.set(videoId, loading);
  return loading;
}

/** Keeps the table bounded: rows long past their refresh time go, then anything beyond the newest MAX_ROWS. */
export async function pruneLyricsCache(): Promise<void> {
  try {
    await sql`delete from lyrics_cache where expires_at < ${new Date(Date.now() - PRUNE_AFTER_MS)}`;
    await sql`
      delete from lyrics_cache where video_id in (
        select video_id from lyrics_cache order by fetched_at desc offset ${MAX_ROWS})`;
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn('[lyrics] prune failed:', (error as Error).message);
  }
}

setInterval(() => void pruneLyricsCache(), 6 * 60 * 60 * 1000).unref();
