import { useEffect, useRef, useState } from 'react';
import type { Song } from '../api/types';
import { useHistoryStore } from '../stores/historyStore';
import { useIdleCallback } from '../hooks/useIdleCallback';
import { getRecommendations } from './recommendationEngine';

const MIN_RECOMPUTE_INTERVAL_MS = 30_000;

export function useRecommendations(excludeIds: string[]): { songs: Song[]; isLoading: boolean } {
  const [songs, setSongs] = useState<Song[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const eventCount = useHistoryStore((state) => state.events.length);
  const scheduleIdle = useIdleCallback();
  const lastComputedAtRef = useRef(0);
  const excludeIdsKey = excludeIds.join(',');

  useEffect(() => {
    const now = Date.now();
    if (now - lastComputedAtRef.current < MIN_RECOMPUTE_INTERVAL_MS) return;

    let cancelled = false;
    const cancelSchedule = scheduleIdle(() => {
      lastComputedAtRef.current = Date.now();
      const excludeSet = new Set(excludeIdsKey ? excludeIdsKey.split(',') : []);
      void getRecommendations(excludeSet).then((result) => {
        if (!cancelled) {
          setSongs(result);
          setIsLoading(false);
        }
      });
    });

    return () => {
      cancelled = true;
      cancelSchedule();
    };
    // eventCount triggers recompute after each new play event; excludeIdsKey covers queue/recent changes.
  }, [eventCount, excludeIdsKey, scheduleIdle]);

  return { songs, isLoading };
}
