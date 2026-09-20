import { useEffect, useState } from 'react';
import type { Song } from '../api/types';
import { getTrendingSongs, getTrendingSongsIndonesia } from './trendingChart';

function useChart(fetcher: (limit: number) => Promise<Song[]>, limit: number): { songs: Song[]; isLoading: boolean } {
  const [songs, setSongs] = useState<Song[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    fetcher(limit)
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [limit, fetcher]);

  return { songs, isLoading };
}

export function useTrendingSongs(limit = 20): { songs: Song[]; isLoading: boolean } {
  return useChart(getTrendingSongs, limit);
}

export function useTrendingSongsIndonesia(limit = 20): { songs: Song[]; isLoading: boolean } {
  return useChart(getTrendingSongsIndonesia, limit);
}
