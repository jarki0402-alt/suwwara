import { useEffect, useSyncExternalStore } from 'react';
import { bestImageUrl } from '../../api/mappers';
import type { ImageVariant } from '../../api/types';
import type { GeneratedCollectionId } from '../../stores/uiStore';
import { fetchCollectionSongs } from './useGeneratedCollection';

/*
 * Home's mix covers made from the songs inside (2026-11 redesign, like Spotify's): up to four different album covers
 * per mix. Fetched two mixes at a time, never all at once: each build is a few lookups the 1GB backend fans out
 * upstream. The mixes keep their songs for the day on the device, so after the first visit this is instant.
 * Remembered for the session here, so the tiles and the shelf share one fetch per mix.
 */
const COVERS_PER_MIX = 4;
const CONCURRENCY = 2;

const artwork = new Map<string, ImageVariant[][]>();
const requested = new Set<string>();
const queue: GeneratedCollectionId[] = [];
const listeners = new Set<() => void>();
let running = 0;
let version = 0;

/** Up to four covers, each from a different album (two songs of one album would repeat the same picture). */
function distinctCovers(images: ImageVariant[][]): ImageVariant[][] {
  const out: ImageVariant[][] = [];
  const seen = new Set<string>();
  for (const image of images) {
    const url = bestImageUrl(image, '150x150');
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push(image);
    if (out.length >= COVERS_PER_MIX) break;
  }
  return out;
}

function pump(): void {
  while (running < CONCURRENCY && queue.length > 0) {
    const id = queue.shift()!;
    running += 1;
    fetchCollectionSongs(id)
      .then((songs) => {
        const covers = distinctCovers(songs.map((song) => song.image));
        if (covers.length > 0) {
          artwork.set(id, covers);
          version += 1;
          for (const listener of listeners) listener();
        }
      })
      .catch(() => {
        // the drawn cover stays; a later visit tries again
        requested.delete(id);
      })
      .finally(() => {
        running -= 1;
        pump();
      });
  }
}

/** Asks for these mixes' covers (each at most once per session), in the order given. */
export function requestMixArtwork(ids: GeneratedCollectionId[]): void {
  for (const id of ids) {
    if (requested.has(id)) continue;
    requested.add(id);
    queue.push(id);
  }
  pump();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The covers of one mix, or null until they are in. */
export function useMixArtwork(id: GeneratedCollectionId): ImageVariant[][] | null {
  useSyncExternalStore(subscribe, () => version);
  return artwork.get(id) ?? null;
}

/** Starts fetching the covers of these mixes when the component shows. */
export function useRequestMixArtwork(ids: GeneratedCollectionId[]): void {
  const key = ids.join('|');
  useEffect(() => {
    requestMixArtwork(key ? (key.split('|') as GeneratedCollectionId[]) : []);
  }, [key]);
}
