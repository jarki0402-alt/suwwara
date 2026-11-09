import { lazy, Suspense, useEffect, useRef } from 'react';
import { useIsDesktop } from '../hooks/useIsDesktop';
import { useSwipeGesture } from '../hooks/useSwipeGesture';
import { LIKED_SONGS_ID, useUiStore } from '../stores/uiStore';
import { useLibraryStore } from '../stores/libraryStore';
import { LikedSongsList } from '../views/library/LikedSongsList';
import { PlaylistDetail } from '../views/library/PlaylistDetail';
import { DetailView } from '../views/detail/DetailView';
import { HomeView } from '../views/home/HomeView';
import { LibraryView } from '../views/library/LibraryView';
import { SearchView } from '../views/search/SearchView';
import { SettingsView } from '../views/settings/SettingsView';
import styles from './ViewRouter.module.css';

// Loaded on first use: the Podcast tab isn't needed to open the app (same reason as the detail pages).
const PodcastView = lazy(() => import('../podcast/views/PodcastView').then((module) => ({ default: module.PodcastView })));

// Wide enough to catch a thumb, narrow enough to leave horizontally scrolling shelves alone.
const BACK_EDGE_WIDTH = 24;

export function ViewRouter() {
  const currentView = useUiStore((state) => state.currentView);
  const detailDepth = useUiStore((state) => state.detailStack.length);
  const selectedPlaylistId = useUiStore((state) => state.selectedPlaylistId);
  const hasPlaylistOpen = selectedPlaylistId !== null;
  const hasCollectionOpen = useUiStore((state) => state.currentView === 'home' && state.openedCollectionId !== null);
  const isDesktop = useIsDesktop();

  // Phone only: swipe in from the left edge to go back one page (iOS-style). Artist/album pages,
  // an open playlist and an opened "made for you" collection all read as a page on top of a page.
  const viewRef = useRef<HTMLDivElement>(null);
  const goBack = () => {
    const ui = useUiStore.getState();
    if (ui.detailStack.length > 0) ui.closeDetail();
    else if (ui.selectedPlaylistId !== null) ui.closePlaylist();
    else if (ui.currentView === 'home' && ui.openedCollectionId !== null) ui.closeCollection();
  };
  useSwipeGesture(viewRef, {
    direction: 'right',
    edgeWidth: BACK_EDGE_WIDTH,
    enabled: !isDesktop && (detailDepth > 0 || hasPlaylistOpen || hasCollectionOpen),
    onCommit: goBack,
    rebindKey: detailDepth > 0 ? `detail-${detailDepth}` : currentView,
    // The whole scroll area, not just the page: a short page (or one still loading) leaves empty
    // space below it that should take the swipe too.
    listenOnParent: true,
  });

  return (
    // Keyed by view so the fade replays on every switch.
    <div
      ref={viewRef}
      key={detailDepth > 0 ? `detail-${detailDepth}` : selectedPlaylistId ? `playlist-${selectedPlaylistId}` : currentView}
      className={styles.view}
    >
      {detailDepth > 0 ? <DetailView /> : selectedPlaylistId ? <OpenPlaylist id={selectedPlaylistId} /> : renderView(currentView)}
    </div>
  );
}

/** The open playlist (or Lagu Disukai) over the current menu. Gone (deleted on another device): back to the menu. */
function OpenPlaylist({ id }: { id: string }) {
  const closePlaylist = useUiStore((state) => state.closePlaylist);
  const playlist = useLibraryStore((state) => state.playlists.find((p) => p.id === id) ?? null);
  const missing = id !== LIKED_SONGS_ID && !playlist;
  useEffect(() => {
    if (missing) closePlaylist();
  }, [missing, closePlaylist]);
  if (id === LIKED_SONGS_ID) return <LikedSongsList onBack={closePlaylist} />;
  return playlist ? <PlaylistDetail playlist={playlist} onBack={closePlaylist} /> : null;
}

function renderView(view: ReturnType<typeof useUiStore.getState>['currentView']) {
  switch (view) {
    case 'home':
      return <HomeView />;
    case 'search':
      return <SearchView />;
    case 'library':
      return <LibraryView />;
    case 'podcast':
      return (
        <Suspense fallback={null}>
          <PodcastView />
        </Suspense>
      );
    case 'settings':
      return <SettingsView />;
    default:
      return null;
  }
}
