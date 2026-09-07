import type { VercelRequest, VercelResponse } from '@vercel/node';
import { searchSongs } from '../lib/search';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const query = typeof req.query.q === 'string' ? req.query.q : '';
  const limit = Math.min(Number(req.query.limit) || 20, 40);

  try {
    const songs = await searchSongs(query, limit);
    res.status(200).json({ songs });
  } catch (error) {
    res.status(502).json({ error: 'Search failed.', message: (error as Error).message });
  }
}
