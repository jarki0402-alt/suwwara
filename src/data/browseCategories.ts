export interface BrowseCategory {
  id: string;
  label: string;
  /** Preset search query sent to the existing /api/search backend — same technique
   * trending.ts already uses for its seed queries, just one per category tile here. */
  query: string;
  gradientFrom: string;
  gradientTo: string;
}

/** Curated genre + mood tiles for the Search tab's "browse" grid (shown when the
 * search box is empty) — no ML/audio analysis involved, just preset queries against
 * the same search backend the typed-search box already uses. */
export const BROWSE_CATEGORIES: BrowseCategory[] = [
  { id: 'pop', label: 'Pop', query: 'pop songs 2026 official audio', gradientFrom: '#ec4899', gradientTo: '#be185d' },
  { id: 'hiphop', label: 'Hip-Hop', query: 'hip hop rap songs 2026 official audio', gradientFrom: '#f59e0b', gradientTo: '#b45309' },
  { id: 'rnb', label: 'R&B', query: 'rnb soul songs official audio', gradientFrom: '#8b5cf6', gradientTo: '#5b21b6' },
  { id: 'rock', label: 'Rock', query: 'rock songs official audio', gradientFrom: '#ef4444', gradientTo: '#991b1b' },
  { id: 'kpop', label: 'K-Pop', query: 'kpop songs 2026 official music video', gradientFrom: '#f472b6', gradientTo: '#db2777' },
  { id: 'indonesia', label: 'Musik Indonesia', query: 'lagu indonesia terbaru 2026', gradientFrom: '#f97316', gradientTo: '#b91c1c' },
  { id: 'edm', label: 'Dance/Electronic', query: 'edm dance electronic music 2026', gradientFrom: '#06b6d4', gradientTo: '#0e7490' },
  { id: 'chill', label: 'Santai', query: 'lofi chill relax music playlist', gradientFrom: '#14b8a6', gradientTo: '#0f766e' },
  { id: 'sad', label: 'Galau', query: 'lagu galau sedih baper', gradientFrom: '#64748b', gradientTo: '#334155' },
  { id: 'party', label: 'Pesta', query: 'party dance hits playlist', gradientFrom: '#d946ef', gradientTo: '#a21caf' },
  { id: 'workout', label: 'Olahraga', query: 'workout gym motivation music', gradientFrom: '#22c55e', gradientTo: '#15803d' },
  { id: 'throwback', label: 'Throwback', query: 'throwback hits 2000s 2010s', gradientFrom: '#a855f7', gradientTo: '#7e22ce' },
];
