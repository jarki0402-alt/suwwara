import { Router } from 'express';
import { getArtistTopSongs } from '../youtube/artist';

export const artistRouter = Router();

artistRouter.get('/artist/:name/songs', async (req, res) => {
  const { name } = req.params;
  if (!name || name.trim().length === 0) {
    res.status(400).json({ error: 'Artist name is required.' });
    return;
  }

  try {
    const result = await getArtistTopSongs(name);
    if (!result) {
      res.status(404).json({ error: 'Artist not found.' });
      return;
    }
    res.json(result);
  } catch (error) {
    res.status(502).json({ error: 'Failed to fetch artist songs.', message: (error as Error).message });
  }
});
