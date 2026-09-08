import { Router, type Response } from 'express';
import { Readable } from 'node:stream';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import { resolveAudio, type AudioQuality } from '../youtube/stream';

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

/**
 * Proxies (not redirects to) the resolved googlevideo.com audio bytes.
 * This matters for two reasons: (1) those URLs are commonly IP-locked to
 * whichever server resolved them, so the browser fetching them directly
 * would get a 403; (2) it keeps CORS simple since the browser only ever
 * talks to our own origin. Range requests are forwarded upstream and the
 * upstream's 206/Content-Range response is relayed back so <audio> seeking
 * works correctly.
 */
audioRouter.get('/audio/:videoId', async (req, res) => {
  const { videoId } = req.params;
  const quality: AudioQuality = req.query.quality === 'low' ? 'low' : 'high';
  const cacheKey = `${videoId}:${quality}`;

  try {
    const audio = await resolveAudio(videoId, quality);
    const rangeHeader = req.headers.range;
    const range = rangeHeader ? parseRangeHeader(rangeHeader) : null;

    // Already know upstream ignores Range for this track (detected on an earlier
    // request) — slice straight from the cached full buffer instead of re-fetching.
    const cachedBuffer = getCachedBuffer(cacheKey);
    if (cachedBuffer && range) {
      sendRangeFromBuffer(res, cachedBuffer, range);
      return;
    }

    // Already have a window covering this exact range from an earlier chunk request
    // for this track — serve it straight from memory, no upstream fetch at all.
    const cachedWindow = getCachedWindow(cacheKey);
    if (cachedWindow && range) {
      const windowEnd = cachedWindow.start + cachedWindow.buffer.length - 1;
      const requestedEnd = range.end ?? range.start;
      if (range.start >= cachedWindow.start && requestedEnd <= windowEnd) {
        const slice = sliceFromWindow(cachedWindow, range);
        res.status(206);
        res.setHeader('Content-Type', cachedWindow.mimeType);
        res.setHeader('Accept-Ranges', 'bytes');
        res.setHeader('Cache-Control', 'public, max-age=3600');
        res.setHeader('Content-Range', `bytes ${range.start}-${range.start + slice.length - 1}/${cachedWindow.total}`);
        res.setHeader('Content-Length', String(slice.length));
        res.end(slice);
        return;
      }
    }

    const upstreamHeaders: Record<string, string> = {
      // YouTube commonly ignores Range requests and serves the full file as 200 OK
      // if the request looks like a bot (e.g. Node.js default fetch User-Agent).
      // Spoofing a real browser ensures we get the 206 Partial Content we asked for.
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    };
    // Ask upstream for a much bigger window starting at the requested byte than the
    // client itself asked for (see windowCache's comment) — the client still only
    // gets back the slice it actually requested, below.
    if (rangeHeader && range) {
      upstreamHeaders.Range = `bytes=${range.start}-${range.start + WINDOW_SIZE_BYTES - 1}`;
    } else if (rangeHeader) {
      upstreamHeaders.Range = rangeHeader;
    }

    const upstream = await fetch(audio.url, { headers: upstreamHeaders });

    // Mismatch: we asked for a specific byte range but upstream sent the whole file
    // back anyway (200, not 206) — see the comment above fullBufferCache for why this
    // can't just be relayed as-is. Buffer it once, cache it, and serve exactly the
    // slice the client actually asked for.
    if (range && upstream.status !== 206) {
      const buffer = Buffer.from(await upstream.arrayBuffer());
      const entry: FullBufferEntry = { buffer, mimeType: audio.mimeType, expiresAt: Date.now() + FULL_BUFFER_CACHE_TTL_MS };
      fullBufferCache.set(cacheKey, entry);
      sendRangeFromBuffer(res, entry, range);
      return;
    }

    // Upstream honored the (widened) Range and sent back a proper window — cache it,
    // then fall through to send the client exactly the slice it originally asked for.
    if (range && upstream.status === 206) {
      const buffer = Buffer.from(await upstream.arrayBuffer());
      const total = upstream.headers.get('content-range')?.split('/')[1] ?? '*';
      setCachedWindow(cacheKey, { start: range.start, buffer, mimeType: audio.mimeType, total, expiresAt: Date.now() + WINDOW_CACHE_TTL_MS });
      const requestedEnd = range.end !== null ? Math.min(range.end, range.start + buffer.length - 1) : range.start + buffer.length - 1;
      const slice = buffer.subarray(0, requestedEnd - range.start + 1);
      res.status(206);
      res.setHeader('Content-Type', audio.mimeType);
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Cache-Control', 'public, max-age=3600');
      res.setHeader('Content-Range', `bytes ${range.start}-${requestedEnd}/${total}`);
      res.setHeader('Content-Length', String(slice.length));
      res.end(slice);
      return;
    }

    res.status(upstream.status);
    res.setHeader('Content-Type', audio.mimeType);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'public, max-age=3600');

    const contentRange = upstream.headers.get('content-range');
    if (contentRange) res.setHeader('Content-Range', contentRange);
    const contentLength = upstream.headers.get('content-length');
    if (contentLength) res.setHeader('Content-Length', contentLength);

    if (!upstream.body) {
      res.end();
      return;
    }

    const nodeStream = Readable.fromWeb(upstream.body as unknown as WebReadableStream);
    nodeStream.pipe(res);
    req.on('close', () => nodeStream.destroy());
  } catch (error) {
    res.status(502).json({ error: 'Failed to resolve/proxy audio.', message: (error as Error).message });
  }
});
