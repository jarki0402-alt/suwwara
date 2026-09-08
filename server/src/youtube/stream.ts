import pLimit from 'p-limit';
import { sql } from '../db/client';

export type AudioQuality = 'high' | 'low';

export interface ResolvedAudio {
  url: string;
  mimeType: string;
  httpHeaders?: Record<string, string>;
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

// At most 1 yt-dlp process runs at once. On an e2-micro (1 vCPU, 1GB RAM) with
// the headless Chrome POT provider, running multiple instances concurrently
// causes extreme CPU context switching and RAM swapping, blowing up resolution
// time from 3s to 10s+. Limiting to 1 ensures the active track gets 100% of
// the CPU and finishes quickly, while background prefetches wait in line.
const limit = pLimit(1);

async function getCached(videoId: string, quality: AudioQuality): Promise<ResolvedAudio | null> {
  const [row] = await sql<{ url: string; mime_type: string; http_headers: any }[]>`
    select url, mime_type, http_headers from audio_cache
    where video_id = ${videoId} and quality = ${quality} and expires_at > now()
  `;
  return row ? { url: row.url, mimeType: row.mime_type, httpHeaders: row.http_headers } : null;
}

async function setCached(videoId: string, quality: AudioQuality, audio: ResolvedAudio): Promise<void> {
  const expiresAt = new Date(Date.now() + CACHE_TTL_MS);
  await sql`
    insert into audio_cache (video_id, quality, url, mime_type, http_headers, expires_at)
    values (${videoId}, ${quality}, ${audio.url}, ${audio.mimeType}, ${audio.httpHeaders ? sql.json(audio.httpHeaders) : null}, ${expiresAt})
    on conflict (video_id, quality)
    do update set url = excluded.url, mime_type = excluded.mime_type, http_headers = excluded.http_headers, expires_at = excluded.expires_at
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
 * Shells out to the yt-dlp Python microservice to resolve a playable audio URL.
 * Using a constantly running Python microservice avoids the massive multi-second 
 * cold-start penalty of spawning the yt-dlp CLI and Python VM from scratch for every request.
 */
async function resolveAudioUncached(videoId: string, quality: AudioQuality): Promise<ResolvedAudio> {
  try {
    const response = await limit(() =>
      fetch('http://ytdlp-service:8000/resolve', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ video_id: videoId, quality })
      })
    );

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`ytdlp-service returned ${response.status}: ${errText}`);
    }

    const data = await response.json() as any;
    return {
      url: data.url,
      mimeType: data.mimeType,
      httpHeaders: data.httpHeaders,
    };
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error(`[audio] ${videoId} (${quality}) — yt-dlp microservice FAILED: ${(error as Error).message}`);
    throw new Error(`yt-dlp microservice failed to resolve audio for ${videoId}: ${(error as Error).message}`);
  }
}
