import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Song } from '../api/types';
import { buildPlayOrder } from '../utils/shuffle';

export type RepeatMode = 'off' | 'all' | 'one';

const MAX_QUEUE_LENGTH = 200;

interface QueueState {
  queue: Song[];
  order: number[];
  position: number;
  repeatMode: RepeatMode;
  shuffle: boolean;
  setQueue: (songs: Song[], startAt?: number) => void;
  addToQueue: (song: Song) => void;
  removeFromQueue: (orderPosition: number) => void;
  reorder: (fromPosition: number, toPosition: number) => void;
  toggleShuffle: () => void;
  cycleRepeat: () => void;
  playAtPosition: (orderPosition: number) => Song | null;
  next: () => Song | null;
  previous: () => Song | null;
  advanceOnEnded: () => Song | null;
  currentSong: () => Song | null;
  /** Looks ahead to whatever advanceOnEnded() would play next, without changing position — used to prefetch its audio while the current track is still playing. */
  peekNext: () => Song | null;
  clear: () => void;
}

function songAt(queue: Song[], order: number[], position: number): Song | null {
  const queueIndex = order[position];
  if (queueIndex === undefined) return null;
  return queue[queueIndex] ?? null;
}

export const useQueueStore = create<QueueState>()(
  persist(
    (set, get) => ({
      queue: [],
      order: [],
      position: 0,
      repeatMode: 'off',
      shuffle: false,

      setQueue: (songs, startAt = 0) => {
        const { shuffle } = get();
        const capped = songs.slice(0, MAX_QUEUE_LENGTH);
        const clampedStart = Math.min(Math.max(startAt, 0), Math.max(capped.length - 1, 0));
        const order = buildPlayOrder(capped.length, shuffle, clampedStart);
        const position = Math.max(order.indexOf(clampedStart), 0);
        set({ queue: capped, order, position });
      },

      addToQueue: (song) => {
        const { queue, order, position } = get();
        if (queue.length >= MAX_QUEUE_LENGTH) {
          const dropPosition = order.findIndex((_, pos) => pos !== position);
          if (dropPosition === -1) return;
          get().removeFromQueue(dropPosition);
        }
        const state = get();
        const newQueueIndex = state.queue.length;
        set({ queue: [...state.queue, song], order: [...state.order, newQueueIndex] });
      },

      removeFromQueue: (orderPosition) => {
        const { queue, order, position } = get();
        if (orderPosition < 0 || orderPosition >= order.length) return;
        const removedQueueIndex = order[orderPosition];

        const newQueue = queue.filter((_, i) => i !== removedQueueIndex);
        const newOrder = order
          .filter((_, i) => i !== orderPosition)
          .map((idx) => (idx > removedQueueIndex ? idx - 1 : idx));

        let newPosition = position;
        if (orderPosition < position) newPosition -= 1;
        else if (orderPosition === position) newPosition = Math.min(newPosition, newOrder.length - 1);

        set({ queue: newQueue, order: newOrder, position: Math.max(newPosition, 0) });
      },

      reorder: (fromPosition, toPosition) => {
        const { order, position } = get();
        if (
          fromPosition === toPosition ||
          fromPosition < 0 ||
          toPosition < 0 ||
          fromPosition >= order.length ||
          toPosition >= order.length
        ) {
          return;
        }
        const newOrder = [...order];
        const [moved] = newOrder.splice(fromPosition, 1);
        newOrder.splice(toPosition, 0, moved);

        let newPosition = position;
        if (position === fromPosition) newPosition = toPosition;
        else if (fromPosition < position && toPosition >= position) newPosition -= 1;
        else if (fromPosition > position && toPosition <= position) newPosition += 1;

        set({ order: newOrder, position: newPosition });
      },

      toggleShuffle: () => {
        const { queue, order, position, shuffle } = get();
        const anchor = order[position] ?? 0;
        const nextShuffle = !shuffle;
        const newOrder = buildPlayOrder(queue.length, nextShuffle, anchor);
        set({ shuffle: nextShuffle, order: newOrder, position: Math.max(newOrder.indexOf(anchor), 0) });
      },

      cycleRepeat: () => {
        const { repeatMode } = get();
        const next: RepeatMode = repeatMode === 'off' ? 'all' : repeatMode === 'all' ? 'one' : 'off';
        set({ repeatMode: next });
      },

      playAtPosition: (orderPosition) => {
        const { queue, order } = get();
        if (orderPosition < 0 || orderPosition >= order.length) return null;
        set({ position: orderPosition });
        return songAt(queue, order, orderPosition);
      },

      next: () => {
        const { queue, order, position } = get();
        if (order.length === 0) return null;
        const nextPosition = position + 1 >= order.length ? 0 : position + 1;
        set({ position: nextPosition });
        return songAt(queue, order, nextPosition);
      },

      previous: () => {
        const { queue, order, position } = get();
        if (order.length === 0) return null;
        const prevPosition = position - 1 < 0 ? order.length - 1 : position - 1;
        set({ position: prevPosition });
        return songAt(queue, order, prevPosition);
      },

      /** Called when a track finishes naturally — respects repeatMode, unlike next()/previous(). */
      advanceOnEnded: () => {
        const { queue, order, position, repeatMode } = get();
        if (order.length === 0) return null;
        if (repeatMode === 'one') return songAt(queue, order, position);

        const wrap = repeatMode === 'all';
        let nextPosition = position + 1;
        if (nextPosition >= order.length) {
          if (!wrap) return null;
          nextPosition = 0;
        }
        set({ position: nextPosition });
        return songAt(queue, order, nextPosition);
      },

      currentSong: () => {
        const { queue, order, position } = get();
        return songAt(queue, order, position);
      },

      peekNext: () => {
        const { queue, order, position, repeatMode } = get();
        if (order.length === 0 || repeatMode === 'one') return null;
        let nextPosition = position + 1;
        if (nextPosition >= order.length) {
          if (repeatMode !== 'all') return null;
          nextPosition = 0;
        }
        return songAt(queue, order, nextPosition);
      },

      clear: () => set({ queue: [], order: [], position: 0 }),
    }),
    { name: 'suwwara-queue' },
  ),
);
