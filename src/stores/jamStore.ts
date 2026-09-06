import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Song } from '../api/types';
import { generateId } from '../utils/idGen';
import type { RepeatMode } from './queueStore';

export type JamRole = 'solo' | 'jam';

export interface JamPlaybackMeta {
  isPlaying: boolean;
  positionSec: number;
  lastUpdatedAtMs: number;
}

export interface QueueSnapshot {
  queue: Song[];
  order: number[];
  position: number;
  repeatMode: RepeatMode;
  shuffle: boolean;
}

interface JamState {
  /** Persisted forever — this is the "unique id per device" the app uses to
   * identify itself to the Jam server (room membership, creator check). */
  clientId: string;
  role: JamRole;
  roomId: string | null;
  isCreator: boolean;
  memberCount: number;
  playbackMeta: JamPlaybackMeta | null;
  /** The device's own solo queue right before joining/creating a Jam — restored
   * verbatim when the Jam ends so nobody's personal queue is lost. Persisted
   * (see partialize below) alongside role/roomId/isCreator: a PWA tab commonly
   * gets reloaded by the OS the moment it's backgrounded (e.g. switching away
   * to actually share the Jam link) — without persisting these, that silent
   * reload dropped the device out of the Jam with no indication, AND would
   * have lost the pre-Jam queue forever if it happened before ever leaving. */
  preJamQueueSnapshot: QueueSnapshot | null;
  enterJam: (params: { roomId: string; isCreator: boolean; queueSnapshotToRestore: QueueSnapshot }) => void;
  /** Clears Jam state and returns the snapshot to restore — caller applies it to queueStore. */
  exitJam: () => QueueSnapshot | null;
  setMemberCount: (count: number) => void;
  setPlaybackMeta: (meta: JamPlaybackMeta) => void;
}

export const useJamStore = create<JamState>()(
  persist(
    (set, get) => ({
      clientId: generateId(),
      role: 'solo',
      roomId: null,
      isCreator: false,
      memberCount: 0,
      playbackMeta: null,
      preJamQueueSnapshot: null,

      enterJam: ({ roomId, isCreator, queueSnapshotToRestore }) =>
        set({
          role: 'jam',
          roomId,
          isCreator,
          memberCount: 1,
          playbackMeta: null,
          preJamQueueSnapshot: queueSnapshotToRestore,
        }),

      exitJam: () => {
        const snapshot = get().preJamQueueSnapshot;
        set({
          role: 'solo',
          roomId: null,
          isCreator: false,
          memberCount: 0,
          playbackMeta: null,
          preJamQueueSnapshot: null,
        });
        return snapshot;
      },

      setMemberCount: (count) => set({ memberCount: count }),
      setPlaybackMeta: (meta) => set({ playbackMeta: meta }),
    }),
    {
      name: 'suwwara-jam',
      partialize: (state) => ({
        clientId: state.clientId,
        role: state.role,
        roomId: state.roomId,
        isCreator: state.isCreator,
        preJamQueueSnapshot: state.preJamQueueSnapshot,
      }),
    },
  ),
);
