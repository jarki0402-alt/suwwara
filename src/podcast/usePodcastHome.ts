import { useEffect, useMemo, useState } from 'react';
import { podcastApi } from './podcastApi';
import { usePodcastStore } from './podcastStore';
import type { Episode, Pick, Progress } from './types';
import { loadEpisodeOverview } from './useEpisodeOverview';

const CONTINUE_LIMIT = 12;
const SIMILAR_LIMIT = 15;
// Similar episodes are drawn from the related videos of the last few episodes heard: one cached request each.
const SIMILAR_SEEDS = 2;

export interface PodcastHome {
  continuing: Progress[];
  newEpisodes: Episode[] | null;
  similar: Episode[];
  picks: Pick[];
}

/**
 * What the Podcast tab and the home shelf show: where you left off, what's new from the channels you follow, episodes
 * like the ones you heard (YouTube's own related videos of your last episodes), and the admin's picks. All of it is a
 * few cached reads: the feed (shared per channel on the server), one overview per seed, the picks.
 */
export function usePodcastHome(): PodcastHome {
  const follows = usePodcastStore((state) => state.follows);
  const progress = usePodcastStore((state) => state.progress);
  const [newEpisodes, setNewEpisodes] = useState<Episode[] | null>(null);
  const [similarSeeds, setSimilarSeeds] = useState<Episode[]>([]);
  const [picks, setPicks] = useState<Pick[]>([]);

  const continuing = useMemo(
    () =>
      Object.values(progress)
        .filter((p) => !p.finished && p.positionSec > 5)
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, CONTINUE_LIMIT),
    [progress],
  );
  const followKey = follows.map((f) => f.channelId).join(',');
  const seedKey = useMemo(
    () =>
      Object.values(progress)
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, SIMILAR_SEEDS)
        .map((p) => p.episode.id)
        .join(','),
    [progress],
  );

  useEffect(() => {
    let alive = true;
    if (!followKey) {
      setNewEpisodes([]);
      return;
    }
    podcastApi
      .feed()
      .then((episodes) => alive && setNewEpisodes(episodes))
      .catch(() => alive && setNewEpisodes([]));
    return () => {
      alive = false;
    };
  }, [followKey]);

  useEffect(() => {
    let alive = true;
    const seeds = seedKey ? seedKey.split(',') : [];
    void Promise.all(seeds.map((id) => loadEpisodeOverview(id).then((o) => o.related).catch(() => [] as Episode[]))).then((lists) => {
      if (alive) setSimilarSeeds(lists.flat());
    });
    return () => {
      alive = false;
    };
  }, [seedKey]);

  useEffect(() => {
    void podcastApi.picks().then(setPicks).catch(() => {});
  }, []);

  const similar = useMemo(() => {
    const seen = new Set<string>();
    return similarSeeds
      .filter((e) => {
        if (seen.has(e.id) || progress[e.id]) return false;
        seen.add(e.id);
        return true;
      })
      .slice(0, SIMILAR_LIMIT);
  }, [similarSeeds, progress]);

  return {
    continuing,
    newEpisodes: newEpisodes?.filter((e) => !progress[e.id]?.finished) ?? null,
    similar,
    picks,
  };
}
