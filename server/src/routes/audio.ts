import { Router, type Response } from 'express';
import { recordAudio } from '../metrics/usage';
import { getCachedTrack, openTrackStream, storeTrack, type CachedTrack } from '../youtube/diskCache';
import { invalidateAudio, resolveAudio, ResolveAbortedError, type AudioQuality, type ResolvedAudio } from '../youtube/stream';

// The resolve-only route below exists purely to warm the cache for a track
// nobody's about to hear yet (frontend's lookahead prefetch); the plain audio
// route is always either the track actually loading/crossfading right now, or
// the very next one (natively preloaded by the <audio> element — see
// AudioEngine.preloadNextTrack). See resolveAudio's own priority param and the
// PriorityLimiter comment in youtube/stream.ts for what this changes.
const RESOLVE_ONLY_PRIORITY = 'low';
const PLAYBACK_PRIORITY = 'high';

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
// This path only triggers for the rare upstream-ignores-Range case (unlike the
// chunk cache below, which grows on every single play), but nothing stopped
// it from growing unbounded between sweeps if several different tracks hit
// that edge case within the same 5-minute window — a hard cap closes that gap
// the same way the chunk cache's already does.
const MAX_FULL_BUFFER_CACHE_ENTRIES = 20;
const fullBufferCache = new Map<string, FullBufferEntry>();

function getCachedBuffer(cacheKey: string): FullBufferEntry | null {
  const entry = fullBufferCache.get(cacheKey);
  if (!entry || entry.expiresAt <= Date.now()) return null;
  return entry;
}

function setCachedBuffer(cacheKey: string, entry: FullBufferEntry): void {
  fullBufferCache.delete(cacheKey); // re-insert so this key becomes the most-recently-set for eviction order below.
  fullBufferCache.set(cacheKey, entry);
  while (fullBufferCache.size > MAX_FULL_BUFFER_CACHE_ENTRIES) {
    const oldestKey = fullBufferCache.keys().next().value;
    if (oldestKey === undefined) break;
    fullBufferCache.delete(oldestKey);
  }
}

// Every in-memory audio cache in this file is bounded by a hard entry cap AND swept
// periodically — never just TTL-checked lazily on read. On this VM's 1GB RAM a lazy-only
// cache leaks: every distinct track ever played would leave a buffer in memory forever,
// whether or not it is still within its TTL. The keys come from an unbounded input
// (video ids), so the cap is what actually guarantees the ceiling.
function evictExpired<T extends { expiresAt: number }>(cache: Map<string, T>): void {
  const now = Date.now();
  for (const [key, entry] of cache) {
    if (entry.expiresAt <= now) cache.delete(key);
  }
}

/** Slices a range out of a fully buffered file — only used for the rare upstream that ignores
 * Range (see fullBufferCache above). */
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


