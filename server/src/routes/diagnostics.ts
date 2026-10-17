import { Router } from 'express';
import { rateLimited } from '../auth/rateLimit';
import { addPlaybackReport } from '../diagnostics/playbackReports';

/** A device's own note that playback went wrong (see diagnostics/playbackReports.ts). Needs only the session. */
export const diagnosticsRouter = Router();

diagnosticsRouter.post('/diagnostics/playback', (req, res) => {
  const username = req.session?.username ?? '';
  // A phone stuck retrying in the background must never be able to flood the ring: a few per minute is plenty.
  if (!username || rateLimited(`playback-report:${username}`, 20, 10 * 60 * 1000)) {
    res.status(204).end();
    return;
  }
  addPlaybackReport(username, req.body);
  res.status(204).end();
});
