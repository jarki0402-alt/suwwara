import { create } from 'zustand';

export type ViewName = 'home' | 'search' | 'library' | 'settings';
/**
 * `artist-mix:{artistName}` is a template literal type, not a fixed union
 * member — there can be several artist-mix tiles at once (see
 * topArtistMix.ts's getTopArtistMixes, MadeForYouSection.tsx), one per top
 * artist, so the id has to encode WHICH artist rather than being a single
 * fixed value like the other two.
 */
export type GeneratedCollectionId = 'weekly-discovery' | 'viral-indonesia' | `artist-mix:${string}`;

interface UiState {
  currentView: ViewName;
  isNowPlayingOpen: boolean;
  isQueueOpen: boolean;
  isJamSheetOpen: boolean;
  /** Non-null while the "Gabung Jam?" prompt (opened via a `?jam=<roomId>` link) is showing. */
  joinJamRoomId: string | null;
  isPairingSheetOpen: boolean;
  /** Non-null while the "Hubungkan device ini?" confirm prompt (opened via a `?pair=<code>` link) is showing. */
  incomingPairCode: string | null;
  /**
   * Lifted up from LibraryView's own local state so the desktop sidebar
   * (BottomNav, which lists playlists directly like Spotify's "Your Library")
   * can jump straight into a specific playlist's detail view instead of only
   * being able to switch to the Koleksi tab's own default sub-tab.
   */
  selectedPlaylistId: string | null;
  /** Non-null while a "made for you" tile's full track list is open (Home only). */
  openedCollectionId: GeneratedCollectionId | null;
  /**
   * Shared between NowPlayingView (which shows either art or lyrics based on
   * this) and MiniPlayer's desktop-only lyrics icon (which toggles it) —
   * lifted out of NowPlayingView's own local state so a control living in a
   * different component can drive the same panel content.
   */
  isLyricsOpen: boolean;
  /**
   * True fullscreen takeover for focused lyrics reading — desktop only,
   * triggered by MiniPlayer's "expand" icon. Distinct from isNowPlayingOpen
   * (the docked side panel): this hides the sidebar/main content/panel
   * entirely, unlike the panel which lets you keep browsing.
   */
  isNowPlayingFullscreen: boolean;
  setView: (view: ViewName) => void;
  openNowPlaying: () => void;
  closeNowPlaying: () => void;
  openQueue: () => void;
  closeQueue: () => void;
  openJamSheet: () => void;
  closeJamSheet: () => void;
  openJoinJamSheet: (roomId: string) => void;
  closeJoinJamSheet: () => void;
  openPairingSheet: () => void;
  closePairingSheet: () => void;
  openIncomingPair: (code: string) => void;
  closeIncomingPair: () => void;
  /** Switches to the Koleksi tab and opens this playlist's detail view directly. */
  openPlaylist: (playlistId: string) => void;
  closePlaylist: () => void;
  openCollection: (collectionId: GeneratedCollectionId) => void;
  closeCollection: () => void;
  toggleLyrics: () => void;
  setLyricsOpen: (open: boolean) => void;
  openFullscreenLyrics: () => void;
  closeFullscreenLyrics: () => void;
}

/** Always boots to Home — avoids resuming into a Now Playing sheet with nothing loaded. */
export const useUiStore = create<UiState>((set) => ({
  currentView: 'home',
  isNowPlayingOpen: false,
  isQueueOpen: false,
  isJamSheetOpen: false,
  joinJamRoomId: null,
  isPairingSheetOpen: false,
  incomingPairCode: null,
  selectedPlaylistId: null,
  openedCollectionId: null,
  isLyricsOpen: false,
  isNowPlayingFullscreen: false,
  setView: (view) => set({ currentView: view }),
  openNowPlaying: () => set({ isNowPlayingOpen: true }),
  closeNowPlaying: () => set({ isNowPlayingOpen: false, isQueueOpen: false, isLyricsOpen: false, isNowPlayingFullscreen: false }),
  openQueue: () => set({ isQueueOpen: true }),
  closeQueue: () => set({ isQueueOpen: false }),
  openJamSheet: () => set({ isJamSheetOpen: true }),
  closeJamSheet: () => set({ isJamSheetOpen: false }),
  openJoinJamSheet: (roomId) => set({ joinJamRoomId: roomId }),
  closeJoinJamSheet: () => set({ joinJamRoomId: null }),
  openPairingSheet: () => set({ isPairingSheetOpen: true }),
  closePairingSheet: () => set({ isPairingSheetOpen: false }),
  openIncomingPair: (code) => set({ incomingPairCode: code }),
  closeIncomingPair: () => set({ incomingPairCode: null }),
  openPlaylist: (playlistId) => set({ currentView: 'library', selectedPlaylistId: playlistId }),
  closePlaylist: () => set({ selectedPlaylistId: null }),
  openCollection: (collectionId) => set({ openedCollectionId: collectionId }),
  closeCollection: () => set({ openedCollectionId: null }),
  toggleLyrics: () => set((state) => ({ isLyricsOpen: !state.isLyricsOpen })),
  setLyricsOpen: (open) => set({ isLyricsOpen: open }),
  openFullscreenLyrics: () => set({ isNowPlayingFullscreen: true, isLyricsOpen: true, isNowPlayingOpen: true }),
  closeFullscreenLyrics: () => set({ isNowPlayingFullscreen: false }),
}));
