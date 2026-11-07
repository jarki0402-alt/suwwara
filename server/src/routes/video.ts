import { Router, type Response } from 'express';
import { recordVideo } from '../metrics/usage';
import { ResolveAbortedError, type ResolvedStream } from '../youtube/stream';
import { findMusicVideo, forgetVideo, resolveVideo, type VideoHeight } from '../youtube/video';

/**
 * Music videos. The picture is proxied the same way audio is (googlevideo links are IP-locked to this server), but
 * kept deliberately separate from routes/audio.ts so it can never crowd the audio out:
 * - its own small chunk cache (12MB), never the audio one: that is 40MB for ~10 songs and one 720p MV is ~30MB, so
 *   video there would evict the songs. It exists for WebKit (every iPhone browser), which opens a video as a chain of
 *   Range requests it keeps cancelling and re-issuing at nearby offsets: without it each one paid a fresh upstream
 *   round trip and the first frame took ~9s, with it the re-asks are answered from memory;
 * - at most MAX_STREAMS video responses at once on the whole server, each holding at most two 1MB chunks;
 * - the yt-dlp resolve waits in the 'idle' lane behind every song (youtube/video.ts);
 * - VIDEO_ENABLED=false in .env turns the whole feature off: /match answers "no video", so the button never shows.
 */
export const videoRouter = Router();

const VIDEO_ENABLED = process.env.VIDEO_ENABLED !== 'false';
const MAX_STREAMS = 6;
// Bigger than audio's 256KB: at ~0.9 Mbps for 720p a 256KB chunk is ~2s of picture, and every chunk is one upstream
// round trip. 1MB keeps the request count low while each upstream request still stays short (YouTube cuts long ones).
const CHUNK_SIZE = 1024 * 1024;
const UPSTREAM_TIMEOUT_MS = 20_000;
const MAX_URL_REFRESHES = 1;
// 12 x 1MB. Short-lived: it only has to outlast one burst of re-asks and the read-ahead, not a whole video.
const MAX_CACHED_CHUNKS = 12;
const CHUNK_TTL_MS = 3 * 60 * 1000;
let activeStreams = 0;

const chunkCache = new Map<string, Chunk & { expiresAt: number }>();
const chunkFetches = new Map<string, Promise<Chunk>>();

setInterval(() => {
  const now = Date.now();
  for (const [key, chunk] of chunkCache) if (chunk.expiresAt <= now) chunkCache.delete(key);
}, 60 * 1000).unref();

function rememberChunk(key: string, chunk: Chunk): void {
  chunkCache.delete(key);
  chunkCache.set(key, { ...chunk, expiresAt: Date.now() + CHUNK_TTL_MS });
  while (chunkCache.size > MAX_CACHED_CHUNKS) {
    const oldest = chunkCache.keys().next().value;
    if (oldest === undefined) break;
    chunkCache.delete(oldest);
  }
}

function parseRange(header: string | undefined): { start: number; end: number | null } {
  const match = header ? /^bytes=(\d+)-(\d*)$/.exec(header) : null;
  if (!match) return { start: 0, end: null };
  return { start: Number(match[1]), end: match[2] ? Number(match[2]) : null };
}

function writeChunk(res: Response, chunk: Buffer): Promise<void> {
  return new Promise((resolve) => {
    if (res.write(chunk)) resolve();
    else res.once('drain', () => resolve());
  });
}

interface Chunk {
  buffer: Buffer;
  total: number;
}

class UpstreamGoneError extends Error {}

async function fetchChunk(stream: ResolvedStream, start: number, end: number): Promise<Chunk> {
  const headers: Record<string, string> = { ...(stream.httpHeaders ?? {}), Range: `bytes=${start}-${end}` };
  const upstream = await fetch(stream.url, { headers, signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) });
  if (upstream.status === 403 || upstream.status === 404 || upstream.status === 410) {
    await upstream.body?.cancel().catch(() => {});
    throw new UpstreamGoneError(`upstream answered ${upstream.status}`);
  }
  if (upstream.status !== 206) {
    // A 200 would be the whole file: never buffered here (it's tens of MB), the request just fails.
    await upstream.body?.cancel().catch(() => {});
    throw new Error(`unexpected upstream status ${upstream.status}`);
  }
  const total = Number(upstream.headers.get('content-range')?.split('/')[1]);
  if (!Number.isFinite(total) || total <= 0) throw new Error('upstream did not report the file size');
  // Bounded: at most CHUNK_SIZE, the Range asked for.
  return { buffer: Buffer.from(await upstream.arrayBuffer()), total };
}

