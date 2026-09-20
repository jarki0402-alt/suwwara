import { apiGet } from '../musicClient';

/** What GET /api/lyrics/:videoId answers (server/src/youtube/lyrics.ts). A failure to look is an HTTP error, never `none`. */
export type LyricsPayload =
  | { type: 'synced'; source: 'lrclib'; lrc: string; matchedDurationSec: number }
  | { type: 'plain'; source: 'lrclib' | 'ytmusic'; text: string; matchedDurationSec: number | null }
  | { type: 'instrumental' }
  | { type: 'none' };

export function getLyricsPayload(videoId: string): Promise<LyricsPayload> {
  return apiGet<LyricsPayload>(`/api/lyrics/${encodeURIComponent(videoId)}`);
}
