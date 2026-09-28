import { useEffect } from 'react';
import { useUiStore } from '../stores/uiStore';

type Ui = ReturnType<typeof useUiStore.getState>;

// Everything the system Back should close, top-most first. Without history entries for these, the
// Android back gesture/button (and a browser's Back) left the whole app instead.
const LAYERS: { isOpen: (ui: Ui) => boolean; close: (ui: Ui) => void }[] = [
  { isOpen: (ui) => ui.joinJamRoomId !== null, close: (ui) => ui.closeJoinJamSheet() },
  { isOpen: (ui) => ui.isJamSheetOpen, close: (ui) => ui.closeJamSheet() },
  { isOpen: (ui) => ui.isConnectSheetOpen, close: (ui) => ui.closeConnectSheet() },
  { isOpen: (ui) => ui.isNowPlayingFullscreen, close: (ui) => ui.closeFullscreenLyrics() },
  { isOpen: (ui) => ui.isQueueOpen, close: (ui) => ui.closeQueue() },
  { isOpen: (ui) => ui.isNowPlayingOpen, close: (ui) => ui.closeNowPlaying() },
  { isOpen: (ui) => ui.detailStack.length > 0, close: (ui) => ui.closeDetail() },
  { isOpen: (ui) => ui.openedCollectionId !== null, close: (ui) => ui.closeCollection() },
  { isOpen: (ui) => ui.selectedPlaylistId !== null, close: (ui) => ui.closePlaylist() },
];

// Artist/album pages stack, so each one is its own step back.
const depthOf = (ui: Ui) => LAYERS.reduce((sum, layer) => sum + (layer.isOpen(ui) ? 1 : 0), 0) + Math.max(ui.detailStack.length - 1, 0);

/**
 * Keeps one history entry per open layer (sheet, Now Playing, pushed page), so Back closes the
 * top-most one. Layers opened/closed from the UI push/pop entries to match; a Back from the system
 * closes the top layer and the entry it consumed is already gone.
 */
export function useBackNavigation() {
  useEffect(() => {
    let depth = 0;
    // history.go() pops fire popstate too — those are ours, not the user's Back.
    let ownPops = 0;

    const sync = (ui: Ui) => {
      const next = depthOf(ui);
      if (next > depth) {
        for (let i = depth; i < next; i++) history.pushState({ suwwaraLayer: i + 1 }, '');
      } else if (next < depth) {
        ownPops += 1;
        history.go(next - depth);
      }
      depth = next;
    };

    const onPopState = () => {
      if (ownPops > 0) {
        ownPops -= 1;
        return;
      }
      if (depth === 0) return;
      depth -= 1;
      const ui = useUiStore.getState();
      LAYERS.find((layer) => layer.isOpen(ui))?.close(ui);
    };

    sync(useUiStore.getState());
    const unsubscribe = useUiStore.subscribe(sync);
    window.addEventListener('popstate', onPopState);
    return () => {
      unsubscribe();
      window.removeEventListener('popstate', onPopState);
    };
  }, []);
}
