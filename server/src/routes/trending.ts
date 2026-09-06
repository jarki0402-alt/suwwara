import { Router } from 'express';
import { getBrowseSections } from '../youtube/browse';
import { searchSongs, type SearchSong } from '../youtube/search';

export const trendingRouter = Router();

// Deliberately global/English-language, artist-and-song-shaped queries (never
// region-specific) — this is what keeps the Home "Top Chart" section
// populated with worldwide Gen-Z-relevant hits instead of any single
// region's catalog, and avoids generic "hot 100/countdown" phrasing that
// tends to surface countdown-compilation videos rather than individual songs.
const SEED_QUERIES = [
  'new pop songs 2026 official music video',
  'top hits right now official audio',
  'viral songs this year official music video',
  'trending pop rnb hip hop official audio',
];

interface TrendingCache {
  songs: SearchSong[];
  expiresAt: number;
}

let cache: TrendingCache | null = null;
const CACHE_TTL_MS = 30 * 60 * 1000;

trendingRouter.get('/trending', async (_req, res) => {
  if (cache && cache.expiresAt > Date.now()) {
    res.json({ songs: cache.songs });
    return;
  }

  // Query multiple seeds and merge — this both broadens variety and means a
  // single seed returning weak results doesn't define the whole section.
  const [seedResults, browseSections] = await Promise.all([
    Promise.allSettled(SEED_QUERIES.map((seed) => searchSongs(seed, 10))),
    // YT Music's own curated home shelves — genuinely refreshed by YouTube itself,
    // so these go first when available. Falls back to [] (not thrown) so a hiccup
    // here never takes down the whole section — the seed queries below are the
    // reliability floor this always had.
    getBrowseSections().catch(() => []),
  ]);

  const seen = new Set<string>();
  const merged: SearchSong[] = [];

  for (const section of browseSections) {
    for (const song of section.songs) {
      if (seen.has(song.id)) continue;
      seen.add(song.id);
      merged.push(song);
    }
  }

  for (const result of seedResults) {
    if (result.status !== 'fulfilled') continue;
    for (const song of result.value) {
      if (seen.has(song.id)) continue;
      seen.add(song.id);
      merged.push(song);
    }
  }

  if (merged.length === 0) {
    res.status(502).json({ error: 'Failed to fetch trending songs.' });
    return;
  }

  // Keeps each seed's own relevance ordering (rather than shuffling) so the
  // Home section's #1/#2/#3 rank badges reflect a stable, meaningful order.
  const songs = merged.slice(0, 20);
  cache = { songs, expiresAt: Date.now() + CACHE_TTL_MS };
  res.json({ songs });
});
