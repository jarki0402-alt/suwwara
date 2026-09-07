import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getSearchSuggestions } from '../../lib/search';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const query = typeof req.query.q === 'string' ? req.query.q : '';
  if (query.trim().length === 0) {
    res.status(200).json({ suggestions: [] });
    return;
  }

  try {
    const suggestions = await getSearchSuggestions(query);
    res.status(200).json({ suggestions });
  } catch (error) {
    res.status(502).json({ error: 'Failed to fetch search suggestions.', message: (error as Error).message });
  }
}