// ---------------------------------------------------------------------------------------
// Chunk cache: the heart of how audio bytes reach the client.
//
// googlevideo is only ever asked for fixed, aligned 256KB chunks (this also keeps every
// upstream request short and bounded, which is what gets around YouTube's anti-bot cutoff
// of long-lived connections). The client, on the other hand, asks for whatever it likes —
// and iOS asks for a LOT. Measured in WebKit: one tap on a song produced a chain of ~14
// small Range requests (`bytes=0-1`, then `147456-...`, `311296-...`, `16384-147455`, ...),
// each one cancelled and re-issued at the next offset, playback only starting once nearly
// the whole file had been read. Every one of those is a client<->server round trip (on a
// phone, 100ms+ each), so the *server side* of each must cost ~nothing.
//
// The previous cache kept ONE 256KB window per track, so WebKit's scattered offsets missed
// it nearly every time and each request paid a fresh upstream round trip (~0.7s measured).
// Now any chunk of any track can be cached, concurrent requests for the same chunk share
// one upstream fetch, the chunks right after the one being served are fetched ahead of time,
// and the rest of a small file is pulled in the background as soon as anyone asks for it —
// by the time the client's next request arrives, the answer is already in memory.
//
// Bounded: 160 chunks * 256KB = 40MB worst case, oldest-inserted evicted first, plus a sweep.
// ---------------------------------------------------------------------------------------
const CHUNK_SIZE = 256 * 1024;
const CHUNK_TTL_MS = 10 * 60 * 1000;
const MAX_CHUNK_CACHE_ENTRIES = 160;
// How many chunks past the one being served to fetch ahead of the client.
const READ_AHEAD_CHUNKS = 2;
// Background whole-file warm-up: only for files small enough that holding one in the chunk
// cache is fine (a typical 4-minute track is 3-5MB), and never more than this many at once
// so a burst of skips can't turn into a burst of downloads on a 1-vCPU VM.
const WARM_MAX_FILE_BYTES = 16 * 1024 * 1024;
const MAX_CONCURRENT_WARMS = 2;
// Chunks fetched at the same time within one warm-up. A track being played right now gets more
// than a background preload: what limits how soon iOS starts playing is how fast the first
// couple of megabytes arrive, and each chunk is a short network-bound request.
const WARM_PARALLELISM_PLAYBACK = 6;
const WARM_PARALLELISM_PRELOAD = 2;
// Every outgoing fetch needs an explicit timeout (see CLAUDE.md) — one 256KB chunk normally
// takes well under a second, so this is only the backstop for a wedged socket.
const UPSTREAM_CHUNK_TIMEOUT_MS = 20000;
// Ceiling for the rare "upstream ignored Range and sent the whole file" case.
const MAX_FULL_BODY_BYTES = 32 * 1024 * 1024;
// How many times one chunk fetch may swap in a freshly resolved URL when googlevideo answers
// 403/404/410 for the cached one. Once, deliberately: if the brand-new URL is refused too
// the problem isn't a stale link, and retrying would only loop.
const MAX_URL_REFRESHES_PER_FETCH = 1;
// Same idea for a plain network failure/timeout on a chunk: one more attempt, no more.
const MAX_NETWORK_RETRIES_PER_FETCH = 1;
// A request slower than this is worth a log line (see the close handler in the route).
const SLOW_TTFB_MS = 1500;
const SLOW_TOTAL_MS = 8000;

interface Chunk {
  buffer: Buffer;
  /** Total size of the whole file as reported by upstream's Content-Range. */
  total: number | null;
  mimeType: string;
  expiresAt: number;
}

interface TrackContext {
  videoId: string;
  quality: AudioQuality;
  cacheKey: string;
  audio: ResolvedAudio;
  /** 'high' = a track being loaded to play right now; 'low' = the spare element's background preload. */
  priority: 'high' | 'low';
}

class UpstreamIgnoresRangeError extends Error {}
class RangeNotSatisfiableError extends Error {}

const chunkCache = new Map<string, Chunk>();
const chunkFetches = new Map<string, Promise<Chunk>>();
const trackTotals = new Map<string, number>();
const warming = new Set<string>();

setInterval(() => {
  evictExpired(fullBufferCache);
  evictExpired(chunkCache);
}, 5 * 60 * 1000).unref();

