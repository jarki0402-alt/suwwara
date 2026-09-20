import { Router } from 'express';
import { getLyrics, LyricsUnavailableError } from '../youtube/lyrics';

export const lyricsRouter = Router();

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

lyricsRouter.get('/lyrics/:videoId', async (req, res) => {
  const { videoId } = req.params;
  if (!VIDEO_ID.test(videoId)) {
    res.status(400).json({ error: 'Invalid video id.' });
    return;
  }

  try {
    res.json(await getLyrics(videoId));
  } catch (error) {
    // 503, not a "none" answer: the client must be able to tell "no lyrics exist" from "couldn't check right now".
    const unavailable = error instanceof LyricsUnavailableError;
    res.status(unavailable ? 503 : 502).json({ error: 'Lyrics are not available right now.', message: (error as Error).message });
  }
});
