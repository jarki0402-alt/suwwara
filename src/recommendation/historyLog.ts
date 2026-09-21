const STORAGE_KEY = 'suwwara-history';
const MAX_ENTRIES = 300;
const CLEARED_KEY = 'suwwara-history-cleared';

export interface PlayEvent {
  songId: string;
  artistIds: string[];
  timestamp: number;
  completed: boolean;
}

function isPlayEvent(value: unknown): value is PlayEvent {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.songId === 'string' &&
    Array.isArray(record.artistIds) &&
    record.artistIds.every((id) => typeof id === 'string') &&
    typeof record.timestamp === 'number' &&
    typeof record.completed === 'boolean'
  );
}

export function loadHistory(): PlayEvent[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isPlayEvent);
  } catch {
    return [];
  }
}

/** Appends an event and slices to the last MAX_ENTRIES before writing — the write cost/blob size stays bounded regardless of app lifetime. */
export function recordPlay(event: PlayEvent): PlayEvent[] {
  const next = [...loadHistory(), event].slice(-MAX_ENTRIES);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Storage full/unavailable (e.g. iOS ITP eviction, private browsing) — recommendations degrade gracefully to whatever was already loaded in memory.
  }
  return next;
}

/** When the person last cleared their history (ms), 0 if never. Sync uses it so a cleared history is not restored by another device. */
export function historyClearedAt(): number {
  try {
    return Number(localStorage.getItem(CLEARED_KEY)) || 0;
  } catch {
    return 0;
  }
}

/** Replaces the log with a merged copy from the account (see sync/profileSync.ts). */
export function replaceHistory(events: PlayEvent[], clearedAt: number): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(events.slice(-MAX_ENTRIES)));
    localStorage.setItem(CLEARED_KEY, String(clearedAt));
  } catch {
    // the in-memory copy still works for this session
  }
}

/** Same rule the server applies (server/src/library/profileMerge.ts): union by song+time, nothing older than the last clear, newest 300. */
export function mergeHistory(a: PlayEvent[], b: PlayEvent[], clearedAt: number): PlayEvent[] {
  const seen = new Set<string>();
  const merged: PlayEvent[] = [];
  for (const event of [...a, ...b]) {
    const key = `${event.songId}|${event.timestamp}`;
    if (event.timestamp <= clearedAt || seen.has(key)) continue;
    seen.add(key);
    merged.push(event);
  }
  return merged.sort((x, y) => x.timestamp - y.timestamp).slice(-MAX_ENTRIES);
}

/** Song IDs played within the last `windowMs` — used to keep the radio queue from
 * resurfacing something the user just heard, while still letting it come back
 * around after enough time has passed that it won't feel like repetition. */
export function recentlyPlayedIds(windowMs: number, history: PlayEvent[] = loadHistory()): Set<string> {
  const cutoff = Date.now() - windowMs;
  return new Set(history.filter((event) => event.timestamp >= cutoff).map((event) => event.songId));
}

export function clearHistory(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.setItem(CLEARED_KEY, String(Date.now()));
  } catch {
    // ignore
  }
}
