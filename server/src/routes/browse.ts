import { Router } from 'express';
import { getBrowseSections } from '../youtube/browse';

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
