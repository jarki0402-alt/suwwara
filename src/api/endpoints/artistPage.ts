import { apiGet } from '../musicClient';
import { mapBackendSongs, type BackendSong } from '../mappers';
import type { Song } from '../types';

export interface AlbumSummary {
  id: string;
  name: string;
  year: number | null;
  thumbnail: string;
  artist: string;
  artistId: string | null;
}

export interface ArtistPageData {
  artistId: string;
  name: string;
  banner: string;
  topSongs: Song[];
  /** Rounded, as YouTube Music reports it; null when there is none for this artist. */
  monthlyListeners: number | null;
  /** song id → plays, for the top songs that have a count. */
  playCounts: Record<string, number>;
  albums: AlbumSummary[];
  singles: AlbumSummary[];
  similarArtists: Array<{ id: string; name: string; thumbnail: string }>;
}

export interface AlbumPageData extends AlbumSummary {
  songs: Song[];
}

// Session cache so stepping back from an album to the artist (or re-opening one just seen)
// is instant instead of another round trip. Small on purpose: these are big objects.
const MAX_CACHED_PAGES = 24;
const pageCache = new Map<string, unknown>();

async function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  if (pageCache.has(key)) return pageCache.get(key) as T;
  const value = await load();
  pageCache.set(key, value);
  while (pageCache.size > MAX_CACHED_PAGES) {
    const oldest = pageCache.keys().next().value;
    if (oldest === undefined) break;
    pageCache.delete(oldest);
  }
  return value;
}

export function getArtistPage(artistId: string): Promise<ArtistPageData> {
  return cached(`artist:${artistId}`, async () => {
    const raw = await apiGet<Omit<ArtistPageData, 'topSongs'> & { topSongs: BackendSong[] }>(`/api/artists/${encodeURIComponent(artistId)}`);
    return { ...raw, topSongs: mapBackendSongs(raw.topSongs) };
  });
}

export function getAlbumPage(albumId: string): Promise<AlbumPageData> {
  return cached(`album:${albumId}`, async () => {
    const raw = await apiGet<Omit<AlbumPageData, 'songs'> & { songs: BackendSong[] }>(`/api/albums/${encodeURIComponent(albumId)}`);
    return { ...raw, songs: mapBackendSongs(raw.songs) };
  });
}

export function getArtistAllSongs(artistId: string): Promise<Song[]> {
  return cached(`artist-songs:${artistId}`, async () => {
    const raw = await apiGet<{ songs: BackendSong[] }>(`/api/artists/${encodeURIComponent(artistId)}/songs`);
    return mapBackendSongs(raw.songs);
  });
}

/** For places that only know an artist's name (songs saved before ids were carried along). */
export async function resolveArtistId(name: string): Promise<string | null> {
  try {
    const raw = await apiGet<{ artistId: string }>('/api/artists/resolve', { name });
    return raw.artistId;
  } catch {
    return null;
  }
}
