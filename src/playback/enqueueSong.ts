import type { Song } from '../api/types';
import { addToQueue, playNext } from '../jam/jamQueueActions';
import { useQueueStore } from '../stores/queueStore';
import { playSongList } from './playSongList';

export type EnqueueResult = 'playing' | 'queued';

/**
 * "Putar Selanjutnya" / "Tambah ke Antrean" from a song's menu. With nothing in the queue there is nothing to be
 * "next" after — and no player on screen to press play on — so the song simply starts; otherwise it is slotted in
 * right after the current track (`next`) or at the end (`end`). Call from a tap handler: starting playback needs
 * the user gesture (see playSongList).
 */
export function enqueueSong(song: Song, where: 'next' | 'end'): EnqueueResult {
  if (useQueueStore.getState().order.length === 0) {
    playSongList([song], 0);
    return 'playing';
  }
  if (where === 'next') playNext(song);
  else addToQueue(song);
  return 'queued';
}
