import type { Song } from '../api/types';
import { useQueueStore } from '../stores/queueStore';

/**
 * Whether a song id is a podcast episode, for the audio layer's id-only functions (resolveAudioUrl, AudioCache),
 * which never see the Song. Known from the episodes built this session plus whatever sits in the (persisted) queue,
 * so an episode restored after a reload is still recognised.
 */
const ids = new Set<string>();
const MAX_IDS = 2000;

export const isEpisode = (song: Song | null | undefined): boolean => song?.kind === 'episode';

export function markEpisode(id: string): void {
  if (ids.size >= MAX_IDS) ids.clear();
  ids.add(id);
}

export function isEpisodeId(id: string): boolean {
  return ids.has(id) || useQueueStore.getState().queue.some((song) => song.id === id && song.kind === 'episode');
}
