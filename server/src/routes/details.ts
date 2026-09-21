import { Router } from 'express';
import { getSongDetails } from '../youtube/details';
import { getDurations, MAX_DURATION_IDS, VIDEO_ID_PATTERN } from '../youtube/durations';

export const detailsRouter = Router();

detailsRouter.get('/details/:videoId', async (req, res) => {
  try {
    const details = await getSongDetails(req.params.videoId);
    res.json(details);
  } catch (error) {
    res.status(502).json({ error: 'Failed to fetch video details.', message: (error as Error).message });
  }
});

detailsRouter.get('/durations', async (req, res) => {
  const ids = String(req.query.ids ?? '')
    .split(',')
    .filter(Boolean);
  if (ids.length === 0 || ids.length > MAX_DURATION_IDS || !ids.every((id) => VIDEO_ID_PATTERN.test(id))) {
    res.status(400).json({ error: `Pass 1-${MAX_DURATION_IDS} comma-separated video ids.` });
    return;
  }
  try {
    res.json({ durations: await getDurations(ids) });
  } catch (error) {
    res.status(502).json({ error: 'Failed to look up durations.', message: (error as Error).message });
  }
});
