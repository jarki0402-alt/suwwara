import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { podcastApi } from './podcastApi';
import type { Episode, Follow, Progress } from './types';

/**
 * This account's podcast state: followed channels, where each episode was left, saved-for-later, and the listening
 * speed. The server (routes/podcast.ts) is the source of truth across devices; this persisted copy makes the tab
 * render at once and keeps working offline. Writes go to both, the server one fire-and-forget.
 */

// An episode counts as heard once this close to the end: outros and end cards are rarely listened to.
const FINISHED_REMAINING_SEC = 60;
const FINISHED_FRACTION = 0.95;
const MAX_PROGRESS = 300;
const MAX_QUEUE = 50;

export const SPEEDS = [1, 1.25, 1.5, 1.75, 2] as const;

export interface SleepTimer {
  /** Epoch ms when playback pauses, or null for "at the end of this episode". */
  endsAt: number | null;
  endOfEpisode: boolean;
}

/** The list an episode was started from, so "Berikutnya" can offer the one after it. */
export interface PlayContext {
  episodes: Episode[];
}

interface PodcastState {
  follows: Follow[];
  progress: Record<string, Progress>;
  saved: Episode[];
  speed: number;
  sleep: SleepTimer | null;
  context: PlayContext | null;
  /** Episodes the listener queued: the only thing an ending episode continues into (see usePlaybackController). */
  queue: Episode[];
  loadedAt: number;
  hydrate: () => Promise<void>;
  isFollowing: (channelId: string) => boolean;
  toggleFollow: (follow: Follow) => void;
  saveProgress: (episode: Episode, positionSec: number, durationSec: number) => void;
  markFinished: (episode: Episode, finished?: boolean) => void;
  isSaved: (id: string) => boolean;
  toggleSaved: (episode: Episode) => void;
  setSpeed: (speed: number) => void;
  setSleep: (sleep: SleepTimer | null) => void;
  setContext: (context: PlayContext | null) => void;
  isQueued: (id: string) => boolean;
  addToQueue: (episode: Episode) => void;
  removeFromQueue: (id: string) => void;
  /** Removes and returns the first queued episode, if any. */
  takeNextQueued: () => Episode | null;
}

export function isFinishedAt(positionSec: number, durationSec: number): boolean {
  return durationSec > 0 && (durationSec - positionSec <= FINISHED_REMAINING_SEC || positionSec / durationSec >= FINISHED_FRACTION);
}

function trimProgress(progress: Record<string, Progress>): Record<string, Progress> {
  const entries = Object.entries(progress);
  if (entries.length <= MAX_PROGRESS) return progress;
  return Object.fromEntries(entries.sort((a, b) => b[1].updatedAt - a[1].updatedAt).slice(0, MAX_PROGRESS));
}

export const usePodcastStore = create<PodcastState>()(
  persist(
    (set, get) => ({
      follows: [],
      progress: {},
      saved: [],
      speed: 1,
      sleep: null,
      context: null,
      queue: [],
      loadedAt: 0,

      hydrate: async () => {
        const remote = await podcastApi.state();
        const local = get().progress;
        const progress: Record<string, Progress> = {};
        for (const p of remote.progress) {
          progress[p.videoId] = { positionSec: p.positionSec, durationSec: p.durationSec, finished: p.finished, updatedAt: p.updatedAt, episode: p.episode };
        }
        // A position saved here while offline (newer than the server's) wins; it is sent again on the next save.
        for (const [id, p] of Object.entries(local)) {
          if (!progress[id] || progress[id].updatedAt < p.updatedAt) progress[id] = p;
        }
        set({ follows: remote.follows, saved: remote.saved.map((s) => s.episode), progress: trimProgress(progress), loadedAt: Date.now() });
      },

      isFollowing: (channelId) => get().follows.some((f) => f.channelId === channelId),

      toggleFollow: (follow) => {
        if (get().isFollowing(follow.channelId)) {
          set({ follows: get().follows.filter((f) => f.channelId !== follow.channelId) });
          void podcastApi.unfollow(follow.channelId).catch(() => {});
        } else {
          set({ follows: [follow, ...get().follows] });
          void podcastApi.follow(follow).catch(() => {});
        }
      },

      saveProgress: (episode, positionSec, durationSec) => {
        if (!(durationSec > 0) || positionSec < 0) return;
        const finished = isFinishedAt(positionSec, durationSec);
        const entry: Progress = { positionSec, durationSec, finished, updatedAt: Date.now(), episode };
        set({ progress: trimProgress({ ...get().progress, [episode.id]: entry }) });
        void podcastApi.progress(episode.id, { positionSec, durationSec, finished, episode }).catch(() => {});
      },

      markFinished: (episode, finished = true) => {
        const current = get().progress[episode.id];
        const durationSec = current?.durationSec || episode.durationSec || 0;
        const positionSec = finished ? durationSec : 0;
        const entry: Progress = { positionSec, durationSec, finished, updatedAt: Date.now(), episode };
        set({ progress: trimProgress({ ...get().progress, [episode.id]: entry }) });
        void podcastApi.progress(episode.id, { positionSec, durationSec, finished, episode }).catch(() => {});
      },

      isSaved: (id) => get().saved.some((e) => e.id === id),

      toggleSaved: (episode) => {
        if (get().isSaved(episode.id)) {
          set({ saved: get().saved.filter((e) => e.id !== episode.id) });
          void podcastApi.unsave(episode.id).catch(() => {});
        } else {
          set({ saved: [episode, ...get().saved] });
          void podcastApi.save(episode).catch(() => {});
        }
      },

      setSpeed: (speed) => set({ speed }),
      setSleep: (sleep) => set({ sleep }),
      setContext: (context) => set({ context }),

      isQueued: (id) => get().queue.some((e) => e.id === id),
      addToQueue: (episode) => {
        if (get().isQueued(episode.id)) return;
        set({ queue: [...get().queue, episode].slice(-MAX_QUEUE) });
      },
      removeFromQueue: (id) => set({ queue: get().queue.filter((e) => e.id !== id) }),
      takeNextQueued: () => {
        const [next, ...rest] = get().queue;
        if (!next) return null;
        set({ queue: rest });
        return next;
      },
    }),
    {
      name: 'suwwara-podcast',
      // The sleep timer and the play context belong to this listening session, not to the next launch.
      // The queue is kept on this device (like the song queue), not synced: it is what this device plays next.
      partialize: (state) => ({ follows: state.follows, progress: state.progress, saved: state.saved, speed: state.speed, queue: state.queue }),
    },
  ),
);

/** Where to start an episode: its saved position, unless it was finished (then from the top) or barely begun. */
export function resumePositionFor(id: string): number | null {
  const p = usePodcastStore.getState().progress[id];
  if (!p || p.finished || p.positionSec < 5) return null;
  return p.positionSec;
}

let started = false;

/** After sign-in (App.tsx), with the library sync. Pulls the account's state; again when the app comes back. */
export function initPodcastSync(): void {
  if (started) return;
  started = true;
  const pull = () => void usePodcastStore.getState().hydrate().catch(() => {});
  pull();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && Date.now() - usePodcastStore.getState().loadedAt > 60_000) pull();
  });
}