interface ChunkSource {
  getChunk: (index: number) => Promise<Chunk>;
  mimeType: () => string;
}

/** Aligned 1MB chunks of one video, shared across requests: concurrent and repeated asks cost one upstream fetch. */
async function openChunkSource(videoId: string, height: VideoHeight, signal: AbortSignal): Promise<ChunkSource> {
  let stream = await resolveVideo(videoId, height, signal);
  let refreshes = 0;
  // One retry with a freshly resolved link when the cached one died (expired early, IP changed).
  const fetchAligned = async (index: number): Promise<Chunk> => {
    for (;;) {
      try {
        return await fetchChunk(stream, index * CHUNK_SIZE, index * CHUNK_SIZE + CHUNK_SIZE - 1);
      } catch (error) {
        if (!(error instanceof UpstreamGoneError) || refreshes >= MAX_URL_REFRESHES) throw error;
        refreshes += 1;
        forgetVideo(videoId, height, stream.url);
        stream = await resolveVideo(videoId, height, signal);
      }
    }
  };
  const getChunk = (index: number): Promise<Chunk> => {
    const key = `${videoId}:${height}:${index}`;
    const cached = chunkCache.get(key);
    if (cached && cached.expiresAt > Date.now()) return Promise.resolve(cached);
    const pending = chunkFetches.get(key);
    if (pending) return pending;
    const fetching = fetchAligned(index)
      .then((chunk) => {
        rememberChunk(key, chunk);
        return chunk;
      })
      .finally(() => chunkFetches.delete(key));
    fetching.catch(() => {});
    chunkFetches.set(key, fetching);
    return fetching;
  };
  return { getChunk, mimeType: () => stream.mimeType || 'video/mp4' };
}

/**
 * Safari (every iPhone browser, and Safari on the Mac) as HLS: a playlist over byte ranges of the very same MP4 file,
 * built from the file's own segment index (its sidx box). Played as a plain MP4, WebKit has to walk the whole file to
 * find a time in YouTube's fragmented MP4 (measured: ~20 Range requests, ~5s to the first frame); with this playlist it
 * fetches the init part and the one fragment it needs. No remuxing: the segments are byte ranges served by the
 * /video/:id route above, so nothing about the file changes.
 */
export function buildHlsPlaylist(head: Buffer, mediaUrl: string): string | null {
  let offset = 0;
  while (offset + 8 <= head.length) {
    const size = head.readUInt32BE(offset);
    const type = head.toString('latin1', offset + 4, offset + 8);
    if (size < 8) return null;
    if (type !== 'sidx') {
      offset += size;
      continue;
    }
    if (offset + size > head.length) return null;
    const version = head.readUInt8(offset + 8);
    let at = offset + 12 + 4; // version/flags, reference_ID
    const timescale = head.readUInt32BE(at);
    at += 4;
    let firstOffset: number;
    if (version === 0) {
      firstOffset = head.readUInt32BE(at + 4);
      at += 8;
    } else {
      firstOffset = Number(head.readBigUInt64BE(at + 8));
      at += 16;
    }
    const count = head.readUInt16BE(at + 2);
    at += 4;
    const initLength = offset; // ftyp + moov: everything before the index
    let segmentStart = offset + size + firstOffset;
    const segments: string[] = [];
    let longest = 0;
    for (let i = 0; i < count; i += 1) {
      const reference = head.readUInt32BE(at);
      const length = reference & 0x7fffffff;
      const duration = head.readUInt32BE(at + 4) / timescale;
      at += 12;
      if (reference & 0x80000000) return null; // a nested index: not what YouTube writes, don't guess
      longest = Math.max(longest, duration);
      segments.push(`#EXTINF:${duration.toFixed(3)},\n#EXT-X-BYTERANGE:${length}@${segmentStart}\n${mediaUrl}`);
      segmentStart += length;
    }
    if (segments.length === 0) return null;
    return [
      '#EXTM3U',
      '#EXT-X-VERSION:7',
      '#EXT-X-PLAYLIST-TYPE:VOD',
      `#EXT-X-TARGETDURATION:${Math.ceil(longest)}`,
      `#EXT-X-MAP:URI="${mediaUrl}",BYTERANGE="${initLength}@0"`,
      ...segments,
      '#EXT-X-ENDLIST',
      '',
    ].join('\n');
  }
  return null;
}

