import { apiGet } from '../musicClient';
import { imagesFromUrl, mapBackendSongs, type BackendSong } from '../mappers';
import type { ImageVariant, Song } from '../types';

/** An artist's top songs (server/src/youtube/artist.ts — resolves by name via ytmusic-api's searchArtists, then getArtistSongs). */
export async function getArtistTopSongs(artistName: string): Promise<{ artistName: string; image: ImageVariant[]; songs: Song[] } | null> {
  try {
    const data = await apiGet<{ artistName: string; image?: string; songs: BackendSong[] }>(`/api/artist/${encodeURIComponent(artistName)}/songs`);
    return { artistName: data.artistName, image: imagesFromUrl(data.image ?? ''), songs: mapBackendSongs(data.songs) };
  } catch {
    return null;
  }
}
