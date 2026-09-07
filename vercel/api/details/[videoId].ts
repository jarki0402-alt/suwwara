import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getSongDetails } from '../../lib/details';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const videoId = typeof req.query.videoId === 'string' ? req.query.videoId : '';

  try {
    const details = await getSongDetails(videoId);
    res.status(200).json(details);
  } catch (error) {
    res.status(502).json({ error: 'Failed to fetch video details.', message: (error as Error).message });
  }
}