videoRouter.get('/video/:videoId/hls.m3u8', async (req, res) => {
  if (!VIDEO_ENABLED) {
    res.status(404).end();
    return;
  }
  const { videoId } = req.params;
  const height: VideoHeight = req.query.h === '480' ? '480' : '720';
  const gone = new AbortController();
  res.once('close', () => gone.abort());
  try {
    const source = await openChunkSource(videoId, height, gone.signal);
    const head = await source.getChunk(0);
    const playlist = buildHlsPlaylist(head.buffer, `/api/video/${encodeURIComponent(videoId)}?h=${height}`);
    if (!playlist) {
      // No usable index (the 360p fallback file has none): the client plays the MP4 directly instead.
      res.status(415).json({ error: 'no segment index' });
      return;
    }
    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
    res.setHeader('Cache-Control', 'private, max-age=600');
    res.send(playlist);
  } catch (error) {
    if (error instanceof ResolveAbortedError || gone.signal.aborted) return;
    res.status(502).json({ error: 'Failed to load the music video.', message: (error as Error).message });
  }
});

videoRouter.get('/video/match/:songId', async (req, res) => {
  if (!VIDEO_ENABLED) {
    res.json({ video: null });
    return;
  }
  const title = typeof req.query.title === 'string' ? req.query.title.slice(0, 200) : '';
  const artist = typeof req.query.artist === 'string' ? req.query.artist.slice(0, 200) : '';
  const durationSec = Number(req.query.duration) || 0;
  if (!title || !artist) {
    res.status(400).json({ error: 'title and artist are required' });
    return;
  }
  try {
    const video = await findMusicVideo({ id: req.params.songId, title, artist, durationSec });
    // The match barely changes: let the browser keep it for a while too.
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.json({ video });
  } catch (error) {
    res.status(502).json({ error: 'Failed to look up the music video.', message: (error as Error).message });
  }
});

videoRouter.get('/video/:videoId', async (req, res) => {
  if (!VIDEO_ENABLED) {
    res.status(404).end();
    return;
  }
  if (activeStreams >= MAX_STREAMS) {
    // The player retries on its own; this only ever happens when several people watch at the same moment.
    res.status(503).setHeader('Retry-After', '2').end();
    return;
  }
  activeStreams += 1;

  const { videoId } = req.params;
  const height: VideoHeight = req.query.h === '480' ? '480' : '720';
  const gone = new AbortController();
  const socket = res.socket;
  const bytesBefore = socket?.bytesWritten ?? 0;
  const accountId = req.session?.accountId;
  res.once('close', () => {
    activeStreams -= 1;
    gone.abort();
    recordVideo(accountId, (socket?.bytesWritten ?? 0) - bytesBefore);
  });

  try {
    const source = await openChunkSource(videoId, height, gone.signal);
    const { getChunk } = source;

    const range = parseRange(req.headers.range);
    const firstIndex = Math.floor(range.start / CHUNK_SIZE);
    const first = await getChunk(firstIndex);
    const total = first.total;
    const last = range.end !== null ? Math.min(range.end, total - 1) : total - 1;
    if (range.start >= total || last < range.start) {
      res.status(416).setHeader('Content-Range', `bytes */${total}`).end();
      return;
    }

    res.status(req.headers.range ? 206 : 200);
    if (req.headers.range) res.setHeader('Content-Range', `bytes ${range.start}-${last}/${total}`);
    res.setHeader('Content-Length', String(last - range.start + 1));
    res.setHeader('Content-Type', source.mimeType());
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'private, max-age=3600');

    let position = range.start;
    while (position <= last && !gone.signal.aborted) {
      const index = Math.floor(position / CHUNK_SIZE);
      const chunk = index === firstIndex ? first : await getChunk(index);
      if (gone.signal.aborted) return;
      if (chunk.total !== total) {
        res.destroy(); // re-resolved to a different file mid-response: never splice two files
        return;
      }
      // One chunk ahead while this one goes out: the upstream round trip overlaps the client's download.
      if ((index + 1) * CHUNK_SIZE <= last) getChunk(index + 1).catch(() => {});
      const offset = position - index * CHUNK_SIZE;
      const piece = chunk.buffer.subarray(offset, Math.min(chunk.buffer.length, last - index * CHUNK_SIZE + 1));
      if (piece.length === 0) {
        res.destroy();
        return;
      }
      await writeChunk(res, piece);
      position += piece.length;
    }
    if (!gone.signal.aborted) res.end();
  } catch (error) {
    if (error instanceof ResolveAbortedError || gone.signal.aborted) return;
    if (res.headersSent) {
      res.destroy();
      return;
    }
    res.status(502).json({ error: 'Failed to load the music video.', message: (error as Error).message });
  }
});
