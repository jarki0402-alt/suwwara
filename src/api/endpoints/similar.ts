import { apiGet } from '../musicClient';
import { mapBackendSongs, type BackendSong } from '../mappers';
import type { Song } from '../types';

/** Songs YouTube Music itself considers similar to `songId` — used to seed the recommendation engine's candidate pool without repeating the same artist. */
export async function getSimilarSongs(songId: string, limit = 20): Promise<Song[]> {
  const data = await apiGet<{ songs: BackendSong[] }>(`/api/similar/${encodeURIComponent(songId)}`, { limit });
  return mapBackendSongs(data.songs);
}
