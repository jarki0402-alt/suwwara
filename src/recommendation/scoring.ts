import type { Song } from '../api/types';
import type { PlayEvent } from './historyLog';

const HALF_LIFE_DAYS = 14;
const MS_PER_DAY = 86_400_000;

const WEIGHT_FREQUENCY = 1;
const WEIGHT_RECENCY = 2;
const WEIGHT_ARTIST_AFFINITY = 1.5;
const NEW_SONG_BOOST = 0.8;
const SKIPPED_PENALTY = 0.4;

export function recencyWeight(event: PlayEvent, now: number): number {
  const daysSince = Math.max(0, (now - event.timestamp) / MS_PER_DAY);
  const decay = Math.exp((-Math.LN2 * daysSince) / HALF_LIFE_DAYS);
  return decay * (event.completed ? 1 : SKIPPED_PENALTY);
}

/** Artist affinity normalized to 0..1 relative to the user's single most-played artist. */
export function computeArtistAffinity(history: PlayEvent[], now: number): Map<string, number> {
  const raw = new Map<string, number>();
  for (const event of history) {
    const weight = recencyWeight(event, now);
    for (const artistId of event.artistIds) {
      raw.set(artistId, (raw.get(artistId) ?? 0) + weight);
    }
  }
  let max = 0;
  raw.forEach((value) => {
    if (value > max) max = value;
  });
  const safeMax = max > 0 ? max : 1;
  const normalized = new Map<string, number>();
  raw.forEach((value, key) => normalized.set(key, value / safeMax));
  return normalized;
}

function averageAffinity(artistIds: string[], affinity: Map<string, number>): number {
  if (artistIds.length === 0) return 0;
  const total = artistIds.reduce((sum, id) => sum + (affinity.get(id) ?? 0), 0);
  return total / artistIds.length;
}

/**
 * Pure arithmetic scoring — no DOM access, no nested loops over large data,
 * cheap enough to run on a low-end phone's main thread every time (see
 * recommendationEngine.ts for how often it actually runs).
 */
export function scoreCandidate(song: Song, history: PlayEvent[], affinity: Map<string, number>, now: number): number {
  const artistIds = song.artists.primary.map((artist) => artist.id);
  const songEvents = history.filter((event) => event.songId === song.id);
  const avgAffinity = averageAffinity(artistIds, affinity);

  if (songEvents.length === 0) {
    return WEIGHT_ARTIST_AFFINITY * avgAffinity * NEW_SONG_BOOST;
  }

  const frequency = songEvents.length;
  const recencyScore = songEvents.reduce((sum, event) => sum + recencyWeight(event, now), 0);
  return WEIGHT_FREQUENCY * frequency + WEIGHT_RECENCY * recencyScore + WEIGHT_ARTIST_AFFINITY * avgAffinity;
}