function buildUpstreamHeaders(resolved: ResolvedAudio): Record<string, string> {
  const headers: Record<string, string> = { ...(resolved.httpHeaders || {}) };
  if (!headers['User-Agent']) {
    headers['User-Agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
  }
  return headers;
}

function dropTrackChunks(cacheKey: string): void {
  for (const key of chunkCache.keys()) {
    if (key.startsWith(`${cacheKey}#`)) chunkCache.delete(key);
  }
}

function rememberChunk(cacheKey: string, key: string, chunk: Chunk): void {
  // A re-resolve can land on a different file (another format/bitrate). Chunks from two
  // different files must never be mixed into one response, so a size change wipes the
  // track's chunks and starts over.
  if (chunk.total !== null) {
    const known = trackTotals.get(cacheKey);
    if (known !== undefined && known !== chunk.total) dropTrackChunks(cacheKey);
    trackTotals.set(cacheKey, chunk.total);
    if (trackTotals.size > MAX_CHUNK_CACHE_ENTRIES) {
      const oldest = trackTotals.keys().next().value;
      if (oldest !== undefined) trackTotals.delete(oldest);
    }
  }
  chunkCache.delete(key); // re-insert so this key becomes the most-recently-set for eviction order below.
  chunkCache.set(key, chunk);
  while (chunkCache.size > MAX_CHUNK_CACHE_ENTRIES) {
    const oldestKey = chunkCache.keys().next().value;
    if (oldestKey === undefined) break;
    chunkCache.delete(oldestKey);
  }
}

async function readBodyCapped(body: ReadableStream<Uint8Array> | null, maxBytes: number): Promise<Buffer> {
  if (!body) return Buffer.alloc(0);
  const parts: Buffer[] = [];
  let size = 0;
  for await (const part of body as unknown as AsyncIterable<Uint8Array>) {
    size += part.length;
    if (size > maxBytes) throw new Error(`upstream body exceeded ${maxBytes} bytes`);
    parts.push(Buffer.from(part));
  }
  return Buffer.concat(parts);
}

async function fetchChunkUpstream(ctx: TrackContext, index: number): Promise<Chunk> {
  const start = index * CHUNK_SIZE;
  const end = start + CHUNK_SIZE - 1;

  let refreshes = 0;
  let networkRetries = 0;
  for (;;) {
    let upstream: globalThis.Response;
    try {
      upstream = await fetch(ctx.audio.url, {
        headers: { ...buildUpstreamHeaders(ctx.audio), Range: `bytes=${start}-${end}` },
        signal: AbortSignal.timeout(UPSTREAM_CHUNK_TIMEOUT_MS),
      });
    } catch (error) {
      // A dropped connection or a timeout on one 256KB chunk is usually momentary. Failing
      // here cuts the whole client response (see the catch in the route), which an iPhone
      // reports as a media error and the app then treats as a broken track — so give it one
      // more try before letting a blip turn into a skipped song.
      if (networkRetries < MAX_NETWORK_RETRIES_PER_FETCH) {
        networkRetries += 1;
        // eslint-disable-next-line no-console
        console.warn(`[audio] ${ctx.cacheKey} — chunk at byte ${start} failed (${(error as Error).message}), retrying`);
        continue;
      }
      throw error;
    }

    if (upstream.status === 206) {
      const buffer = Buffer.from(await upstream.arrayBuffer());
      const totalPart = upstream.headers.get('content-range')?.split('/')[1];
      const total = totalPart && totalPart !== '*' ? parseInt(totalPart, 10) : null;
      return { buffer, total, mimeType: ctx.audio.mimeType, expiresAt: Date.now() + CHUNK_TTL_MS };
    }

    if (upstream.status === 416) {
      await upstream.body?.cancel().catch(() => {});
      throw new RangeNotSatisfiableError();
    }

    if (upstream.status === 403 || upstream.status === 404 || upstream.status === 410) {
      // The resolved link stopped working — sometimes only *partway* through the file (a link
      // that serves the first ~1MiB and then answers 403 was seen in practice, which used to
      // cut playback off about a minute in, or hang the response forever). Swap in a freshly
      // resolved URL and carry on from the very same byte: the client never notices.
      // eslint-disable-next-line no-console
      console.warn(`[audio] ${ctx.cacheKey} — upstream answered ${upstream.status} for the chunk at byte ${start}${refreshes < MAX_URL_REFRESHES_PER_FETCH ? ', re-resolving' : ', giving up'}`);
      await upstream.body?.cancel().catch(() => {});
      if (refreshes >= MAX_URL_REFRESHES_PER_FETCH) throw new Error(`upstream answered ${upstream.status}`);
      refreshes += 1;
      await invalidateAudio(ctx.videoId, ctx.quality, ctx.audio.url);
      // Playback priority: this repairs a track someone is hearing right now. No abort
      // signal on purpose — the fetch is shared with other requests and read-ahead.
      ctx.audio = await resolveAudio(ctx.videoId, ctx.quality, PLAYBACK_PRIORITY);
      continue;
    }

    if (upstream.status === 200) {
      // Upstream ignored the Range header and is sending the whole file. Relaying that to a
      // client that asked for a slice made the <audio> element receive far more data than
      // it asked for — a misaligned duplicate of audio it had already played — which is what
      // once made currentTime run minutes past a track's real length. Keep the whole file
      // (capped) and slice from it instead.
      // eslint-disable-next-line no-console
      console.warn(`[audio] ${ctx.cacheKey} — upstream ignores Range, buffering the whole file`);
      const buffer = await readBodyCapped(upstream.body, MAX_FULL_BODY_BYTES);
      setCachedBuffer(ctx.cacheKey, { buffer, mimeType: ctx.audio.mimeType, expiresAt: Date.now() + FULL_BUFFER_CACHE_TTL_MS });
      throw new UpstreamIgnoresRangeError();
    }

    await upstream.body?.cancel().catch(() => {});
    throw new Error(`unexpected upstream status ${upstream.status}`);
  }
}

function getChunk(ctx: TrackContext, index: number): Promise<Chunk> {
  const key = `${ctx.cacheKey}#${index}`;
  const cached = chunkCache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    chunkCache.delete(key);
    chunkCache.set(key, cached); // keep recently-used chunks at the young end of the eviction order
    return Promise.resolve(cached);
  }

  const pending = chunkFetches.get(key);
  if (pending) return pending; // someone is already fetching exactly this chunk — share it

  const fetching = fetchChunkUpstream(ctx, index)
    .then((chunk) => {
      rememberChunk(ctx.cacheKey, key, chunk);
      return chunk;
    })
    .finally(() => {
      chunkFetches.delete(key);
    });
  chunkFetches.set(key, fetching);
  // Read-ahead calls fire and forget; this keeps a failed one from becoming an unhandled rejection.
  fetching.catch(() => {});
  return fetching;
}

