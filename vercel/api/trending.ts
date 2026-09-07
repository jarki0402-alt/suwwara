import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getBrowseSections } from '../lib/browse';
import { searchSongs, type SearchSong } from '../lib/search';

// Deliberately global/English-language, artist-and-song-shaped queries (never
// region-specific) — ported as-is from server/src/routes/trending.ts.
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

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  if (cache && cache.expiresAt > Date.now()) {
    res.status(200).json({ songs: cache.songs });
    return;
  }

  const [seedResults, browseSections] = await Promise.all([
    Promise.allSettled(SEED_QUERIES.map((seed) => searchSongs(seed, 10))),
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

  const songs = merged.slice(0, 20);
  cache = { songs, expiresAt: Date.now() + CACHE_TTL_MS };
  res.status(200).json({ songs });
}
