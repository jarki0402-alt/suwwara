import { useSyncExternalStore } from 'react';
import { useUiStore, type GeneratedCollectionId, LIKED_SONGS_ID } from '../../stores/uiStore';

/**
 * What the Home shortcut tiles show (2026-11 redesign): the collections this device opened last, Spotify's "jump back
 * in". Local to the device (localStorage), capped, newest first. Fed by watching the UI store, so no screen has to
 * remember to report an open; the liked-songs tile reports itself (opening Koleksi alone is not opening it).
 */
export type RecentCollection = { type: 'liked' } | { type: 'playlist'; id: string } | { type: 'mix'; id: GeneratedCollectionId };

const STORAGE_KEY = 'suwwara.recent-collections.v1';
const MAX_ENTRIES = 8;
const listeners = new Set<() => void>();

function keyOf(entry: RecentCollection): string {
  return entry.type === 'liked' ? 'liked' : `${entry.type}:${entry.id}`;
}

function read(): RecentCollection[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') as unknown;
    return Array.isArray(parsed) ? (parsed as RecentCollection[]).slice(0, MAX_ENTRIES) : [];
  } catch {
    return [];
  }
}

let snapshot: RecentCollection[] = read();

export function recordRecentCollection(entry: RecentCollection): void {
  const key = keyOf(entry);
  snapshot = [entry, ...snapshot.filter((item) => keyOf(item) !== key)].slice(0, MAX_ENTRIES);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    // storage blocked: still shown for this session
  }
  for (const listener of listeners) listener();
}

export function useRecentCollections(): RecentCollection[] {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => snapshot,
  );
}

// One subscription for the app's lifetime (this module is loaded with Home, at startup).
useUiStore.subscribe((state, previous) => {
  if (state.openedCollectionId && state.openedCollectionId !== previous.openedCollectionId) {
    recordRecentCollection({ type: 'mix', id: state.openedCollectionId });
  }
  // Lagu Disukai records itself as 'liked' where it is opened (QuickTiles); it isn't a playlist id.
  if (state.selectedPlaylistId && state.selectedPlaylistId !== LIKED_SONGS_ID && state.selectedPlaylistId !== previous.selectedPlaylistId) {
    recordRecentCollection({ type: 'playlist', id: state.selectedPlaylistId });
  }
});
