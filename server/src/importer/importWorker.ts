import { sql } from '../db/client';
import { searchSongsUncached, type SearchSong } from '../youtube/search';
import { isBetter, pickBest, searchQueries, type MatchCandidate, type MatchVerdict, type ScoredCandidate, type SpotifyTrackForMatch } from './spotifyMatch';

/**
 * Matches imported Spotify tracks to YT Music songs, one at a time, in the background (routes/spotifyImport.ts queues
 * them). All state is in Postgres (spotify_import_tracks), so a restart just picks up the next pending row; there is
 * no in-memory queue to bound.
 *
 * One search at a time with a pause between: a search is cheap for this VM (one HTTP call, ~0.5s) but a few thousand
 * back to back from one IP is how YouTube starts refusing it, and then the app's own search breaks for everyone. At
 * ~1.2s per song a 1000-song library takes ~20 minutes, and the songs are added to the library playlist by playlist as
 * they finish, so nobody waits for the end. Searches never touch yt-dlp: audio is resolved when a song is played.
 */
const PAUSE_BETWEEN_SEARCHES_MS = 700;
// YouTube unreachable or refusing: back off instead of burning through the queue marking everything not found.
const PAUSE_AFTER_ERROR_MS = 15_000;
const MAX_ATTEMPTS_PER_TRACK = 3;
const CANDIDATES_PER_SEARCH = 5;

let running = false;

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms).unref();
  });

function toCandidate(song: SearchSong): MatchCandidate {
  return { id: song.id, title: song.title, artist: song.artist, durationSec: song.durationSec };
}

/** Both queries' best, or null when every search failed (a network problem, not "no such song"). */
async function matchTrack(track: SpotifyTrackForMatch): Promise<{ verdict: MatchVerdict; song: SearchSong | null } | null> {
  const [first, second] = searchQueries(track);
  let best: ScoredCandidate | null = null;
  let bestSong: SearchSong | null = null;
  let anySucceeded = false;

  for (const [index, query] of [first, second].entries()) {
    if (index === 1) {
      if (best?.verdict === 'yakin') break;
      await sleep(PAUSE_BETWEEN_SEARCHES_MS);
    }
    let songs: SearchSong[];
    try {
      songs = await searchSongsUncached(query, CANDIDATES_PER_SEARCH);
      anySucceeded = true;
    } catch {
      continue;
    }
    const pick = pickBest(track, songs.map(toCandidate));
    if (isBetter(pick, best)) {
      best = pick;
      bestSong = songs.find((song) => song.id === pick?.candidate.id) ?? null;
    }
  }

  if (!anySucceeded) return null;
  if (!best || best.verdict === 'none' || !bestSong) return { verdict: 'none', song: null };
  return { verdict: best.verdict, song: bestSong };
}

interface PendingRow {
  import_id: string;
  key: string;
  name: string;
  artists: string[];
  duration_sec: number;
}

async function nextPending(): Promise<PendingRow | null> {
  // Oldest import first, its tracks in the order the client put them (liked songs first).
  const [row] = await sql<PendingRow[]>`
    select t.import_id, t.key, t.name, t.artists, t.duration_sec
    from spotify_import_tracks t join spotify_imports i on i.id = t.import_id
    where t.status = 'pending' and i.status = 'running'
    order by i.created_at, t.position
    limit 1`;
  return row ?? null;
}

async function settle(row: PendingRow, verdict: MatchVerdict, song: SearchSong | null): Promise<void> {
  await sql`
    update spotify_import_tracks set status = ${verdict}, song = ${song ? sql.json(song as never) : null}
    where import_id = ${row.import_id} and key = ${row.key}`;
  await sql`
    update spotify_imports set status = 'done', finished_at = now()
    where id = ${row.import_id} and status = 'running'
      and not exists (select 1 from spotify_import_tracks where import_id = ${row.import_id} and status = 'pending')`;
}

async function work(): Promise<void> {
  const failures = new Map<string, number>();
  for (;;) {
    const row = await nextPending();
    if (!row) return;

    const [cached] = await sql<{ verdict: MatchVerdict; song: SearchSong | null }[]>`
      select verdict, song from spotify_track_matches where key = ${row.key}`;
    if (cached) {
      await settle(row, cached.verdict, cached.song);
      continue;
    }

    const result = await matchTrack({ name: row.name, artists: row.artists, durationSec: row.duration_sec });
    if (!result) {
      const attempts = (failures.get(row.key) ?? 0) + 1;
      failures.set(row.key, attempts);
      // Not cached: it is not known to be missing, the search just failed.
      if (attempts >= MAX_ATTEMPTS_PER_TRACK) await settle(row, 'none', null);
      await sleep(PAUSE_AFTER_ERROR_MS);
      continue;
    }
    failures.delete(row.key);
    await sql`
      insert into spotify_track_matches (key, verdict, song) values (${row.key}, ${result.verdict}, ${result.song ? sql.json(result.song as never) : null})
      on conflict (key) do update set verdict = excluded.verdict, song = excluded.song, matched_at = now()`;
    await settle(row, result.verdict, result.song);
    await sleep(PAUSE_BETWEEN_SEARCHES_MS);
  }
}

/** Starts the loop if it is not already going. Called on boot (resume) and whenever an import is queued. */
export function kickImportWorker(): void {
  if (running) return;
  running = true;
  void work()
    .catch((error) => {
      // eslint-disable-next-line no-console
      console.warn('[import] worker stopped:', (error as Error).message);
    })
    .finally(() => {
      running = false;
    });
}

/** Imports are only a hand-over to the client; a few days after one ends nothing reads it again. */
export async function pruneImports(): Promise<void> {
  try {
    await sql`
      delete from spotify_imports
      where (finished_at is not null and finished_at < now() - interval '7 days') or created_at < now() - interval '30 days'`;
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn('[import] prune failed:', (error as Error).message);
  }
}

setInterval(() => void pruneImports(), 6 * 60 * 60 * 1000).unref();
