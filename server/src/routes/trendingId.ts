import { Router } from 'express';
import { searchSongs, type SearchSong } from '../youtube/search';
import { getTrendingSongsIndonesia } from '../youtube/trendingId';

export const trendingIdRouter = Router();

// Keyword fallback if YT Music's own Indonesia home shelves come back thin —
// run through the same global search client as everywhere else (searchSongs
// still surfaces Indonesian catalog songs for Indonesian-language queries
// regardless of the client's own GL/HL setting, since that only biases
// *ranking/curated shelves*, not which songs exist in the catalog).
const SEED_QUERIES = ['lagu indonesia viral 2026', 'tangga lagu indonesia terbaru', 'lagu indonesia trending official music video'];

const MIN_SECTION_SONGS = 8;

trendingIdRouter.get('/trending/id', async (_req, res) => {
  try {
    const sectionSongs = await getTrendingSongsIndonesia();
    const seen = new Set(sectionSongs.map((song) => song.id));
    const merged = [...sectionSongs];

    if (merged.length < MIN_SECTION_SONGS) {
      const seedResults = await Promise.allSettled(SEED_QUERIES.map((seed) => searchSongs(seed, 10)));
      for (const result of seedResults) {
        if (result.status !== 'fulfilled') continue;
        for (const song of result.value) {
          if (seen.has(song.id)) continue;
          seen.add(song.id);
          merged.push(song);
        }
      }
    }

    if (merged.length === 0) {
      res.status(502).json({ error: 'Failed to fetch Indonesia trending songs.' });
      return;
    }

    const songs: SearchSong[] = merged.slice(0, 20);
    res.json({ songs });
  } catch (error) {
    res.status(502).json({ error: 'Failed to fetch Indonesia trending songs.', message: (error as Error).message });
  }
});
