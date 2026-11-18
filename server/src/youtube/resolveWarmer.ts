import { sql } from '../db/client';
import { getCachedTrack } from './diskCache';
import { refusalFor } from './refusals';
import { resolveAudio, resolveQueueState, ResolveRefusedError } from './stream';
import { getTrendingSongsIndonesia } from './trendingId';

/**
 * Keeps links warm for songs people are likely to press, so that press finds a cached URL instead of a cold yt-dlp run
 * (~2s, and much more when it queues behind another resolve). Two sources, both cheap to find:
 *  - Indonesia's trending shelf (the beranda's "Lagi Viral"), which everyone sees;
 *  - songs resolved in the last two days whose link has since expired (i.e. played or warmed recently, not now cached).
 * Deliberately timid: it only runs while the resolver is completely idle and does a handful per round, at low priority
 * (a real tap always goes first), so it can never be what a listener ends up waiting behind on this 1-vCPU VM.
 */
const ROUND_INTERVAL_MS = 10 * 60 * 1000;
const FIRST_ROUND_DELAY_MS = 60 * 1000;
const MAX_PER_ROUND = 5;
const TRENDING_TOP = 8;

// 2026-11-17: YouTube refused four trending songs with "not a bot" for 40 minutes, and every round asked all four
// again, 12 refused requests every 10 minutes from an IP YouTube already distrusted. Now a refusal ends the round and
// that song is left alone for an hour. Bounded: only this round's candidates (at most TRENDING_TOP + MAX_PER_ROUND)
// ever get in, and expired entries go on every round.
const SKIP_REFUSED_MS = 60 * 60 * 1000;
const MAX_SKIPPED = 100;
const skippedUntil = new Map<string, number>();

function isSkipped(id: string, now: number): boolean {
  for (const [skippedId, until] of skippedUntil) if (until <= now) skippedUntil.delete(skippedId);
  return skippedUntil.has(id);
}

async function candidates(): Promise<string[]> {
  const ids: string[] = [];
  try {
    const trending = await getTrendingSongsIndonesia();
    for (const song of trending.slice(0, TRENDING_TOP)) ids.push(song.id);
  } catch {
    // the shelf is optional
  }
  try {
    const rows = await sql<{ video_id: string }[]>`
      select video_id from audio_cache
      where quality = 'high' and expires_at < now() and expires_at > now() - interval '48 hours'
      order by expires_at desc limit ${MAX_PER_ROUND}
    `;
    for (const row of rows) ids.push(row.video_id);
  } catch {
    // nothing to add
  }
  return [...new Set(ids)];
}

async function round(): Promise<void> {
  let started = 0;
  for (const id of await candidates()) {
    if (started >= MAX_PER_ROUND) break;
    const state = resolveQueueState();
    if (state.pending > 0 || state.active > 0) return; // someone is waiting on the resolver: stop, try next round
    if (isSkipped(id, Date.now()) || refusalFor(id)) continue;
    if (await getCachedTrack(id, 'high')) continue; // already on disk, no link needed
    started += 1;
    // A hit on a still-valid link returns at once and costs nothing; only a real miss runs yt-dlp. Background: never
    // the backup YouTube account (it is kept for songs someone is actually playing).
    try {
      await resolveAudio(id, 'high', 'low', undefined, { background: true });
    } catch (error) {
      if (error instanceof ResolveRefusedError) {
        skippedUntil.set(id, Date.now() + SKIP_REFUSED_MS);
        while (skippedUntil.size > MAX_SKIPPED) {
          const oldest = skippedUntil.keys().next().value;
          if (oldest === undefined) break;
          skippedUntil.delete(oldest);
        }
        return;
      }
    }
  }
}

export function startResolveWarmer(): void {
  let running = false;
  const tick = (): void => {
    if (running) return;
    running = true;
    void round().finally(() => {
      running = false;
    });
  };
  setTimeout(tick, FIRST_ROUND_DELAY_MS).unref();
  setInterval(tick, ROUND_INTERVAL_MS).unref();
}
