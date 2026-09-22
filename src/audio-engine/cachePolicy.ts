/**
 * What the offline song cache keeps. Pure — no IndexedDB, no clock — so the rules can be tested on their own; AudioCache
 * gathers the records, asks here which to drop, and deletes them.
 *
 * Two rules, applied in this order:
 *  1. Retention: a track nobody played for `maxAgeMs` is dropped (its timestamp is the last play, or the download).
 *  2. Budget: while the rest is over `maxBytes` (or `maxEntries`), the least recently played goes first.
 * The newest track is never dropped by the budget rule — a limit smaller than one track must not delete what was just
 * downloaded for the very next song.
 */
export interface CacheLimits {
  maxBytes: number;
  /** Infinity = keep forever. */
  maxAgeMs: number;
  /** A safety net on the number of keys, not a user setting. */
  maxEntries: number;
}

export interface CacheRecord {
  key: string;
  size: number;
  timestamp: number;
}

export function planEviction(records: CacheRecord[], limits: CacheLimits, now: number): string[] {
  const doomed = new Set<string>();
  const oldestFirst = [...records].sort((a, b) => a.timestamp - b.timestamp);

  const kept = oldestFirst.filter((record) => {
    const expired = Number.isFinite(limits.maxAgeMs) && now - record.timestamp > limits.maxAgeMs;
    if (expired) doomed.add(record.key);
    return !expired;
  });

  let total = kept.reduce((sum, record) => sum + record.size, 0);
  let count = kept.length;
  for (let index = 0; index < kept.length - 1 && (total > limits.maxBytes || count > limits.maxEntries); index += 1) {
    doomed.add(kept[index].key);
    total -= kept[index].size;
    count -= 1;
  }
  return [...doomed];
}

/** Choices offered in Pengaturan for the auto-cache's own retention window (days). 0 = never expire. Only ever
 * applies to the opportunistic cache (AudioCache) — a deliberate download (downloads/downloadManager.ts) is
 * never subject to this, however long it's gone unplayed. */
export const CACHE_RETENTION_OPTIONS_DAYS = [7, 30, 90, 0] as const;
export const DEFAULT_CACHE_RETENTION_DAYS = 30;
