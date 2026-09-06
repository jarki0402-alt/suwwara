import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export type AudioQuality = 'high' | 'low';

export interface ResolvedAudio {
  url: string;
  mimeType: string;
}

interface CacheEntry {
  audio: ResolvedAudio;
  expiresAt: number;
}

// googlevideo.com URLs are IP-locked to whichever machine resolved them (this
// backend), and are typically valid for a few hours — caching means repeated
// seeks/replays of the same track don't re-invoke yt-dlp every time.
const CACHE_TTL_MS = 3 * 60 * 60 * 1000;
const cache = new Map<string, CacheEntry>();

// The frontend fires a speculative /resolve prefetch for the next queued track
// and then the real streaming request can land moments later for the same
// videoId+quality before that prefetch has finished — without this, both
// requests would independently spawn their own multi-second yt-dlp process
// instead of the second one just waiting on the first's result.
const inFlight = new Map<string, Promise<ResolvedAudio>>();

const EXT_TO_MIME: Record<string, string> = {
  m4a: 'audio/mp4',
  webm: 'audio/webm',
  opus: 'audio/opus',
  mp3: 'audio/mpeg',
};

function formatSelector(quality: AudioQuality): string {
  // m4a/AAC is preferred over webm/opus because Safari (iOS/macOS) has no
  // native WebM/Opus support in <audio> — picking m4a keeps playback working
  // across every target browser, not just Chromium-based ones.
  return quality === 'low' ? 'worstaudio[ext=m4a]/worstaudio' : 'bestaudio[ext=m4a]/bestaudio';
}

/**
 * Shells out to the yt-dlp CLI (not a JS extraction library) to resolve a
 * playable audio URL. This project deliberately does NOT use npm packages
 * like ytdl-core/play-dl for this step — both were found to be broken
 * against YouTube's current player as of this build (verified live: they
 * throw "Failed to find any playable formats" even for a stable, unrelated
 * test video), because neither has been updated in over a year. yt-dlp is
 * the one extractor in this space that stays patched against YouTube's
 * frequent changes, with releases every few weeks — but it must be installed
 * separately on the host running this backend (`brew install yt-dlp`).
 */
export async function resolveAudio(videoId: string, quality: AudioQuality): Promise<ResolvedAudio> {
  const cacheKey = `${videoId}:${quality}`;
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.audio;

  const pending = inFlight.get(cacheKey);
  if (pending) return pending;

  const resolution = resolveAudioUncached(videoId, quality).finally(() => {
    inFlight.delete(cacheKey);
  });
  inFlight.set(cacheKey, resolution);

  const audio = await resolution;
  cache.set(cacheKey, { audio, expiresAt: Date.now() + CACHE_TTL_MS });
  return audio;
}

async function resolveAudioUncached(videoId: string, quality: AudioQuality): Promise<ResolvedAudio> {
  const url = `https://www.youtube.com/watch?v=${videoId}`;
  let stdout: string;
  try {
    ({ stdout } = await execFileAsync(
      'yt-dlp',
      ['-f', formatSelector(quality), '--print', '%(url)s', '--print', '%(ext)s', '--no-warnings', '--socket-timeout', '20', url],
      { timeout: 25000, maxBuffer: 4 * 1024 * 1024 },
    ));
  } catch (error) {
    const message = (error as { stderr?: string; message: string }).stderr || (error as Error).message;
    throw new Error(`yt-dlp failed to resolve audio for ${videoId}: ${message}`);
  }

  const lines = stdout.trim().split('\n').filter(Boolean);
  const [streamUrl, ext] = lines;
  if (!streamUrl) throw new Error(`yt-dlp returned no stream URL for video ${videoId}.`);

  return {
    url: streamUrl,
    mimeType: EXT_TO_MIME[ext] ?? 'audio/mp4',
  };
}
