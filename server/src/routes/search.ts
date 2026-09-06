import { Router } from 'express';
import { getSearchSuggestions } from '../youtube/search';
import { searchSongs } from '../youtube/search';

export const searchRouter = Router();

searchRouter.get('/search', async (req, res) => {
  const query = typeof req.query.q === 'string' ? req.query.q : '';
  const limit = Math.min(Number(req.query.limit) || 20, 40);

  try {
    const songs = await searchSongs(query, limit);
    res.json({ songs });
  } catch (error) {
    res.status(502).json({ error: 'Search failed.', message: (error as Error).message });
  }
});

/** Autocomplete-as-you-type suggestions — separate from the recent-searches list, which
 * is the user's own history and lives entirely client-side (see useRecentSearches.ts). */
searchRouter.get('/search/suggestions', async (req, res) => {
  const query = typeof req.query.q === 'string' ? req.query.q : '';
  if (query.trim().length === 0) {
    res.json({ suggestions: [] });
    return;
  }

  try {
    const suggestions = await getSearchSuggestions(query);
    res.json({ suggestions });
  } catch (error) {
    res.status(502).json({ error: 'Failed to fetch search suggestions.', message: (error as Error).message });
  }
});
