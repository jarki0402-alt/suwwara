import { apiGet } from '../musicClient';
import { mapBackendSongs, type BackendSong } from '../mappers';
import type { Song } from '../types';

/** Songs for one of the Search tab's genre/mood tiles (server/src/youtube/genreCategories.ts). */
export async function getCategorySongs(categoryId: string): Promise<Song[]> {
  const data = await apiGet<{ songs: BackendSong[] }>(`/api/browse/category/${encodeURIComponent(categoryId)}`);
  return mapBackendSongs(data.songs);
}
