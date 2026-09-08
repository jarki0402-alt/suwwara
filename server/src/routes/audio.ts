import { Router, type Request, type Response } from 'express';
import { Readable } from 'node:stream';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import { resolveAudio, type AudioQuality, type ResolvedAudio } from '../youtube/stream';

export const audioRouter = Router();

function parseRangeHeader(header: string): { start: number; end: number | null } | null {
  const match = /^bytes=(\d+)-(\d*)$/.exec(header);
  if (!match) return null;
  return { start: Number(match[1]), end: match[2] ? Number(match[2]) : null };
}

interface FullBufferEntry {
  buffer: Buffer;
  mimeType: string;
  expiresAt: number;
}

// Some resolved googlevideo.com URLs don't honor the HTTP Range header at all and just
// return the entire file with 200 regardless of what byte range was requested. Relaying
// that as-is to a client that explicitly asked for a partial range meant the <audio>
// element received far more data appended past wherever it already was — not new audio,
// a duplicate/misaligned re-send of content it had already played — which is what caused
// currentTime (and this app's own self-correcting duration display) to keep climbing well
// past a track's real length while producing no more audible sound. Mobile browsers hit
// this far more than desktop because they request many small Range chunks throughout
// playback instead of buffering the whole file up front, so every one of those chunk
// requests was a fresh chance to hit the mismatch.
// Cached per resolved audio URL (short-lived, bounded) so once the mismatch is detected
// for a track, subsequent chunk requests slice the already-downloaded buffer instead of
// re-fetching and re-buffering the entire file on every single request.
const FULL_BUFFER_CACHE_TTL_MS = 10 * 60 * 1000;
const fullBufferCache = new Map<string, FullBufferEntry>();

function getCachedBuffer(cacheKey: string): FullBufferEntry | null {
  const entry = fullBufferCache.get(cacheKey);
  if (!entry || entry.expiresAt <= Date.now()) return null;
  return entry;
}

// Both in-memory audio buffer caches below only ever check staleness lazily (on
// read) — nothing ever proactively removes an expired or excess entry. On this
// VM's 1GB RAM, left unchecked that's an unbounded leak: every distinct track
// ever played adds a buffer that sits in memory forever, whether or not it's
// still within its TTL. A cheap periodic sweep plus a hard cap on the windowed
// cache (the one that grows on every single play, not just the rare
// Range-ignoring-upstream edge case) keeps memory bounded regardless of how
// many different songs get played over a long-running container's lifetime.
const MAX_WINDOW_CACHE_ENTRIES = 60; // 60 * WINDOW_SIZE_BYTES (256KB) = 15MB worst case.

function evictExpired<T extends { expiresAt: number }>(cache: Map<string, T>): void {
  const now = Date.now();
  for (const [key, entry] of cache) {
    if (entry.expiresAt <= now) cache.delete(key);
  }
}

interface WindowBufferEntry {
  start: number;
  buffer: Buffer;
  mimeType: string;
  total: string;
  expiresAt: number;
}

// Mobile browsers request audio in many small Range chunks (see fullBufferCache's
// comment above) — measured live against production, each one of those was costing
// ~0.7s because every single chunk re-triggered a fresh fetch to googlevideo.com,
// even for a track whose URL was already resolved and cached. That per-chunk network
// round trip (not client bandwidth) was the actual bottleneck. Fix: whenever we go
// upstream for a Range request, ask for a much bigger window than the client actually
// requested (at typical audio bitrates this covers most of a track in one fetch) and
// cache it — subsequent nearby chunk requests for the same track are then sliced
// straight from memory with zero additional network round trips. What we send back to
// the *client* is still exactly the slice they asked for (same Content-Range/Length as
// before) — only the upstream fetch size changed, so this can't reintroduce the
// duplicate-content WebKit bug that fullBufferCache above exists to guard against.
// We keep the window size relatively small (256KB) instead of 4MB so that Node.js
// doesn't block the client for seconds waiting for a large buffer to download from
// YouTube (especially since YouTube throttles connections to 1x playback speed).
const WINDOW_SIZE_BYTES = 256 * 1024;
const WINDOW_CACHE_TTL_MS = 10 * 60 * 1000;
const windowCache = new Map<string, WindowBufferEntry>();

function getCachedWindow(cacheKey: string): WindowBufferEntry | null {
  const entry = windowCache.get(cacheKey);
  if (!entry || entry.expiresAt <= Date.now()) return null;
  return entry;
}

function sliceFromWindow(window: WindowBufferEntry, range: { start: number; end: number | null }): Buffer {
  const localStart = range.start - window.start;
  const localEnd = range.end !== null ? range.end - window.start : window.buffer.length - 1;
  return window.buffer.subarray(localStart, localEnd + 1);
}