function readAhead(ctx: TrackContext, fromIndex: number, total: number): void {
  for (let step = 1; step <= READ_AHEAD_CHUNKS; step += 1) {
    const index = fromIndex + step;
    if (index * CHUNK_SIZE >= total) return;
    getChunk(ctx, index).catch(() => {});
  }
}

/** Pulls the rest of a small file into the chunk cache in the background. Fetched a few chunks
 * at a time (each one is a short, network-bound request to googlevideo, so this costs the VM
 * almost no CPU) and in the order the iOS media loader actually asks for them: the head, then
 * the very end of the file — where MP4's index lives, and which WebKit reads right after its
 * first probe — then everything in between. One chunk at a time was too slow to stay ahead of
 * WebKit: it consumed chunks about as fast as a single upstream round trip produced them, so
 * every request of its chain ended up waiting on a fresh fetch. */
function warmTrack(ctx: TrackContext, total: number): void {
  if (total > WARM_MAX_FILE_BYTES || warming.has(ctx.cacheKey) || warming.size >= MAX_CONCURRENT_WARMS) return;
  warming.add(ctx.cacheKey);

  const count = Math.ceil(total / CHUNK_SIZE);
  const order: number[] = [0];
  if (count > 1) order.push(count - 1);
  for (let index = 1; index < count - 1; index += 1) order.push(index);

  let cursor = 0;
  const worker = async (): Promise<void> => {
    while (cursor < order.length) {
      const index = order[cursor];
      cursor += 1;
      // best-effort — a chunk that fails here is simply fetched on demand when someone asks
      await getChunk(ctx, index).catch(() => {});
    }
  };
  const parallelism = ctx.priority === 'high' ? WARM_PARALLELISM_PLAYBACK : WARM_PARALLELISM_PRELOAD;
  void Promise.all(Array.from({ length: parallelism }, worker)).finally(() => {
    warming.delete(ctx.cacheKey);
  });
}

// Mobile-safe write: waits for 'drain' whenever write() reports its internal buffer is full,
// so memory stays bounded by the client's actual consumption rate. Audio for a slow phone
// connection can be consumed much slower than upstream produces it — a real risk given this
// app runs on a 1GB RAM VM (see the bounded caches above for the same concern).
function writeChunk(res: Response, chunk: Buffer): Promise<void> {
  return new Promise((resolve) => {
    if (res.write(chunk)) resolve();
    else res.once('drain', () => resolve());
  });
}

/**
 * Serves one client request out of the chunk cache. Covers all the shapes the different
 * browsers use: range-less GETs (200, whole file), bounded ranges (206, exactly the slice
 * asked for) and open-ended ranges like `bytes=262144-` (206 through to the end of the
 * file, which is what avoids the old "audio stops at 30 seconds" bug on iOS Safari).
 */
