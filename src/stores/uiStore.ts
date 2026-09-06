import { create } from 'zustand';

export type ViewName = 'home' | 'search' | 'library' | 'settings';

interface UiState {
  currentView: ViewName;
  isNowPlayingOpen: boolean;
  isQueueOpen: boolean;
  isJamSheetOpen: boolean;
  /** Non-null while the "Gabung Jam?" prompt (opened via a `?jam=<roomId>` link) is showing. */
  joinJamRoomId: string | null;
  setView: (view: ViewName) => void;
  openNowPlaying: () => void;
  closeNowPlaying: () => void;
  openQueue: () => void;
  closeQueue: () => void;
  openJamSheet: () => void;
  closeJamSheet: () => void;
  openJoinJamSheet: (roomId: string) => void;
  closeJoinJamSheet: () => void;
}

/** Always boots to Home — avoids resuming into a Now Playing sheet with nothing loaded. */
export const useUiStore = create<UiState>((set) => ({
  currentView: 'home',
  isNowPlayingOpen: false,
  isQueueOpen: false,
  isJamSheetOpen: false,
  joinJamRoomId: null,
  setView: (view) => set({ currentView: view }),
  openNowPlaying: () => set({ isNowPlayingOpen: true }),
  closeNowPlaying: () => set({ isNowPlayingOpen: false, isQueueOpen: false }),
  openQueue: () => set({ isQueueOpen: true }),
  closeQueue: () => set({ isQueueOpen: false }),
  openJamSheet: () => set({ isJamSheetOpen: true }),
  closeJamSheet: () => set({ isJamSheetOpen: false }),
  openJoinJamSheet: (roomId) => set({ joinJamRoomId: roomId }),
  closeJoinJamSheet: () => set({ joinJamRoomId: null }),
}));
