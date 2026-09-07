import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import pLimit from 'p-limit';
import { sql } from '../db/client';

const execFileAsync = promisify(execFile);

export type AudioQuality = 'high' | 'low';

export interface ResolvedAudio {
  url: string;
  mimeType: string;
}

// googlevideo.com URLs are IP-locked to whichever machine resolved them (this
// backend), and are typically valid for a few hours — caching means repeated
// seeks/replays of the same track don't re-invoke yt-dlp every time. This now
// lives in Postgres (audio_cache table) instead of an in-memory Map so a
// container restart/redeploy doesn't throw away every already-resolved link.
const CACHE_TTL_MS = 3 * 60 * 60 * 1000;

// The frontend fires a speculative /resolve prefetch for the next queued track
// and then the real streaming request can land moments later for the same
// videoId+quality before that prefetch has finished — without this, both
// requests would independently spawn their own multi-second yt-dlp process
// instead of the second one just waiting on the first's result. This stays a
// plain in-memory Map (unlike the cache above): it only needs to coalesce
// concurrent requests within this one process's lifetime, not survive a
// restart, so a Postgres round-trip would just be slower for no benefit.
const inFlight = new Map<string, Promise<ResolvedAudio>>();

// At most 3 yt-dlp processes run at once, regardless of how many resolve
// requests land concurrently — e2-micro's burstable vCPU has a limited credit
// pool, and letting every simultaneous cache-miss spawn its own process is
// what starves everything else on the box (nginx, Postgres, other users'
// already-cached requests) during a burst instead of just queuing politely.
const limit = pLimit(3);

const EXT_TO_MIME: Record<string, string> = {
  m4a: 'audio/mp4',
  webm: 'audio/webm',
  opus: 'audio/opus',
  mp3: 'audio/mpeg',
};

function formatSelector(quality: AudioQuality): string {
  // m4a/AAC is preferred over webm/opus because Safari (iOS/macOS) has no
  // native WebM/Opus support in <audio> — picking m4a keeps playback working
  // across every target browser, not just Chromium-based ones.
  return quality === 'low' ? 'worstaudio[ext=m4a]/worstaudio' : 'bestaudio[ext=m4a]/bestaudio';
}

async function getCached(videoId: string, quality: AudioQuality): Promise<ResolvedAudio | null> {
  const [row] = await sql<{ url: string; mime_type: string }[]>`
    select url, mime_type from audio_cache
    where video_id = ${videoId} and quality = ${quality} and expires_at > now()
  `;
  return row ? { url: row.url, mimeType: row.mime_type } : null;
}

async function setCached(videoId: string, quality: AudioQuality, audio: ResolvedAudio): Promise<void> {
  const expiresAt = new Date(Date.now() + CACHE_TTL_MS);
  await sql`
    insert into audio_cache (video_id, quality, url, mime_type, expires_at)
    values (${videoId}, ${quality}, ${audio.url}, ${audio.mimeType}, ${expiresAt})
    on conflict (video_id, quality)
    do update set url = excluded.url, mime_type = excluded.mime_type, expires_at = excluded.expires_at
  `;
}

export async function resolveAudio(videoId: string, quality: AudioQuality): Promise<ResolvedAudio> {
  const cacheKey = `${videoId}:${quality}`;
  const startedAt = Date.now();

  const cached = await getCached(videoId, quality);
  if (cached) {
    // eslint-disable-next-line no-console
    console.log(`[audio] ${videoId} (${quality}) — CACHE HIT in ${Date.now() - startedAt}ms`);
    return cached;
  }

  const pending = inFlight.get(cacheKey);
  if (pending) {
    // eslint-disable-next-line no-console
    console.log(`[audio] ${videoId} (${quality}) — joined in-flight resolve already running`);
    return pending;
  }

  // eslint-disable-next-line no-console
  console.log(`[audio] ${videoId} (${quality}) — CACHE MISS, spawning yt-dlp (queue depth: ${limit.pendingCount}, active: ${limit.activeCount})`);
  const resolution = resolveAudioUncached(videoId, quality).finally(() => {
    inFlight.delete(cacheKey);
  });
  inFlight.set(cacheKey, resolution);

  const audio = await resolution;
  await setCached(videoId, quality, audio);
  // eslint-disable-next-line no-console
  console.log(`[audio] ${videoId} (${quality}) — resolved in ${Date.now() - startedAt}ms total`);
  return audio;
}

/**
 * Shells out to the yt-dlp CLI (not a JS extraction library) to resolve a
 * playable audio URL. This project deliberately does NOT use npm packages
 * like ytdl-core/play-dl for this step — both were found to be broken
 * against YouTube's current player as of this build (verified live: they
 * throw "Failed to find any playable formats" even for a stable, unrelated
 * test video), because neither has been updated in over a year. yt-dlp is
 * the one extractor in this space that stays patched against YouTube's
 * frequent changes, with releases every few weeks — but it must be installed
 * separately on the host running this backend (`brew install yt-dlp`).
 */
async function resolveAudioUncached(videoId: string, quality: AudioQuality): Promise<ResolvedAudio> {
  const url = `https://www.youtube.com/watch?v=${videoId}`;
  let stdout: string;
  try {
    ({ stdout } = await limit(() =>
      execFileAsync(
        'yt-dlp',
        ['-f', formatSelector(quality), '--print', '%(url)s', '--print', '%(ext)s', '--no-warnings', '--socket-timeout', '20', url],
        { timeout: 25000, maxBuffer: 4 * 1024 * 1024 },
      ),
    ));
  } catch (error) {
    const message = (error as { stderr?: string; message: string }).stderr || (error as Error).message;
    throw new Error(`yt-dlp failed to resolve audio for ${videoId}: ${message}`);
  }

  const lines = stdout.trim().split('\n').filter(Boolean);
  const [streamUrl, ext] = lines;
  if (!streamUrl) throw new Error(`yt-dlp returned no stream URL for video ${videoId}.`);

  return {
    url: streamUrl,
    mimeType: EXT_TO_MIME[ext] ?? 'audio/mp4',
  };
}
