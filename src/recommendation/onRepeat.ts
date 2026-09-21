import { getCachedSongs } from '../api/songCache';
import type { Song } from '../api/types';
import { loadHistory, type PlayEvent } from './historyLog';

const WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
const MIX_SIZE = 30;
/** Fewer distinct songs than this is not a "what you keep playing" list yet. */
const MIN_SONGS = 3;

/** Song ids by how often they were played in the window, most-played first (ties: the more recent play wins). */
export function rankByPlays(history: PlayEvent[], now: number, size = MIX_SIZE): string[] {
  const tally = new Map<string, { plays: number; lastAt: number }>();
  for (const event of history) {
    if (now - event.timestamp > WINDOW_MS) continue;
    const entry = tally.get(event.songId) ?? { plays: 0, lastAt: 0 };
    entry.plays += 1;
    entry.lastAt = Math.max(entry.lastAt, event.timestamp);
    tally.set(event.songId, entry);
  }
  return [...tally.entries()]
    .sort((a, b) => b[1].plays - a[1].plays || b[1].lastAt - a[1].lastAt)
    .slice(0, size)
    .map(([songId]) => songId);
}

/** "Sering Kamu Putar" (Spotify's On Repeat): the songs you have played most in the last 30 days — no network, just your own history. */
export async function getOnRepeatMix(): Promise<Song[]> {
  const ids = rankByPlays(loadHistory(), Date.now());
  const songs = getCachedSongs(ids);
  return songs.length >= MIN_SONGS ? songs : [];
}
