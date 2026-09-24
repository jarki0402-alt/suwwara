import { sql } from '../db/client';
import { recordResolve } from '../metrics/resolveStats';
import { PriorityLimiter, ResolveAbortedError, type ResolvePriority, type TaskHandle } from './priorityLimiter';

export { ResolveAbortedError };

export type AudioQuality = 'high' | 'low';
export type { ResolvePriority };

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
//
// The real lifetime is whatever the URL itself says (its `expire=` query param,
// ~6h from resolve time), so that is what drives the TTL — with a safety margin,
// and this flat 3h only as the fallback for a URL that doesn't carry one. A longer
// TTL matters because a cache hit (~1ms) vs. a miss (a fresh yt-dlp run, ~1.6s
// unloaded and much worse when other resolves are queued ahead) is the difference
// between "instant" and "loading" the moment someone taps an already-heard track.
const FALLBACK_CACHE_TTL_MS = 3 * 60 * 60 * 1000;
const MAX_CACHE_TTL_MS = 5 * 60 * 60 * 1000;
const EXPIRY_SAFETY_MARGIN_MS = 15 * 60 * 1000;
const MIN_CACHE_TTL_MS = 60 * 1000;

function cacheExpiryMs(url: string): number {
  const now = Date.now();
  try {
    const expireSec = Number(new URL(url).searchParams.get('expire'));
    if (Number.isFinite(expireSec) && expireSec > 0) {
      const untilExpiry = expireSec * 1000 - EXPIRY_SAFETY_MARGIN_MS - now;
      return now + Math.min(Math.max(untilExpiry, MIN_CACHE_TTL_MS), MAX_CACHE_TTL_MS);
    }
  } catch {
    // not a parseable URL — fall through to the flat TTL
  }
  return now + FALLBACK_CACHE_TTL_MS;
}

// Every audio Range request (mobile browsers send dozens per track) calls
// resolveAudio, and each used to cost a Postgres round trip just to re-read the
// same row. This small in-process layer answers those from memory. Hard-capped
// and swept (not just lazily TTL-checked) because the key comes from an
// unbounded input (video ids) on a 1GB VM — same rule as windowCache in
// routes/audio.ts. Postgres stays the source of truth across restarts.
const HOT_CACHE_MAX_ENTRIES = 200;
const hotCache = new Map<string, { audio: ResolvedAudio; expiresAt: number }>();

function getHot(key: string): ResolvedAudio | null {
  const entry = hotCache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    hotCache.delete(key);
    return null;
  }
  return entry.audio;
}

function setHot(key: string, audio: ResolvedAudio, expiresAt: number): void {
  hotCache.delete(key); // re-insert so this key becomes the most-recently-set for eviction order below.
  hotCache.set(key, { audio, expiresAt });
  while (hotCache.size > HOT_CACHE_MAX_ENTRIES) {
    const oldestKey = hotCache.keys().next().value;
    if (oldestKey === undefined) break;
    hotCache.delete(oldestKey);
  }
}

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of hotCache) {
    if (entry.expiresAt <= now) hotCache.delete(key);
  }
}, 5 * 60 * 1000).unref();

// At most 1 yt-dlp process runs at once. On an e2-micro (1 vCPU, 1GB RAM) with the
// headless Chrome POT provider, running several concurrently causes extreme CPU context
// switching and RAM swapping, blowing resolution time up from 3s to 10s+ — see
// priorityLimiter.ts for how the queue in front of this single slot behaves, and why
// making one resolve faster was never the actual problem.
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
const RESOLVE_TIMEOUT_MS = 15000;

// The single yt-dlp slot means one wedged resolve makes everything behind it wait its full timeout in turn — with
// YouTube unreachable, a tapped song sat 45-60s behind a line of doomed attempts. After a few failures in a row the
// resolver is treated as down for a short while: callers fail at once (the client shows its error and can retry)
// instead of queueing, and the first attempt after the pause is the probe that closes it again.
const BREAKER_FAILURES = 3;
const BREAKER_OPEN_MS = 10_000;
let consecutiveFailures = 0;
let breakerOpenUntil = 0;

