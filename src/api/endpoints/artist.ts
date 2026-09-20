import { apiGet } from '../musicClient';
import { mapBackendSongs, type BackendSong } from '../mappers';
import type { Song } from '../types';

/** An artist's top songs (server/src/youtube/artist.ts — resolves by name via ytmusic-api's searchArtists, then getArtistSongs). */
export async function getArtistTopSongs(artistName: string): Promise<{ artistName: string; songs: Song[] } | null> {
  try {
    const data = await apiGet<{ artistName: string; songs: BackendSong[] }>(`/api/artist/${encodeURIComponent(artistName)}/songs`);
    return { artistName: data.artistName, songs: mapBackendSongs(data.songs) };
  } catch {
    return null;
  }
}