function setCachedWindow(cacheKey: string, entry: WindowBufferEntry): void {
  windowCache.delete(cacheKey); // re-insert so this key becomes the most-recently-set for eviction order below.
  windowCache.set(cacheKey, entry);
  // Map iteration/insertion order means the first key here is the least-recently-set —
  // a good enough approximation of LRU at this scale without extra bookkeeping.
  while (windowCache.size > MAX_WINDOW_CACHE_ENTRIES) {
    const oldestKey = windowCache.keys().next().value;
    if (oldestKey === undefined) break;
    windowCache.delete(oldestKey);
  }
}

// Sweeps both buffer caches every 5 minutes so memory used by tracks nobody's
// listening to anymore gets reclaimed promptly instead of waiting for someone
// to happen to request that exact cache key again after it's already expired.
// unref() so this timer never keeps the process alive on its own (relevant for
// tests and graceful shutdown).
setInterval(() => {
  evictExpired(fullBufferCache);
  evictExpired(windowCache);
}, 5 * 60 * 1000).unref();

function sendRangeFromBuffer(res: Response, entry: FullBufferEntry, range: { start: number; end: number | null }): void {
  const totalLength = entry.buffer.length;
  const start = range.start;
  const end = range.end !== null ? Math.min(range.end, totalLength - 1) : totalLength - 1;

  if (start >= totalLength) {
    res.status(416).setHeader('Content-Range', `bytes */${totalLength}`).end();
    return;
  }

  const slice = entry.buffer.subarray(start, end + 1);
  res.status(206);
  res.setHeader('Content-Type', entry.mimeType);
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.setHeader('Content-Range', `bytes ${start}-${end}/${totalLength}`);
  res.setHeader('Content-Length', String(slice.length));
  res.end(slice);
}

// Backpressure-aware write: without this, a loop that keeps calling res.write()
// as fast as upstream fetches resolve could pile up unbounded amounts of
// unflushed audio in Node's internal buffer if the client (or its network) is
// slower than upstream — a real risk to chase down separately given this app
// runs on a 1GB RAM VM (see the window/full-buffer cache bounding above for the
// same concern). Waiting for 'drain' whenever write() reports its internal
// buffer is full keeps memory bounded by the client's actual consumption rate.
function writeChunk(res: Response, chunk: Buffer): Promise<void> {
  return new Promise((resolve) => {
    if (res.write(chunk)) resolve();
    else res.once('drain', () => resolve());
  });
}

/**
 * Unified chunk-stitching streamer that solves three problems at once:
 * 1. Bypasses YouTube's 30-second anti-bot timeout by making multiple short, bounded (256KB) upstream requests instead of holding one long connection open.
 * 2. Satisfies iOS Safari's range-less probe requests by returning a continuous 200 OK stream.
 * 3. Satisfies iOS Safari's open-ended Range requests (e.g. `bytes=262144-`) by returning a continuous 206 Partial Content stream without truncating it early, which avoids the "audio stops at 30 seconds" bug.
 */
