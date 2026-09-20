import type { Song } from '../api/types';
import { getRecommendations } from './recommendationEngine';

const STORAGE_KEY = 'suwwara.weekly-discovery.v1';
const MIX_SIZE = 30;

interface StoredMix {
  weekKey: string;
  songs: Song[];
}

/**
 * ISO-8601 week number (e.g. "2026-W38") — used as the cache key so the mix
 * regenerates once a week instead of reshuffling on every visit like the
 * live "Rekomendasi Untukmu" row already does. Deliberately date-based
 * (not "N days since last generated") so it lands on the same real-world
 * week boundary for everyone, matching what "weekly" actually implies.
 */
function getIsoWeekKey(date: Date): string {
  const utc = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  // Thursday-of-this-week trick: ISO weeks belong to the year containing their Thursday.
  const dayNum = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1));
  const weekNum = Math.ceil(((utc.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${utc.getUTCFullYear()}-W${String(weekNum).padStart(2, '0')}`;
}

function readStoredMix(): StoredMix | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as StoredMix;
  } catch {
    return null;
  }
}

function writeStoredMix(mix: StoredMix): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(mix));
  } catch {
    // Storage full/unavailable (private browsing, quota) — the mix just
    // regenerates every visit instead of being stable for the week. Same
    // degrade-gracefully philosophy as the rest of this app's localStorage use.
  }
}

/**
 * A personalized "made for you" mix that stays stable for the calendar week
 * instead of reshuffling on every visit — built from the same history-based
 * recommendation engine as the live "Rekomendasi Untukmu" row (up-next-radio
 * similarity + artist affinity, see recommendationEngine.ts), just computed
 * once per week and cached instead of re-ranked on every render.
 */
export async function getWeeklyDiscoveryMix(): Promise<Song[]> {
  const weekKey = getIsoWeekKey(new Date());
  const stored = readStoredMix();
  if (stored && stored.weekKey === weekKey && stored.songs.length > 0) {
    return stored.songs;
  }

  const songs = await getRecommendations(new Set(), MIX_SIZE);
  if (songs.length > 0) writeStoredMix({ weekKey, songs });
  return songs;
}
