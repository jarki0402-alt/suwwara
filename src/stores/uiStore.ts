import { create } from 'zustand';
import { withViewTransition } from '../utils/viewTransition';

export type ViewName = 'home' | 'search' | 'library' | 'settings' | 'admin';
/**
 * `artist-mix:{artistName}` is a template literal type, not a fixed union
 * member — there can be several artist-mix tiles at once (see
 * topArtistMix.ts's getTopArtistMixes, MadeForYouSection.tsx), one per top
 * artist, so the id has to encode WHICH artist rather than being a single
 * fixed value like the other two.
 */
export type GeneratedCollectionId = 'weekly-discovery' | 'daily-discovery' | 'on-repeat' | 'viral-indonesia' | `artist-mix:${string}`;

/**
 * Artist and album pages are pushed on top of whichever menu is open (Spotify-style) rather than
 * being a menu of their own; the back button pops one level, and switching menu clears them.
 * `name` is only there for songs saved before artist ids existed — the page resolves it on open.
 */
export type DetailRoute = { type: 'artist'; artistId: string | null; name?: string } | { type: 'album'; albumId: string };

interface UiState {
  currentView: ViewName;
  /** 'show' = this device displays a QR to be linked; 'scan' = this device scans one (or confirms a code that arrived as a link). */
  linkSheet: 'none' | 'show' | 'scan';
  isConnectSheetOpen: boolean;
  linkPrefillCode: string | null;
  /** Bumped whenever the set of linked devices changes, so the Settings list refetches. */
  linkedDevicesTick: number;
  detailStack: DetailRoute[];
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
  openConnectSheet: () => void;
  closeConnectSheet: () => void;
  openLinkShow: () => void;
  openLinkScan: (prefillCode?: string) => void;
  closeLinkSheet: () => void;
  bumpLinkedDevices: () => void;
  setView: (view: ViewName) => void;
  openArtist: (target: { artistId?: string | null; name?: string }) => void;
  openAlbum: (albumId: string) => void;
  closeDetail: () => void;
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

/**
 * Going to an artist/album from Now Playing: on a phone Now Playing is a fullscreen sheet that
 * would sit on top of the page being opened, so it closes; on desktop it is a docked side panel
 * that is meant to stay next to the content (only its fullscreen-lyrics takeover has to go).
 */
function leaveNowPlaying(): Partial<UiState> {
  const isDesktop = typeof window !== 'undefined' && window.matchMedia('(min-width: 960px)').matches;
  return isDesktop
    ? { isNowPlayingFullscreen: false }
    : { isNowPlayingOpen: false, isQueueOpen: false, isLyricsOpen: false, isNowPlayingFullscreen: false };
}

/** Always boots to Home — avoids resuming into a Now Playing sheet with nothing loaded. */
export const useUiStore = create<UiState>((set) => ({
  currentView: 'home',
  linkSheet: 'none',
  isConnectSheetOpen: false,
  linkPrefillCode: null,
  linkedDevicesTick: 0,
  detailStack: [],
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
  // On desktop this is a docked right panel that reserves room from the page, so it opens/closes as one relayout step.
  openConnectSheet: () => withViewTransition(() => set({ isConnectSheetOpen: true })),
  closeConnectSheet: () => withViewTransition(() => set({ isConnectSheetOpen: false })),
  openLinkShow: () => set({ linkSheet: 'show', linkPrefillCode: null }),
  openLinkScan: (prefillCode) => set({ linkSheet: 'scan', linkPrefillCode: prefillCode ?? null }),
  closeLinkSheet: () => set({ linkSheet: 'none', linkPrefillCode: null }),
  bumpLinkedDevices: () => set((state) => ({ linkedDevicesTick: state.linkedDevicesTick + 1 })),
  setView: (view) => set({ currentView: view, detailStack: [] }),
  openArtist: ({ artistId, name }) =>
    set((state) => ({
      detailStack: [...state.detailStack, { type: 'artist', artistId: artistId ?? null, name }],
      ...leaveNowPlaying(),
    })),
  openAlbum: (albumId) => set((state) => ({ detailStack: [...state.detailStack, { type: 'album', albumId }], ...leaveNowPlaying() })),
  closeDetail: () => set((state) => ({ detailStack: state.detailStack.slice(0, -1) })),
  // Also closes the desktop Perangkat panel, which docks in the same column and would otherwise sit on top of it.
  openNowPlaying: () => withViewTransition(() => set({ isNowPlayingOpen: true, isConnectSheetOpen: false })),
  closeNowPlaying: () =>
    withViewTransition(() => set({ isNowPlayingOpen: false, isQueueOpen: false, isLyricsOpen: false, isNowPlayingFullscreen: false })),
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
  openPlaylist: (playlistId) => set({ currentView: 'library', selectedPlaylistId: playlistId, detailStack: [] }),
  closePlaylist: () => set({ selectedPlaylistId: null }),
  openCollection: (collectionId) => set({ openedCollectionId: collectionId }),
  closeCollection: () => set({ openedCollectionId: null }),
  toggleLyrics: () => set((state) => ({ isLyricsOpen: !state.isLyricsOpen })),
  setLyricsOpen: (open) => set({ isLyricsOpen: open }),
  openFullscreenLyrics: () => set({ isNowPlayingFullscreen: true, isLyricsOpen: true, isNowPlayingOpen: true }),
  closeFullscreenLyrics: () => set({ isNowPlayingFullscreen: false }),
}));
