export interface BrowseCategory {
  id: string;
  label: string;
  /** Preset search query sent to the existing /api/search backend — same technique
   * trending.ts already uses for its seed queries, just one per category tile here. */
  query: string;
  /** Flat tile colour — muted and dark enough for white text in either theme (the old neon gradients read as stock UI). */
  color: string;
}

/** Curated genre + mood tiles for the Search tab's "browse" grid (shown when the
 * search box is empty) — no ML/audio analysis involved, just preset queries against
 * the same search backend the typed-search box already uses. */
export const BROWSE_CATEGORIES: BrowseCategory[] = [
  { id: 'pop', label: 'Pop', query: 'pop songs 2026 official audio', color: '#b8405e' },
  { id: 'hiphop', label: 'Hip-Hop', query: 'hip hop rap songs 2026 official audio', color: '#9a5b13' },
  { id: 'rnb', label: 'R&B', query: 'rnb soul songs official audio', color: '#3d4e8c' },
  { id: 'rock', label: 'Rock', query: 'rock songs official audio', color: '#a33a2b' },
  { id: 'kpop', label: 'K-Pop', query: 'kpop songs 2026 official music video', color: '#2f6b8a' },
  { id: 'indonesia', label: 'Musik Indonesia', query: 'lagu indonesia terbaru 2026', color: '#c2470f' },
  { id: 'edm', label: 'Dance/Electronic', query: 'edm dance electronic music 2026', color: '#0f6e78' },
  { id: 'chill', label: 'Santai', query: 'lofi chill relax music playlist', color: '#2f7a5c' },
  { id: 'sad', label: 'Galau', query: 'lagu galau sedih baper', color: '#4a5568' },
  { id: 'party', label: 'Pesta', query: 'party dance hits playlist', color: '#a8326e' },
  { id: 'workout', label: 'Olahraga', query: 'workout gym motivation music', color: '#3b7a1f' },
  { id: 'throwback', label: 'Throwback', query: 'throwback hits 2000s 2010s', color: '#6b4f2a' },
];
