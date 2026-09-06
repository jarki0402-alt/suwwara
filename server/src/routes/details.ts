import { Router } from 'express';
import { getSongDetails } from '../youtube/details';

export const detailsRouter = Router();

detailsRouter.get('/details/:videoId', async (req, res) => {
  try {
    const details = await getSongDetails(req.params.videoId);
    res.json(details);
  } catch (error) {
    res.status(502).json({ error: 'Failed to fetch video details.', message: (error as Error).message });
  }
});
