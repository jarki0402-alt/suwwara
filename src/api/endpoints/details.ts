import { apiGet } from '../musicClient';
import { mapBackendSong, type BackendSong } from '../mappers';
import type { Song } from '../types';

/**
 * Fetches YouTube's own "Music in this video" Content-ID metadata when
 * available (clean official title/artist/album) — used to sharpen the LRCLIB
 * lyrics query beyond the heuristically-cleaned title a search result carries.
 */
export async function getSongDetails(id: string): Promise<Song> {
  const data = await apiGet<BackendSong>(`/api/details/${encodeURIComponent(id)}`);
  return mapBackendSong(data);
}
