import { sql } from '../db/client';

export type AudioQuality = 'high' | 'low';
export type ResolvePriority = 'high' | 'low';

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
//
// A plain FIFO queue (the original p-limit(1) this replaced) meant a track the
// user actually just clicked could land behind an already-queued background
// prefetch for a track further down the queue that nobody's about to hear yet
// — exactly the moment a delay is most noticeable. This two-lane priority
// queue keeps the concurrency cap at 1 (same RAM/CPU ceiling) but always drains
// the 'high' lane (real playback — the track currently being loaded/crossfaded
// to) before the 'low' lane (speculative resolve-only prefetch for tracks
// further ahead). It can't interrupt a resolve that's already in flight — only
// queue order — but that's the only case a strict FIFO queue could ever get
// wrong here, so this closes it without touching the concurrency limit itself.
class PriorityLimiter {
  private active = 0;
  private readonly high: Array<() => void> = [];
  private readonly low: Array<() => void> = [];

  constructor(private readonly maxConcurrency: number) {}

  run<T>(priority: ResolvePriority, fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const task = (): void => {
        this.active += 1;
        fn()
          .then(resolve, reject)
          .finally(() => {
            this.active -= 1;
            this.dequeue();
          });
      };
      (priority === 'high' ? this.high : this.low).push(task);
      this.dequeue();
    });
  }

  private dequeue(): void {
    if (this.active >= this.maxConcurrency) return;
    const next = this.high.shift() ?? this.low.shift();
    next?.();
  }

  get pendingCount(): number {
    return this.high.length + this.low.length;
  }

  get activeCount(): number {
    return this.active;
  }
}

const limit = new PriorityLimiter(1);

// Cold yt-dlp resolutions (BotGuard PO-token handshake included) normally land
// in a few seconds; this is a safety net, not the expected case. Without it, a
// hung ytdlp-service/bgutil-provider call (e.g. its headless Chrome wedged)
// left this fetch() pending forever — and since every resolve funnels through
// the single-slot limiter above, one stuck request silently froze audio
// resolution for every track, for every user, until the container restarted.
// Set comfortably above ytdlp-service's own internal `socket_timeout: 20`
// (server/ytdlp-service/main.py) so that timeout gets a chance to fire and
// return a clean error first; this is the backstop for when it doesn't.
const RESOLVE_TIMEOUT_MS = 25000;

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

/**
 * `priority` distinguishes a track that's actually about to be heard (the one
 * being loaded/crossfaded to right now — pass 'high') from a track just being
 * speculatively warmed up ahead of time (the resolve-only lookahead prefetch —
 * pass 'low'). Both still share the same single-slot concurrency limiter
 * (unchanged RAM/CPU ceiling); this only changes which one goes first when
 * both are queued at once. See the PriorityLimiter comment above for why.
 */
export async function resolveAudio(videoId: string, quality: AudioQuality, priority: ResolvePriority = 'high'): Promise<ResolvedAudio> {
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
  console.log(`[audio] ${videoId} (${quality}) — CACHE MISS, spawning yt-dlp (priority: ${priority}, queue depth: ${limit.pendingCount}, active: ${limit.activeCount})`);
  const resolution = resolveAudioUncached(videoId, quality, priority).finally(() => {
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
async function resolveAudioUncached(videoId: string, quality: AudioQuality, priority: ResolvePriority): Promise<ResolvedAudio> {
  try {
    const response = await limit.run(priority, () =>
      fetch('http://ytdlp-service:8000/resolve', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ video_id: videoId, quality }),
        signal: AbortSignal.timeout(RESOLVE_TIMEOUT_MS),
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
