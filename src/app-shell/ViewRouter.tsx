import { useRef } from 'react';
import { useIsDesktop } from '../hooks/useIsDesktop';
import { useSwipeGesture } from '../hooks/useSwipeGesture';
import { useUiStore } from '../stores/uiStore';
import { DetailView } from '../views/detail/DetailView';
import { HomeView } from '../views/home/HomeView';
import { LibraryView } from '../views/library/LibraryView';
import { SearchView } from '../views/search/SearchView';
import { SettingsView } from '../views/settings/SettingsView';
import styles from './ViewRouter.module.css';

// Wide enough to catch a thumb, narrow enough to leave horizontally scrolling shelves alone.
const BACK_EDGE_WIDTH = 24;

export function ViewRouter() {
  const currentView = useUiStore((state) => state.currentView);
  const detailDepth = useUiStore((state) => state.detailStack.length);
  const hasPlaylistOpen = useUiStore((state) => state.currentView === 'library' && state.selectedPlaylistId !== null);
  const hasCollectionOpen = useUiStore((state) => state.currentView === 'home' && state.openedCollectionId !== null);
  const isDesktop = useIsDesktop();

  // Phone only: swipe in from the left edge to go back one page (iOS-style). Artist/album pages,
  // an open playlist and an opened "made for you" collection all read as a page on top of a page.
  const viewRef = useRef<HTMLDivElement>(null);
  const goBack = () => {
    const ui = useUiStore.getState();
    if (ui.detailStack.length > 0) ui.closeDetail();
    else if (ui.currentView === 'library' && ui.selectedPlaylistId !== null) ui.closePlaylist();
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
    <div ref={viewRef} key={detailDepth > 0 ? `detail-${detailDepth}` : currentView} className={styles.view}>
      {detailDepth > 0 ? <DetailView /> : renderView(currentView)}
    </div>
  );
}

function renderView(view: ReturnType<typeof useUiStore.getState>['currentView']) {
  switch (view) {
    case 'home':
      return <HomeView />;
    case 'search':
      return <SearchView />;
    case 'library':
      return <LibraryView />;
    case 'settings':
      return <SettingsView />;
    default:
      return null;
  }
}
