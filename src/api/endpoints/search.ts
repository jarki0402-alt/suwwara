import { apiGet } from '../musicClient';
import { imagesFromUrl, mapBackendSongs, type BackendSong } from '../mappers';
import type { ImageVariant, Song } from '../types';

export interface SearchSongsResponse {
  songs: Song[];
}

export async function searchSongs(query: string, limit = 20): Promise<SearchSongsResponse> {
  const trimmed = query.trim();
  if (trimmed.length === 0) return { songs: [] };

  const data = await apiGet<{ songs: BackendSong[] }>('/api/search', { q: trimmed, limit });
  return { songs: mapBackendSongs(data.songs) };
}

/** YT Music's own autocomplete-as-you-type suggestions — distinct from the user's own
 * recent-searches history, which is kept client-side (see useRecentSearches). */
export async function getSearchSuggestions(query: string): Promise<string[]> {
  const trimmed = query.trim();
  if (trimmed.length === 0) return [];

  const data = await apiGet<{ suggestions: string[] }>('/api/search/suggestions', { q: trimmed });
  return data.suggestions;
}

export interface ArtistHit {
  artistId: string;
  name: string;
  image: ImageVariant[];
}

/** Lowercase, accent- and punctuation-free, single-spaced — so "Beyoncé" matches "beyonce". */
function normalizeName(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * The artist a query is really about, or null. YT Music happily returns *some* artist for any text
 * ("bruises" -> a band of that name), so a hit only counts when the query is the artist's name (or the
 * start of one of its words, "capaldi"), or contains the whole name ("olivia rodrigo drivers license")
 * — otherwise typing a song title would keep pushing an unrelated profile at the user.
 */
export async function findArtistMatch(query: string): Promise<ArtistHit | null> {
  const q = normalizeName(query);
  if (q.length < 2) return null;

  try {
    const data = await apiGet<{ artists: { artistId: string; name: string; thumbnail: string }[] }>('/api/search/artists', { q: query.trim(), limit: 3 });
    for (const artist of data.artists) {
      const name = normalizeName(artist.name);
      if (name.length === 0) continue;
      if (` ${name}`.includes(` ${q}`) || ` ${q} `.includes(` ${name} `)) {
        return { artistId: artist.artistId, name: artist.name, image: imagesFromUrl(artist.thumbnail) };
      }
    }
    return null;
  } catch {
    return null; // an optional extra on top of the song results — never worth surfacing an error for
  }
}
