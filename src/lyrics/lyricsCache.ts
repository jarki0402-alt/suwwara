import type { LyricsPayload } from '../api/endpoints/lyrics';

/**
 * The last few songs' lyrics on this device, so reopening a song (or reopening the app on a bad connection) shows its
 * words at once instead of waiting on the network. Only real answers are kept — never "none", and never a failure.
 * Small on purpose: a few KB per song, at most MAX_ENTRIES of them.
 */
const STORAGE_KEY = 'suwwara-lyrics-cache';
const MAX_ENTRIES = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
// Plain text is kept briefly: the server rechecks it weekly for a synced version, and so should we, sooner.
const MAX_AGE_MS: Record<'synced' | 'plain' | 'instrumental', number> = { synced: 30 * DAY_MS, instrumental: 30 * DAY_MS, plain: 2 * DAY_MS };

type Storable = Exclude<LyricsPayload, { type: 'none' }>;
interface Entry {
  id: string;
  at: number;
  payload: Storable;
}

function load(): Entry[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
    return Array.isArray(parsed) ? (parsed as Entry[]) : [];
  } catch {
    return [];
  }
}

export function readCachedLyrics(songId: string): Storable | null {
  const entry = load().find((item) => item.id === songId);
  if (!entry || !(entry.payload?.type in MAX_AGE_MS)) return null;
  return Date.now() - entry.at <= MAX_AGE_MS[entry.payload.type as keyof typeof MAX_AGE_MS] ? entry.payload : null;
}

export function writeCachedLyrics(songId: string, payload: LyricsPayload): void {
  if (payload.type === 'none') return;
  try {
    const entries = [{ id: songId, at: Date.now(), payload }, ...load().filter((item) => item.id !== songId)].slice(0, MAX_ENTRIES);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // private mode / quota — the in-memory copy still serves this session
  }
}
