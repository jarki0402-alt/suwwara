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

    const upstreamHeaders: Record<string, string> = {};
    if (rangeHeader) upstreamHeaders.Range = rangeHeader;

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
