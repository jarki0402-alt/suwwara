const STORAGE_KEY = 'suwwara-history';
const MAX_ENTRIES = 300;

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
  } catch {
    // ignore
  }
}