async function streamStitched(
  req: Request,
  res: Response,
  audio: ResolvedAudio,
  cacheKey: string,
  upstreamHeaders: Record<string, string>,
  range: { start: number; end: number | null },
  isRangeLess: boolean
): Promise<void> {
  let aborted = false;
  req.on('close', () => {
    aborted = true;
  });

  let currentStart = range.start;
  const requestedEnd = range.end;
  let totalSize: number | null = null;
  let isFirstResponse = true;

  while (!aborted) {
    let buffer: Buffer;
    let totalStr = '*';

    const cachedWindow = getCachedWindow(cacheKey);
    // Check if currentStart falls within the cached window
    if (cachedWindow && currentStart >= cachedWindow.start && currentStart < cachedWindow.start + cachedWindow.buffer.length) {
      const sliceStart = currentStart - cachedWindow.start;
      buffer = cachedWindow.buffer.subarray(sliceStart);
      totalStr = cachedWindow.total;
    } else {
      const end = requestedEnd !== null 
        ? Math.min(currentStart + WINDOW_SIZE_BYTES - 1, requestedEnd) 
        : currentStart + WINDOW_SIZE_BYTES - 1;
      
      let upstream: globalThis.Response;
      try {
        upstream = await fetch(audio.url, { headers: { ...upstreamHeaders, Range: `bytes=${currentStart}-${end}` } });
      } catch {
        break; // Network hiccup mid-stream
      }

      if (aborted) break;

      if (upstream.status !== 206) {
        // Upstream ignored the Range header completely.
        if (isFirstResponse) {
          const fullBuf = Buffer.from(await upstream.arrayBuffer());
          fullBufferCache.set(cacheKey, { buffer: fullBuf, mimeType: audio.mimeType, expiresAt: Date.now() + FULL_BUFFER_CACHE_TTL_MS });
          if (aborted) return;
          if (isRangeLess) {
            res.status(200);
            res.setHeader('Content-Type', audio.mimeType);
            res.setHeader('Accept-Ranges', 'bytes');
            res.setHeader('Cache-Control', 'public, max-age=3600');
            res.setHeader('Content-Length', String(fullBuf.length));
            res.end(fullBuf);
          } else {
            sendRangeFromBuffer(res, fullBufferCache.get(cacheKey)!, range);
          }
        }
        return;
      }

      buffer = Buffer.from(await upstream.arrayBuffer());
      if (buffer.length === 0) break;

      totalStr = upstream.headers.get('content-range')?.split('/')[1] ?? '*';
      setCachedWindow(cacheKey, { start: currentStart, buffer, mimeType: audio.mimeType, total: totalStr, expiresAt: Date.now() + WINDOW_CACHE_TTL_MS });
    }

    if (totalStr !== '*') totalSize = parseInt(totalStr, 10);

    // If we fetched more than the client requested (e.g. from cache), slice it down.
    if (requestedEnd !== null && currentStart + buffer.length - 1 > requestedEnd) {
      buffer = buffer.subarray(0, requestedEnd - currentStart + 1);
    }

    if (isFirstResponse) {
      const finalEnd = requestedEnd !== null ? requestedEnd : (totalSize !== null ? totalSize - 1 : '*');
      const contentLength = totalSize !== null 
        ? (requestedEnd !== null ? requestedEnd - range.start + 1 : totalSize - range.start)
        : null;

      if (isRangeLess) {
        res.status(200);
        if (contentLength !== null) res.setHeader('Content-Length', String(contentLength));
      } else {
        res.status(206);
        res.setHeader('Content-Range', `bytes ${range.start}-${finalEnd}/${totalStr}`);
        if (contentLength !== null) res.setHeader('Content-Length', String(contentLength));
      }

      res.setHeader('Content-Type', audio.mimeType);
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Cache-Control', 'public, max-age=3600');
      isFirstResponse = false;
    }

    await writeChunk(res, buffer);
    currentStart += buffer.length;

    if (requestedEnd !== null && currentStart > requestedEnd) break;
    if (totalSize !== null && currentStart >= totalSize) break;
  }

  if (!aborted) res.end();
}

/**
 * Resolves (and caches) the playable URL for a track without streaming any
 * audio bytes — called by the frontend as soon as the *current* track starts
 * playing, to resolve the *next* queued track ahead of time in the
 * background. yt-dlp resolution (opening the watch page, deciphering the
 * signature) takes a few seconds; doing that speculatively while the current
 * song is still playing is what removes the multi-second buffering spinner
 * that otherwise shows up right when the user hits "next".
 */
audioRouter.get('/audio/:videoId/resolve', async (req, res) => {
  const { videoId } = req.params;
  const quality: AudioQuality = req.query.quality === 'low' ? 'low' : 'high';

  try {
    await resolveAudio(videoId, quality);
    res.status(204).end();
  } catch (error) {
    res.status(502).json({ error: 'Failed to resolve audio.', message: (error as Error).message });
  }
});

audioRouter.get('/audio/:videoId', async (req, res) => {
  const { videoId } = req.params;
  const quality: AudioQuality = req.query.quality === 'low' ? 'low' : 'high';
  const cacheKey = `${videoId}:${quality}`;

  try {
    const audio = await resolveAudio(videoId, quality);
    const rangeHeader = req.headers.range;
    // If no Range header, we default to starting from 0 (open-ended).
    const range = rangeHeader ? (parseRangeHeader(rangeHeader) ?? { start: 0, end: null }) : { start: 0, end: null };
    const isRangeLess = !rangeHeader;

    // Already know upstream ignores Range for this track? Slice from full buffer.
    const cachedBuffer = getCachedBuffer(cacheKey);
    if (cachedBuffer) {
      if (!isRangeLess) {
        sendRangeFromBuffer(res, cachedBuffer, range);
      } else {
        res.status(200);
        res.setHeader('Content-Type', cachedBuffer.mimeType);
        res.setHeader('Accept-Ranges', 'bytes');
        res.setHeader('Cache-Control', 'public, max-age=3600');
        res.setHeader('Content-Length', String(cachedBuffer.buffer.length));
        res.end(cachedBuffer.buffer);
      }
      return;
    }

    const upstreamHeaders: Record<string, string> = {
      ...(audio.httpHeaders || {}),
    };
    if (!upstreamHeaders['User-Agent']) {
      upstreamHeaders['User-Agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
    }

    await streamStitched(req, res, audio, cacheKey, upstreamHeaders, range, isRangeLess);
  } catch (error) {
    res.status(502).json({ error: 'Failed to resolve/proxy audio.', message: (error as Error).message });
  }
});
