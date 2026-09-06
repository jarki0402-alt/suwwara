import type { Song } from '../api/types';
import { getSimilarSongs } from '../api/endpoints/similar';
import { getCachedSongs } from '../api/songCache';
import { loadHistory, type PlayEvent } from './historyLog';
import { computeArtistAffinity, scoreCandidate } from './scoring';

const CANDIDATE_POOL_CAP = 100;
const SIMILAR_SEED_COUNT = 5;

/** Most recently played distinct song ids, newest first — used to seed "similar songs" lookups. */
export function recentDistinctSongIds(history: PlayEvent[], limit: number): string[] {
  const seen = new Set<string>();
  const ids: string[] = [];
  for (let i = history.length - 1; i >= 0 && ids.length < limit; i--) {
    const { songId } = history[i];
    if (seen.has(songId)) continue;
    seen.add(songId);
    ids.push(songId);
  }
  return ids;
}

/**
 * Builds candidates from what's actually similar to what you've been
 * listening to (via YouTube Music's own "up next" radio signal), seeded from
 * several recent tracks rather than "more songs by your #1 artist" — the
 * latter is what made recommendations orbit a single artist instead of
 * surfacing varied, genuinely similar songs.
 */
async function buildCandidatePool(history: PlayEvent[]): Promise<Song[]> {
  const seen = new Set<string>();
  const pool: Song[] = [];

  const historySongIds = [...new Set(history.map((event) => event.songId))];
  for (const song of getCachedSongs(historySongIds)) {
    if (seen.has(song.id)) continue;
    seen.add(song.id);
    pool.push(song);
  }

  const seedIds = recentDistinctSongIds(history, SIMILAR_SEED_COUNT);
  const results = await Promise.allSettled(seedIds.map((id) => getSimilarSongs(id)));
  for (const result of results) {
    if (result.status !== 'fulfilled') continue;
    for (const song of result.value) {
      if (pool.length >= CANDIDATE_POOL_CAP) break;
      if (seen.has(song.id)) continue;
      seen.add(song.id);
      pool.push(song);
    }
  }

  return pool;
}

export async function getRecommendations(excludeIds: Set<string> = new Set(), limit = 20): Promise<Song[]> {
  const history = loadHistory();
  const now = Date.now();
  const affinity = computeArtistAffinity(history, now);
  const pool = await buildCandidatePool(history);

  return pool
    .filter((song) => !excludeIds.has(song.id))
    .map((song) => ({ song, score: scoreCandidate(song, history, affinity, now) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((entry) => entry.song);
}
