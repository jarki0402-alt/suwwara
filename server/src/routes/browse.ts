import { Router } from 'express';
import { getBrowseSections } from '../youtube/browse';
import { CATEGORY_IDS, getCategorySongs } from '../youtube/genreCategories';

export const browseRouter = Router();

/** YT Music's own curated home shelves (trending, mood/genre, quick picks) — used for
 * Home discovery sections and the "browse categories" grid. */
browseRouter.get('/browse', async (_req, res) => {
  try {
    const sections = await getBrowseSections();
    res.json({ sections });
  } catch (error) {
    res.status(502).json({ error: 'Failed to fetch browse sections.', message: (error as Error).message });
  }
});

/** Songs for one of the Search tab's genre/mood tiles (see youtube/genreCategories.ts). */
browseRouter.get('/browse/category/:id', async (req, res) => {
  const { id } = req.params;
  if (!CATEGORY_IDS.has(id)) {
    res.status(404).json({ error: 'Unknown category.' });
    return;
  }
  try {
    res.json({ songs: await getCategorySongs(id) });
  } catch (error) {
    res.status(502).json({ error: 'Failed to load the category.', message: (error as Error).message });
  }
});
