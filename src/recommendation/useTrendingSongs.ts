import { useEffect, useState } from 'react';
import type { Song } from '../api/types';
import { getTrendingSongs } from './trendingChart';

export function useTrendingSongs(limit = 20): { songs: Song[]; isLoading: boolean } {
  const [songs, setSongs] = useState<Song[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    getTrendingSongs(limit)
      .then((result) => {
        if (!cancelled) setSongs(result);
      })
      .catch(() => {
        // Chart temporarily unreachable — Home simply omits the section (see TopChartSection).
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [limit]);

  return { songs, isLoading };
}
