import { useEffect, useSyncExternalStore } from 'react';
import { apiGet } from '../api/musicClient';
import type { Song } from '../api/types';

/**
 * Lengths for songs that arrived without one (an artist's top songs, chart rows — YouTube Music leaves the duration out
 * of those shelves). Rows report the ids they are missing; a short window collects them into ONE request, and the answers
 * land here so every row showing that song updates. Never asked for on a phone, where the duration is not shown.
 */
const BATCH_WINDOW_MS = 80;
const BATCH_SIZE = 30; // the endpoint's limit
const MAX_KNOWN = 1000;
const MAX_ASKED = 2000;

const known = new Map<string, number>();
const asked = new Set<string>();
const listeners = new Set<() => void>();
let queue: string[] = [];
let timer: ReturnType<typeof setTimeout> | undefined;

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// Songs that already carry a duration have nothing to wait for — they subscribe to nothing.
function subscribeNever(): () => void {
  return () => {};
}

async function flush(): Promise<void> {
  timer = undefined;
  const ids = queue;
  queue = [];
  for (let start = 0; start < ids.length; start += BATCH_SIZE) {
    const batch = ids.slice(start, start + BATCH_SIZE);
    try {
      const { durations } = await apiGet<{ durations: Record<string, number> }>('/api/durations', { ids: batch.join(',') });
      for (const [id, seconds] of Object.entries(durations)) known.set(id, seconds);
      while (known.size > MAX_KNOWN) {
        const oldest = known.keys().next().value;
        if (oldest === undefined) break;
        known.delete(oldest);
      }
      for (const listener of listeners) listener();
    } catch {
      // A missing duration is a blank cell, not an error worth showing; it is not asked again this session.
    }
  }
}

function request(id: string): void {
  if (known.has(id) || asked.has(id)) return;
  asked.add(id);
  if (asked.size > MAX_ASKED) asked.delete(asked.values().next().value as string);
  queue.push(id);
  timer ??= setTimeout(() => void flush(), BATCH_WINDOW_MS);
}

/** The song's length in seconds, or 0 while unknown. */
export function useSongDuration(song: Song): number {
  const missing = !(song.duration > 0);
  const looked = useSyncExternalStore(missing ? subscribe : subscribeNever, () => (missing ? (known.get(song.id) ?? 0) : 0));
  useEffect(() => {
    if (missing && window.matchMedia('(min-width: 960px)').matches) request(song.id);
  }, [missing, song.id]);
  return missing ? looked : song.duration;
}
