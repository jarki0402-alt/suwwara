import type { Song } from '../api/types';
import { loadHistory, recentlyPlayedIds } from './historyLog';
import { getRecommendations } from './recommendationEngine';
import { getWeeklyDiscoveryMix } from './weeklyDiscovery';

const STORAGE_KEY = 'suwwara.daily-discovery.v1';
const MIX_SIZE = 30;
const RECENT_WINDOW_MS = 24 * 60 * 60 * 1000;

interface StoredMix {
  dayKey: string;
  songs: Song[];
}

/** Local calendar day, "2026-09-21" — the mix turns over at the listener's own midnight, not UTC's. */
export function dayKey(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function readStored(): StoredMix | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as StoredMix) : null;
  } catch {
    return null;
  }
}

function writeStored(mix: StoredMix): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(mix));
  } catch {
    // storage unavailable/full — the mix is then rebuilt on each visit instead of staying put for the day
  }
}

/**
 * "Temuan Harian": Temuan Mingguan's faster sibling. Same taste model (see recommendationEngine.ts), but it turns
 * over every day and deliberately skips whatever the weekly mix already holds and whatever was played in the last
 * 24 hours — so the two tiles never show the same songs, and today's list is what you have NOT just heard.
 * Stays put for the calendar day (cached), instead of reshuffling on every visit.
 */
export async function getDailyDiscoveryMix(): Promise<Song[]> {
  const today = dayKey(new Date());
  const stored = readStored();
  if (stored && stored.dayKey === today && stored.songs.length > 0) return stored.songs;

  const weekly = await getWeeklyDiscoveryMix().catch(() => [] as Song[]);
  const skip = new Set<string>([...weekly.map((song) => song.id), ...recentlyPlayedIds(RECENT_WINDOW_MS, loadHistory())]);

  const songs = await getRecommendations(skip, MIX_SIZE);
  if (songs.length > 0) writeStored({ dayKey: today, songs });
  return songs;
}
