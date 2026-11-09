import { buildAudioUrl } from '../api/musicClient';
import { isEpisodeId } from '../podcast/episodeRegistry';
import { prefersNativeHls } from './platform';

const nativeHls =
  typeof navigator !== 'undefined' && prefersNativeHls(navigator.userAgent, navigator.platform, navigator.maxTouchPoints ?? 0);

export type AudioQuality = 'high' | 'low';

/**
 * Unlike the old JioSaavn-backed version of this app (which picked from a
 * downloadUrl[] array of discrete bitrate tiers), our backend resolves
 * exactly one of two quality tiers server-side via yt-dlp — so this is just
 * a thin, explicit mapping from the Data Saver setting to that URL.
 */
export function resolveAudioUrl(songId: string, dataSaver: boolean): string {
  // Speech: the low tier (~22MB an hour, a third of the music tier) sounds the same, and the server keeps episodes
  // out of its chunk and disk caches (routes/audio.ts, `podcast=1`).
  // In Safari, through the episode's HLS playlist: it starts after the first segment instead of after walking the
  // whole file (platform.ts prefersNativeHls). Songs never take this path.
  if (isEpisodeId(songId)) return nativeHls ? `/api/audio/${encodeURIComponent(songId)}/hls.m3u8` : `${buildAudioUrl(songId, 'low')}&podcast=1`;
  const quality: AudioQuality = dataSaver ? 'low' : 'high';
  return buildAudioUrl(songId, quality);
}
