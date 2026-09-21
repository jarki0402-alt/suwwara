/**
 * The per-account "profile": play history + the current daily/weekly mixes. Pure (no database), so the rules are
 * testable: sanitising what a client sends, and merging two copies into one that both sides can adopt.
 *
 * Merging is commutative and repeatable — a device can send its copy any number of times and every device ends up with
 * the same result — which is why this needs no version numbers or conflict answers, unlike the library snapshot.
 */
export interface PlayEvent {
  songId: string;
  artistIds: string[];
  timestamp: number;
  completed: boolean;
}

export interface Mix {
  songs: Array<Record<string, unknown>>;
  weekKey?: string;
  dayKey?: string;
}

export interface Profile {
  history: PlayEvent[];
  /** When the person last cleared their history: nothing older comes back from another device. */
  clearedAt: number;
  weekly: (Mix & { weekKey: string }) | null;
  daily: (Mix & { dayKey: string }) | null;
}

export const MAX_HISTORY = 300;
const MAX_MIX_SONGS = 60;
const MAX_MIX_BYTES = 200_000;
const KEY_PATTERN = /^\d{4}-(W\d{2}|\d{2}-\d{2})$/;

function isEvent(value: unknown): value is PlayEvent {
  if (typeof value !== 'object' || value === null) return false;
  const event = value as Record<string, unknown>;
  return (
    typeof event.songId === 'string' &&
    event.songId.length > 0 &&
    event.songId.length <= 40 &&
    Array.isArray(event.artistIds) &&
    event.artistIds.length <= 12 &&
    event.artistIds.every((id) => typeof id === 'string' && id.length <= 120) &&
    typeof event.timestamp === 'number' &&
    Number.isFinite(event.timestamp) &&
    typeof event.completed === 'boolean'
  );
}

function sanitizeMix(value: unknown, keyName: 'weekKey' | 'dayKey'): (Mix & Record<string, string>) | null {
  if (typeof value !== 'object' || value === null) return null;
  const mix = value as Record<string, unknown>;
  const key = mix[keyName];
  if (typeof key !== 'string' || !KEY_PATTERN.test(key) || !Array.isArray(mix.songs)) return null;
  const songs = mix.songs.slice(0, MAX_MIX_SONGS).filter((song): song is Record<string, unknown> => typeof song === 'object' && song !== null && typeof (song as Record<string, unknown>).id === 'string');
  if (songs.length === 0 || JSON.stringify(songs).length > MAX_MIX_BYTES) return null;
  return { [keyName]: key, songs } as Mix & Record<string, string>;
}

/** Whatever arrived over the wire, reduced to something safe to store and merge. */
export function sanitizeProfile(raw: unknown): Profile {
  const input = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const history = Array.isArray(input.history) ? input.history.filter(isEvent).slice(-MAX_HISTORY) : [];
  const clearedAt = typeof input.clearedAt === 'number' && Number.isFinite(input.clearedAt) && input.clearedAt > 0 ? Math.floor(input.clearedAt) : 0;
  return {
    history,
    clearedAt,
    weekly: sanitizeMix(input.weekly, 'weekKey') as Profile['weekly'],
    daily: sanitizeMix(input.daily, 'dayKey') as Profile['daily'],
  };
}

function newer<T>(stored: T | null, incoming: T | null, keyOf: (mix: T) => string): T | null {
  if (!stored) return incoming;
  if (!incoming) return stored;
  // ISO week / ISO date keys sort as text. On a tie the stored one wins: the first device to publish a day's mix decides it.
  return keyOf(incoming) > keyOf(stored) ? incoming : stored;
}

export function mergeProfile(stored: Profile, incoming: Profile): Profile {
  const clearedAt = Math.max(stored.clearedAt, incoming.clearedAt);
  const seen = new Set<string>();
  const history: PlayEvent[] = [];
  for (const event of [...stored.history, ...incoming.history]) {
    const key = `${event.songId}|${event.timestamp}`;
    if (event.timestamp <= clearedAt || seen.has(key)) continue;
    seen.add(key);
    history.push(event);
  }
  history.sort((a, b) => a.timestamp - b.timestamp);
  return {
    history: history.slice(-MAX_HISTORY),
    clearedAt,
    weekly: newer(stored.weekly, incoming.weekly, (mix) => mix.weekKey),
    daily: newer(stored.daily, incoming.daily, (mix) => mix.dayKey),
  };
}
