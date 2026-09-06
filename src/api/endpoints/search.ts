import { apiGet } from '../musicClient';
import { mapBackendSongs, type BackendSong } from '../mappers';
import type { Song } from '../types';

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
