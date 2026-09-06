import { buildAudioUrl } from '../api/musicClient';

export type AudioQuality = 'high' | 'low';

/**
 * Unlike the old JioSaavn-backed version of this app (which picked from a
 * downloadUrl[] array of discrete bitrate tiers), our backend resolves
 * exactly one of two quality tiers server-side via yt-dlp — so this is just
 * a thin, explicit mapping from the Data Saver setting to that URL.
 */
export function resolveAudioUrl(songId: string, dataSaver: boolean): string {
  const quality: AudioQuality = dataSaver ? 'low' : 'high';
  return buildAudioUrl(songId, quality);
}