async function streamRange(
  res: Response,
  ctx: TrackContext,
  range: { start: number; end: number | null },
  isRangeLess: boolean,
  timing: { firstByteAt: number; total?: number },
): Promise<void> {
  let aborted = false;
  res.once('close', () => {
    aborted = true;
  });

  const firstIndex = Math.floor(range.start / CHUNK_SIZE);
  // The first chunk is deliberately fetched on its own: starting the others alongside it
  // (tried: 5 extra in parallel) made the very first bytes arrive ~4x later, since they all
  // compete for the same handshake/bandwidth. warmTrack() below starts the rest once it lands.
  const first = await getChunk(ctx, firstIndex);
  const total = first.total;
  if (total === null) throw new Error('upstream did not report the file size');
  timing.total = total;

  const last = range.end !== null ? Math.min(range.end, total - 1) : total - 1;
  // Past the end of the file, or a backwards range like `bytes=100-50` (which would otherwise
  // produce a negative Content-Length).
  if (range.start >= total || last < range.start) {
    res.status(416).setHeader('Content-Range', `bytes */${total}`).end();
    return;
  }

  res.status(isRangeLess ? 200 : 206);
  if (!isRangeLess) res.setHeader('Content-Range', `bytes ${range.start}-${last}/${total}`);
  res.setHeader('Content-Length', String(last - range.start + 1));
  res.setHeader('Content-Type', first.mimeType);
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Cache-Control', 'public, max-age=3600');

  warmTrack(ctx, total);

  let position = range.start;
  while (position <= last && !aborted) {
    const index = Math.floor(position / CHUNK_SIZE);
    const chunk = index === firstIndex ? first : await getChunk(ctx, index);
    if (aborted) return;
    if (chunk.total !== total) {
      // The file changed underneath this response (re-resolved to a different encoding) —
      // the headers already promised the old one, so stop rather than splice two files.
      res.destroy();
      return;
    }
    const offset = position - index * CHUNK_SIZE;
    const sliceEnd = Math.min(chunk.buffer.length, last - index * CHUNK_SIZE + 1);
    if (offset >= sliceEnd) {
      res.destroy(); // a short chunk that doesn't reach the promised bytes
      return;
    }
    await writeChunk(res, chunk.buffer.subarray(offset, sliceEnd));
    if (timing.firstByteAt === 0) timing.firstByteAt = Date.now();
    position += sliceEnd - offset;
    readAhead(ctx, index, total);
  }

  if (!aborted) res.end();
}

function serveFromDisk(res: Response, track: CachedTrack, range: { start: number; end: number | null }, isRangeLess: boolean): void {
  const last = range.end !== null ? Math.min(range.end, track.size - 1) : track.size - 1;
  if (range.start >= track.size || last < range.start) {
    res.status(416).setHeader('Content-Range', `bytes */${track.size}`).end();
    return;
  }
  res.status(isRangeLess ? 200 : 206);
  if (!isRangeLess) res.setHeader('Content-Range', `bytes ${range.start}-${last}/${track.size}`);
  res.setHeader('Content-Length', String(last - range.start + 1));
  res.setHeader('Content-Type', track.mimeType);
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  // pipe() waits for 'drain' on its own, so a slow phone never makes this buffer the file in memory.
  const stream = openTrackStream(track, range.start, last);
  stream.on('error', () => res.destroy());
  res.once('close', () => stream.destroy());
  stream.pipe(res);
}

/** A track someone actually asked to play (not a background preload) that went out mostly complete is worth keeping. */
const KEEP_MIN_FRACTION = 0.3;
let persistQueue: Promise<void> = Promise.resolve();

function persistTrack(ctx: TrackContext, total: number): void {
  const count = Math.ceil(total / CHUNK_SIZE);
  if (total > WARM_MAX_FILE_BYTES) return;
  // One at a time: each one re-reads the file through the chunk cache and the VM is small.
  persistQueue = persistQueue.then(() =>
    storeTrack(ctx.videoId, ctx.quality, ctx.audio.mimeType, total, count, async (index) => (await getChunk(ctx, index)).buffer),
  );
}

function serveFromFullBuffer(res: Response, entry: FullBufferEntry, range: { start: number; end: number | null }, isRangeLess: boolean): void {
  if (!isRangeLess) {
    sendRangeFromBuffer(res, entry, range);
    return;
  }
  res.status(200);
  res.setHeader('Content-Type', entry.mimeType);
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.setHeader('Content-Length', String(entry.buffer.length));
  res.end(entry.buffer);
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

  // A warm-up whose page moved on (new search, other view) must not keep a queued slot: same rule as the audio route.
  const gone = new AbortController();
  res.once('close', () => gone.abort());

  try {
    await resolveAudio(videoId, quality, RESOLVE_ONLY_PRIORITY, gone.signal);
    res.status(204).end();
  } catch (error) {
    res.status(502).json({ error: 'Failed to resolve audio.', message: (error as Error).message });
  }
});

