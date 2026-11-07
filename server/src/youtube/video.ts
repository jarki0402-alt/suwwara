import { BoundedTtlCache } from './boundedCache';
import { callResolver, ResolveAbortedError, scheduleOnResolver, type ResolvedStream } from './stream';
import { pickMusicVideo, type MusicVideoMatch, type SongForMatch, type VideoCandidate } from './videoMatch';
import { getYTMusic } from './ytmusic';

export type { MusicVideoMatch };

/**
 * Music videos ("Video" in Now Playing). Two jobs, both kept away from the audio path:
 * - findMusicVideo: which YouTube video is the official MV of a song. The song ids this app plays are mostly YouTube
 *   Music's audio-only uploads; the MV is a different video id. YouTube Music's own song/video switch ("counterpart")
 *   only comes back for signed-in sessions, so the MV is found the way a person would: YouTube Music's video search,
 *   first result from the same artist whose title is the song's and isn't a lyric/live/cover upload.
 * - resolveVideo: the playable URL of its picture, through the same single yt-dlp slot as audio but in the 'idle'
 *   lane, so it only ever runs when no song is waiting.
 */

// Keyed by song id (unbounded input), so capped and swept. A miss is cached too: a song without an MV would otherwise
// cost a YouTube Music search every time its Now Playing opens.
const matches = new BoundedTtlCache<MusicVideoMatch | null>(1000, 24 * 60 * 60 * 1000);
// Every outgoing call gets a timeout (CLAUDE.md rule 7); the ytmusic client has none of its own.
const SEARCH_TIMEOUT_MS = 8000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export function findMusicVideo(song: SongForMatch): Promise<MusicVideoMatch | null> {
  return matches.getOrLoad(song.id, async () => {
    const ytmusic = await getYTMusic();
    const results = await withTimeout(ytmusic.searchVideos(`${song.title} ${song.artist}`), SEARCH_TIMEOUT_MS);
    const candidates: VideoCandidate[] = results.map((video) => ({
      videoId: video.videoId,
      name: video.name,
      artist: video.artist?.name ?? '',
      durationSec: video.duration ?? 0,
    }));
    return pickMusicVideo(song, candidates);
  });
}

export type VideoHeight = '720' | '480';

// googlevideo links live ~6h; the safety margin keeps a link from dying mid-video.
const EXPIRY_MARGIN_MS = 30 * 60 * 1000;
const FALLBACK_TTL_MS = 2 * 60 * 60 * 1000;
// Few videos are watched compared to songs played, and an entry is a URL and a few headers.
const MAX_RESOLVED = 60;
const resolved = new Map<string, { stream: ResolvedStream; expiresAt: number }>();
const inFlight = new Map<string, { promise: Promise<ResolvedStream>; cancel: () => boolean; promote: () => void; interested: number }>();

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of resolved) if (entry.expiresAt <= now) resolved.delete(key);
}, 5 * 60 * 1000).unref();

function expiryOf(url: string): number {
  const expireSec = Number(new URL(url).searchParams.get('expire'));
  return Number.isFinite(expireSec) && expireSec > 0 ? expireSec * 1000 - EXPIRY_MARGIN_MS : Date.now() + FALLBACK_TTL_MS;
}

export function forgetVideo(videoId: string, height: VideoHeight, deadUrl: string): void {
  const key = `${videoId}:${height}`;
  if (resolved.get(key)?.stream.url === deadUrl) resolved.delete(key);
}

/** Playable URL of the MV's picture. `signal`: the viewer left, so a resolve still waiting in line is dropped. */
/**
 * `priority`: 'idle' for the warm-up made as soon as the Video button shows (nobody waits on it yet, it must never
 * delay a song); 'high' once someone actually tapped Video and is looking at a spinner. That was 'idle' too at first,
 * and a tap then queued behind every next-song lookahead, several yt-dlp turns of 2-3s each: "the video is so slow".
 */
export async function resolveVideo(videoId: string, height: VideoHeight, signal?: AbortSignal, priority: 'high' | 'idle' = 'high'): Promise<ResolvedStream> {
  const key = `${videoId}:${height}`;
  const hit = resolved.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.stream;

  let job = inFlight.get(key);
  if (job && priority === 'high') job.promote();
  if (!job) {
    const { promise: raw, handle } = scheduleOnResolver(priority, () => callResolver(videoId, height, 'video'));
    const promise = raw
      .then((stream) => {
        resolved.delete(key);
        resolved.set(key, { stream, expiresAt: expiryOf(stream.url) });
        while (resolved.size > MAX_RESOLVED) {
          const oldest = resolved.keys().next().value;
          if (oldest === undefined) break;
          resolved.delete(oldest);
        }
        return stream;
      })
      .finally(() => inFlight.delete(key));
    promise.catch(() => {});
    job = { promise, cancel: () => handle.cancel(), promote: () => handle.promote(), interested: 0 };
    inFlight.set(key, job);
  }

  const joined = job;
  joined.interested += 1;
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    joined.interested -= 1;
    if (joined.interested <= 0) joined.cancel();
  };
  if (signal?.aborted) {
    release();
    throw new ResolveAbortedError();
  }
  signal?.addEventListener('abort', release, { once: true });
  try {
    return await new Promise<ResolvedStream>((resolve, reject) => {
      signal?.addEventListener('abort', () => reject(new ResolveAbortedError()), { once: true });
      joined.promise.then(resolve, reject);
    });
  } finally {
    signal?.removeEventListener('abort', release);
    release();
  }
}
