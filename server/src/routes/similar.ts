import { Router } from 'express';
import { getSimilarSongs } from '../youtube/similar';

export const similarRouter = Router();

/** Used by the recommendation engine's candidate pool — "songs similar to this one" rather than "more songs by this artist". */
similarRouter.get('/similar/:videoId', async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 20, 30);

  try {
    const songs = await getSimilarSongs(req.params.videoId, limit);
    res.json({ songs });
  } catch (error) {
    res.status(502).json({ error: 'Failed to fetch similar songs.', message: (error as Error).message });
  }
});
