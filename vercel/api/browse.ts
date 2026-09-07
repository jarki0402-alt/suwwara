import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getBrowseSections } from '../lib/browse';

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  try {
    const sections = await getBrowseSections();
    res.status(200).json({ sections });
  } catch (error) {
    res.status(502).json({ error: 'Failed to fetch browse sections.', message: (error as Error).message });
  }
}