async function getCached(videoId: string, quality: AudioQuality): Promise<{ audio: ResolvedAudio; expiresAt: number } | null> {
  const [row] = await sql<{ url: string; mime_type: string; http_headers: any; expires_at: Date }[]>`
    select url, mime_type, http_headers, expires_at from audio_cache
    where video_id = ${videoId} and quality = ${quality} and expires_at > now()
  `;
  if (!row) return null;
  return {
    audio: { url: row.url, mimeType: row.mime_type, httpHeaders: row.http_headers },
    expiresAt: new Date(row.expires_at).getTime(),
  };
}

async function setCached(videoId: string, quality: AudioQuality, audio: ResolvedAudio, expiresAtMs: number): Promise<void> {
  const expiresAt = new Date(expiresAtMs);
  await sql`
    insert into audio_cache (video_id, quality, url, mime_type, http_headers, expires_at)
    values (${videoId}, ${quality}, ${audio.url}, ${audio.mimeType}, ${audio.httpHeaders ? sql.json(audio.httpHeaders) : null}, ${expiresAt})
    on conflict (video_id, quality)
    do update set url = excluded.url, mime_type = excluded.mime_type, http_headers = excluded.http_headers, expires_at = excluded.expires_at
  `;
}

/** Forgets a cached URL that turned out to be dead (googlevideo answered 403/410 —
 * expired early, or its IP lock no longer matches). The next resolveAudio() then
 * runs a fresh yt-dlp instead of handing out the same dead link for hours.
 *
 * `deadUrl` is the link the caller actually saw fail. Several chunk fetches for one
 * track can hit the dead link at the same moment; without this, the second one to
 * arrive would invalidate the *fresh* link the first one had just resolved, and the
 * two would keep throwing each other's replacement away. */
export async function invalidateAudio(videoId: string, quality: AudioQuality, deadUrl?: string): Promise<void> {
  const key = `${videoId}:${quality}`;
  const hot = hotCache.get(key);
  if (deadUrl && hot && hot.audio.url !== deadUrl) return; // already replaced with a fresh link
  hotCache.delete(key);
  try {
    if (deadUrl) {
      await sql`delete from audio_cache where video_id = ${videoId} and quality = ${quality} and url = ${deadUrl}`;
    } else {
      await sql`delete from audio_cache where video_id = ${videoId} and quality = ${quality}`;
    }
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error(`[audio] ${videoId} (${quality}) — failed to invalidate cache row: ${(error as Error).message}`);
  }
}

// The frontend fires a speculative /resolve prefetch for the next queued track
// and then the real streaming request can land moments later for the same
// videoId+quality before that prefetch has finished — without this, both
// requests would independently spawn their own multi-second yt-dlp process
// instead of the second one just waiting on the first's result. This stays a
// plain in-memory Map (unlike the cache above): it only needs to coalesce
// concurrent requests within this one process's lifetime, not survive a
// restart, so a Postgres round-trip would just be slower for no benefit.
// `interested` counts callers still waiting on the result — when it drops to
// zero while the job is still queued (not yet running), the job is dropped.
interface ResolveJob {
  promise: Promise<ResolvedAudio>;
  handle: TaskHandle;
  interested: number;
}
const inFlight = new Map<string, ResolveJob>();

function abortable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(new ResolveAbortedError());
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new ResolveAbortedError());
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
}

/** Queue depth of the yt-dlp resolver, for the admin dashboard. */
export function resolveQueueState(): { pending: number; active: number } {
  return { pending: limit.pendingCount, active: limit.activeCount };
}

