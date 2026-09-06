import { create } from 'zustand';

interface PlayerState {
  currentSongId: string | null;
  isPlaying: boolean;
  isBuffering: boolean;
  error: string | null;
  setCurrentSongId: (id: string | null) => void;
  setPlaybackStatus: (status: { isPlaying: boolean; isBuffering: boolean; error: string | null }) => void;
}

/**
 * Ephemeral, non-persisted mirror of the audio engine's coarse state, kept in
 * sync by usePlaybackController. Never written to on a per-frame basis.
 */
export const usePlayerStore = create<PlayerState>((set) => ({
  currentSongId: null,
  isPlaying: false,
  isBuffering: false,
  error: null,
  setCurrentSongId: (id) => set({ currentSongId: id }),
  setPlaybackStatus: (status) => set(status),
}));
