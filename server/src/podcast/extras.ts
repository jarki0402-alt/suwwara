import { sql } from '../db/client';
import { scheduleOnResolver } from '../youtube/stream';

/**
 * An episode's chapters and transcript (from the video's own captions), read once through ytdlp-service's /extras and
 * kept in Postgres. That read is a yt-dlp extraction, so it takes the shared single yt-dlp slot like every resolve, in
 * the 'idle' lane: a song or episode someone is about to hear always goes first. Asked for only when the player
 * shows an episode, never in bulk.
 */

export interface Chapter {
  title: string;
  start: number;
}

export interface Transcript {
  lang: string | null;
  /** YouTube's speech recognition, not the creator's own captions: worth saying, it makes mistakes. */
  auto: boolean;
  cues: { s: number; t: string }[];
}

export interface EpisodeExtras {
  chapters: Chapter[];
  transcript: Transcript | null;
}

const EXTRAS_TIMEOUT_MS = 30_000;
const MAX_ROWS = 3000;
const SAFE_ID = /^[A-Za-z0-9_-]{6,20}$/;

// Two devices opening the same episode at once share one extraction. Bounded by the single slot behind it.
const inFlight = new Map<string, Promise<EpisodeExtras>>();

async function readFromYoutube(videoId: string): Promise<EpisodeExtras> {
  const { promise } = scheduleOnResolver('idle', async () => {
    const res = await fetch('http://ytdlp-service:8000/extras', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ video_id: videoId }),
      signal: AbortSignal.timeout(EXTRAS_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`ytdlp-service returned ${res.status}`);
    return (await res.json()) as EpisodeExtras;
  });
  const extras = await promise;
  const chapters = Array.isArray(extras.chapters) ? extras.chapters : [];
  const transcript = extras.transcript && Array.isArray(extras.transcript.cues) ? extras.transcript : null;
  await sql`
    insert into podcast_extras (video_id, chapters, transcript) values (${videoId}, ${sql.json(chapters as never)}, ${transcript ? sql.json(transcript as never) : null})
    on conflict (video_id) do update set chapters = excluded.chapters, transcript = excluded.transcript, fetched_at = now()`;
  return { chapters, transcript };
}

export async function getEpisodeExtras(videoId: string): Promise<EpisodeExtras> {
  if (!SAFE_ID.test(videoId)) throw new Error('bad id');
  const [row] = await sql<{ chapters: Chapter[]; transcript: Transcript | null }[]>`
    select chapters, transcript from podcast_extras where video_id = ${videoId}`;
  if (row) return { chapters: row.chapters, transcript: row.transcript };
  let pending = inFlight.get(videoId);
  if (!pending) {
    pending = readFromYoutube(videoId).finally(() => inFlight.delete(videoId));
    inFlight.set(videoId, pending);
  }
  return pending;
}

export async function pruneEpisodeExtras(): Promise<void> {
  try {
    await sql`delete from podcast_extras where fetched_at < now() - interval '90 days'`;
    await sql`delete from podcast_extras where video_id in (select video_id from podcast_extras order by fetched_at desc offset ${MAX_ROWS})`;
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn('[podcast] extras prune failed:', (error as Error).message);
  }
}

setInterval(() => void pruneEpisodeExtras(), 6 * 60 * 60 * 1000).unref();