audioRouter.get('/audio/:videoId', async (req, res) => {
  const { videoId } = req.params;
  const quality: AudioQuality = req.query.quality === 'low' ? 'low' : 'high';
  const priority = req.query.priority === 'low' ? RESOLVE_ONLY_PRIORITY : PLAYBACK_PRIORITY;
  const cacheKey = `${videoId}:${quality}`;

  // Aborted the moment the client goes away (the user tapped another song, closed the
  // tab) so a resolve still waiting in line for this request is dropped instead of
  // burning a slot for a track nobody is waiting for — see PriorityLimiter.
  const gone = new AbortController();
  const startedAt = Date.now();
  const timing: { firstByteAt: number; total?: number } = { firstByteAt: 0 };
  // Bytes this response put on the wire, for the admin dashboard's bandwidth per user (sizes only, never which song).
  const socket = res.socket;
  const bytesBefore = socket?.bytesWritten ?? 0;
  const accountId = req.session?.accountId;
  let persistCtx: TrackContext | null = null;
  res.once('close', () => {
    gone.abort();
    const sentBytes = (socket?.bytesWritten ?? 0) - bytesBefore;
    recordAudio(accountId, sentBytes);
    if (persistCtx && timing.total && sentBytes >= timing.total * KEEP_MIN_FRACTION) persistTrack(persistCtx, timing.total);
    // Only the requests worth looking at are logged — an iPhone makes ~14 per song and
    // cancels most of them on purpose. This is what lets a slow start on a real phone be
    // read off the server's log (docker compose logs backend | grep audio-slow).
    const total = Date.now() - startedAt;
    const ttfb = timing.firstByteAt ? timing.firstByteAt - startedAt : total;
    if (ttfb < SLOW_TTFB_MS && total < SLOW_TOTAL_MS) return;
    const ua = req.headers['user-agent'] ?? '';
    const device = /iPhone|iPad|iPod/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : 'desktop';
    // eslint-disable-next-line no-console
    console.log(`[audio-slow] ${cacheKey} range=${req.headers.range ?? '-'} device=${device} ttfb=${ttfb}ms total=${total}ms finished=${res.writableFinished}`);
  });

  try {
    const rangeHeader = req.headers.range;
    // If no Range header, we default to starting from 0 (open-ended).
    const range = rangeHeader ? (parseRangeHeader(rangeHeader) ?? { start: 0, end: null }) : { start: 0, end: null };
    const isRangeLess = !rangeHeader;

    // Already on disk: no resolve, no YouTube — the fastest path there is.
    const onDisk = await getCachedTrack(videoId, quality);
    if (onDisk) {
      serveFromDisk(res, onDisk, range, isRangeLess);
      return;
    }

    const audio = await resolveAudio(videoId, quality, priority, gone.signal);

    // Already know upstream ignores Range for this track? Slice from the full buffer.
    const cachedBuffer = getCachedBuffer(cacheKey);
    if (cachedBuffer) {
      serveFromFullBuffer(res, cachedBuffer, range, isRangeLess);
      return;
    }

    const ctx: TrackContext = { videoId, quality, cacheKey, audio, priority: priority === PLAYBACK_PRIORITY ? 'high' : 'low' };
    if (priority === PLAYBACK_PRIORITY) persistCtx = ctx;
    try {
      await streamRange(res, ctx, range, isRangeLess, timing);
    } catch (error) {
      if (error instanceof RangeNotSatisfiableError && !res.headersSent) {
        res.status(416).end();
        return;
      }
      if (error instanceof UpstreamIgnoresRangeError && !res.headersSent) {
        const entry = getCachedBuffer(cacheKey);
        if (entry) {
          serveFromFullBuffer(res, entry, range, isRangeLess);
          return;
        }
      }
      throw error;
    }
  } catch (error) {
    if (error instanceof ResolveAbortedError || gone.signal.aborted) return; // client left; nothing to answer
    if (res.headersSent) {
      // Failed mid-stream — a JSON error body can no longer be sent. Cutting the socket
      // is what tells the browser the download broke so it can re-request the rest.
      res.destroy();
      return;
    }
    res.status(502).json({ error: 'Failed to resolve/proxy audio.', message: (error as Error).message });
  }
});
