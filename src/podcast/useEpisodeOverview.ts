import { useEffect, useState } from 'react';
import { podcastApi } from './podcastApi';
import type { EpisodeOverview } from './types';

// The panel, the queue and the home shelf ask for the same few episodes; the server caches too (6h), this saves the
// round trip. Bounded: oldest dropped past the cap.
const MAX_CACHED = 40;
const cache = new Map<string, Promise<EpisodeOverview>>();

export function loadEpisodeOverview(id: string): Promise<EpisodeOverview> {
  let pending = cache.get(id);
  if (!pending) {
    pending = podcastApi.episode(id).catch((error: unknown) => {
      cache.delete(id);
      throw error;
    });
    cache.set(id, pending);
    while (cache.size > MAX_CACHED) cache.delete(cache.keys().next().value!);
  }
  return pending;
}

/** An episode's channel, date, description and related episodes, or null while loading (or when it can't be read). */
export function useEpisodeOverview(id: string | null): EpisodeOverview | null {
  const [overview, setOverview] = useState<{ id: string; data: EpisodeOverview } | null>(null);
  useEffect(() => {
    if (!id) return;
    let alive = true;
    loadEpisodeOverview(id)
      .then((data) => alive && setOverview({ id, data }))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [id]);
  return overview && overview.id === id ? overview.data : null;
}
