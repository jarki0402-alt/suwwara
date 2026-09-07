import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getSimilarSongs } from '../../lib/similar';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const videoId = typeof req.query.videoId === 'string' ? req.query.videoId : '';
  const limit = Math.min(Number(req.query.limit) || 20, 30);

  try {
    const songs = await getSimilarSongs(videoId, limit);
    res.status(200).json({ songs });
  } catch (error) {
    res.status(502).json({ error: 'Failed to fetch similar songs.', message: (error as Error).message });
  }
}