function startJob(videoId: string, quality: AudioQuality, priority: ResolvePriority): ResolveJob {
  const key = `${videoId}:${quality}`;
  const startedAt = Date.now();
  // eslint-disable-next-line no-console
  console.log(`[audio] ${videoId} (${quality}) — CACHE MISS, queued for yt-dlp (priority: ${priority}, queue depth: ${limit.pendingCount}, active: ${limit.activeCount})`);

  const { promise: raw, handle } = limit.schedule(priority, () => resolveAudioUncached(videoId, quality));
  const promise = raw
    .then(async (audio) => {
      const expiresAt = cacheExpiryMs(audio.url);
      setHot(key, audio, expiresAt);
      try {
        await setCached(videoId, quality, audio, expiresAt);
      } catch (error) {
        // Playback must not fail just because the durable cache write did — the
        // in-memory copy above already serves this process until it expires.
        // eslint-disable-next-line no-console
        console.error(`[audio] ${videoId} (${quality}) — failed to persist to Postgres: ${(error as Error).message}`);
      }
      // eslint-disable-next-line no-console
      console.log(`[audio] ${videoId} (${quality}) — resolved in ${Date.now() - startedAt}ms total`);
      recordResolve(Date.now() - startedAt, true);
      return audio;
    })
    .catch((error: unknown) => {
      if (!(error instanceof ResolveAbortedError)) recordResolve(Date.now() - startedAt, false);
      throw error;
    })
    .finally(() => {
      if (inFlight.get(key) === job) inFlight.delete(key);
    });
  // Every caller gets its own handled copy via abortable(); this one is only so a
  // job dropped after all its callers left never surfaces as an unhandled rejection.
  promise.catch(() => {});

  const job: ResolveJob = { promise, handle, interested: 0 };
  return job;
}

/**
 * `priority` distinguishes a track that's actually about to be heard (the one
 * being loaded/crossfaded to right now — pass 'high') from a track just being
 * speculatively warmed up ahead of time (the resolve-only lookahead prefetch —
 * pass 'low'). Both still share the same single-slot concurrency limiter
 * (unchanged RAM/CPU ceiling); this only changes which one goes first when
 * both are queued at once. See the PriorityLimiter comment above for why.
 *
 * `signal` is the caller's own liveness: abort it when the HTTP request that
 * wanted this track is gone, and a resolve still waiting in line is dropped.
 */
export async function resolveAudio(
  videoId: string,
  quality: AudioQuality,
  priority: ResolvePriority = 'high',
  signal?: AbortSignal,
): Promise<ResolvedAudio> {
  const key = `${videoId}:${quality}`;

  const hot = getHot(key);
  if (hot) return hot;

  const cached = await getCached(videoId, quality);
  if (cached) {
    setHot(key, cached.audio, cached.expiresAt);
    return cached.audio;
  }
  if (signal?.aborted) throw new ResolveAbortedError();

  let job = inFlight.get(key);
  if (job) {
    // eslint-disable-next-line no-console
    console.log(`[audio] ${videoId} (${quality}) — joined in-flight resolve already running`);
    if (priority === 'high') job.handle.promote();
  } else {
    job = startJob(videoId, quality, priority);
    inFlight.set(key, job);
  }

  const joined = job;
  joined.interested += 1;
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    joined.interested -= 1;
    if (joined.interested <= 0) joined.handle.cancel();
  };
  // Stop caring the instant the request goes away, not once the resolve finishes.
  signal?.addEventListener('abort', release, { once: true });
  try {
    return await abortable(joined.promise, signal);
  } finally {
    signal?.removeEventListener('abort', release);
    release();
  }
}

/**
 * Shells out to the yt-dlp Python microservice to resolve a playable audio URL.
 * Using a constantly running Python microservice avoids the massive multi-second
 * cold-start penalty of spawning the yt-dlp CLI and Python VM from scratch for every request.
 */
async function resolveAudioUncached(videoId: string, quality: AudioQuality): Promise<ResolvedAudio> {
  if (Date.now() < breakerOpenUntil) {
    throw new Error(`yt-dlp resolver paused after repeated failures for ${videoId}`);
  }
  try {
    const response = await fetch('http://ytdlp-service:8000/resolve', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ video_id: videoId, quality }),
      signal: AbortSignal.timeout(RESOLVE_TIMEOUT_MS),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`ytdlp-service returned ${response.status}: ${errText}`);
    }

    const data = (await response.json()) as any;
    consecutiveFailures = 0;
    return {
      url: data.url,
      mimeType: data.mimeType,
      httpHeaders: data.httpHeaders,
    };
  } catch (error) {
    consecutiveFailures += 1;
    if (consecutiveFailures >= BREAKER_FAILURES) breakerOpenUntil = Date.now() + BREAKER_OPEN_MS;
    // eslint-disable-next-line no-console
    console.error(`[audio] ${videoId} (${quality}) — yt-dlp microservice FAILED: ${(error as Error).message}`);
    throw new Error(`yt-dlp microservice failed to resolve audio for ${videoId}: ${(error as Error).message}`);
  }
}
