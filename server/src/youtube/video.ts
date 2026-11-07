import { BoundedTtlCache } from './boundedCache';
import { callResolver, ResolveAbortedError, scheduleOnResolver, type ResolvedStream } from './stream';
import { VIDEO_TIERS, type VideoSet, type VideoTier, type VideoVariant } from './videoPlaylist';
import { pickMusicVideo, shortlistVideoCandidates, type MusicVideoMatch, type SongForMatch, type VideoCandidate } from './videoMatch';
import { getYTMusic } from './ytmusic';

export type { MusicVideoMatch };
export { parseVideoTier, pickVariant, VIDEO_TIERS, type VideoSet, type VideoTier, type VideoVariant } from './videoPlaylist';

/**
 * Music videos ("Video" in Now Playing). Two jobs, both kept away from the audio path:
 * - findMusicVideo: which YouTube video is the official MV of a song. The song ids this app plays are mostly YouTube
 *   Music's audio-only uploads; the MV is a different video id. YouTube Music's own song/video switch ("counterpart")
 *   only comes back for signed-in sessions, so the MV is found the way a person would: YouTube Music's video search,
 *   checked against each upload's real title and channel (videoMatch.ts has the rules).
 * - resolveVideoSet: the playable URLs of its picture, every quality from one call, through the same single yt-dlp slot as audio but in the 'idle'
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

// oEmbed is YouTube's public, keyless "what is this video" endpoint: a few hundred bytes with the real title and channel.
const OEMBED_TIMEOUT_MS = 4000;

async function realUpload(videoId: string): Promise<{ title: string; channel: string } | null> {
  try {
    const url = `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}`;
    const response = await fetch(url, { signal: AbortSignal.timeout(OEMBED_TIMEOUT_MS) });
    if (!response.ok) return null;
    const body = (await response.json()) as { title?: unknown; author_name?: unknown };
    return typeof body.title === 'string' && typeof body.author_name === 'string' ? { title: body.title, channel: body.author_name } : null;
  } catch {
    return null;
  }
}

/**
 * YouTube Music's video search credits uploads to the song's artist and strips their titles: Dan Music's "dhruv -
 * double take (Lyrics)" comes back as "double take" by "Dhruv", indistinguishable from the real MV. So the shortlist's
 * real titles and channels are looked up (in parallel, a handful) and the choice is made on those.
 */
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
    const shortlist = shortlistVideoCandidates(song, candidates);
    if (shortlist.length === 0) return null;
    const uploads = await Promise.all(shortlist.map((candidate) => realUpload(candidate.videoId)));
    // Not one lookup answered: YouTube unreachable, not "no video". Thrown, so it isn't cached as a miss for a day.
    if (uploads.every((upload) => upload === null)) throw new Error('video channel lookup failed');
    // An upload whose channel couldn't be checked is left out rather than trusted on YouTube Music's word.
    const verified = shortlist.flatMap((candidate, index) => {
      const upload = uploads[index];
      return upload ? [{ ...candidate, uploadTitle: upload.title, channel: upload.channel }] : [];
    });
    return pickMusicVideo(song, verified);
  });
}

// googlevideo links live ~6h; the safety margin keeps a link from dying mid-video.
const EXPIRY_MARGIN_MS = 30 * 60 * 1000;
const FALLBACK_TTL_MS = 2 * 60 * 60 * 1000;
// Few videos are watched compared to songs played, and an entry is a handful of URLs and headers.
const MAX_RESOLVED = 60;
const resolved = new Map<string, { set: VideoSet; expiresAt: number }>();
const inFlight = new Map<string, { promise: Promise<VideoSet>; cancel: () => boolean; promote: () => void; interested: number }>();

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of resolved) if (entry.expiresAt <= now) resolved.delete(key);
}, 5 * 60 * 1000).unref();

function expiryOf(url: string): number {
  const expireSec = Number(new URL(url).searchParams.get('expire'));
  return Number.isFinite(expireSec) && expireSec > 0 ? expireSec * 1000 - EXPIRY_MARGIN_MS : Date.now() + FALLBACK_TTL_MS;
}

function toSet(stream: ResolvedStream): VideoSet {
  const variants: VideoVariant[] = (stream.variants ?? []).flatMap((variant) =>
    VIDEO_TIERS.includes(variant.tier as VideoTier)
      ? [
          {
            tier: variant.tier as VideoTier,
            stream: { url: variant.url, mimeType: 'video/mp4', httpHeaders: variant.httpHeaders, durationSec: stream.durationSec },
            width: variant.width,
            height: variant.height,
            kbps: variant.kbps,
            codecs: variant.codecs,
          },
        ]
      : [],
  );
  // No ladder (a fallback client that only gave the 360p file with sound): that one file, as the only rung.
  if (variants.length === 0) variants.push({ tier: '360', stream, width: null, height: null, kbps: null, codecs: null });
  return { variants };
}

export function forgetVideo(videoId: string, deadUrl: string): void {
  if (resolved.get(videoId)?.set.variants.some((variant) => variant.stream.url === deadUrl)) resolved.delete(videoId);
}

/**
 * Every quality of a video's picture. `signal`: the viewer left, so a resolve still waiting in line is dropped.
 * `priority`: 'idle' for the warm-up made as soon as the Video button shows (nobody waits on it yet, it must never
 * delay a song); 'high' once someone actually tapped Video and is looking at a spinner. That was 'idle' too at first,
 * and a tap then queued behind every next-song lookahead, several yt-dlp turns of 2-3s each: "the video is so slow".
 */
export async function resolveVideoSet(videoId: string, signal?: AbortSignal, priority: 'high' | 'idle' = 'high'): Promise<VideoSet> {
  const hit = resolved.get(videoId);
  if (hit && hit.expiresAt > Date.now()) return hit.set;

  let job = inFlight.get(videoId);
  if (job && priority === 'high') job.promote();
  if (!job) {
    const { promise: raw, handle } = scheduleOnResolver(priority, () => callResolver(videoId, 'all', 'video'));
    const promise = raw
      .then((stream) => {
        const set = toSet(stream);
        resolved.delete(videoId);
        resolved.set(videoId, { set, expiresAt: expiryOf(set.variants[0]!.stream.url) });
        while (resolved.size > MAX_RESOLVED) {
          const oldest = resolved.keys().next().value;
          if (oldest === undefined) break;
          resolved.delete(oldest);
        }
        return set;
      })
      .finally(() => inFlight.delete(videoId));
    promise.catch(() => {});
    job = { promise, cancel: () => handle.cancel(), promote: () => handle.promote(), interested: 0 };
    inFlight.set(videoId, job);
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
    return await new Promise<VideoSet>((resolve, reject) => {
      signal?.addEventListener('abort', () => reject(new ResolveAbortedError()), { once: true });
      joined.promise.then(resolve, reject);
    });
  } finally {
    signal?.removeEventListener('abort', release);
    release();
  }
}
