import { useEffect } from 'react';
import { isAndroid } from '../audio-engine/AudioEngine';
import { useToast } from '../components/Toast/ToastProvider';
import { t } from '../i18n/i18n';
import { usePlayerStore } from '../stores/playerStore';
import { useUiStore } from '../stores/uiStore';

type Ui = ReturnType<typeof useUiStore.getState>;

// Everything the system Back should close, top-most first. Without history entries for these, the
// Android back gesture/button (and a browser's Back) left the whole app instead.
const LAYERS: { isOpen: (ui: Ui) => boolean; close: (ui: Ui) => void }[] = [
  { isOpen: (ui) => ui.videoTheater !== null, close: (ui) => ui.closeVideoTheater() },
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
const layersOf = (ui: Ui) => LAYERS.reduce((sum, layer) => sum + (layer.isOpen(ui) ? 1 : 0), 0) + Math.max(ui.detailStack.length - 1, 0);

/*
 * Android, music playing, nothing left to close: one more history entry under everything (the "guard"). Without it,
 * Back on Beranda/Cari/Koleksi left the installed app, which on Android FINISHES it: the page is destroyed and the
 * music with it, "I left Suwwara and the song stopped". The Home button/gesture keeps a web app alive in the
 * background; Back never can, and a web page cannot send itself to the background. So Back there first goes to
 * Beranda, then explains, and only a second Back right after actually leaves (and stops the music).
 *
 * Off a beat after playback stops, not on every pause: a song change briefly reads as "not playing", and churning the
 * history then (often in the background) is asking for trouble.
 */
const GUARD_OFF_DELAY_MS = 1500;

/**
 * Keeps one history entry per open layer (sheet, Now Playing, pushed page), so Back closes the
 * top-most one. Layers opened/closed from the UI push/pop entries to match; a Back from the system
 * closes the top layer and the entry it consumed is already gone.
 */
export function useBackNavigation() {
  const { showToast } = useToast();
  useEffect(() => {
    let depth = 0;
    // history.go() pops fire popstate too — those are ours, not the user's Back.
    let ownPops = 0;
    let guard = false;
    // After the "press Back again" hint: the guard stays down until the next tap, so that second Back leaves. Re-armed
    // on a tap on purpose: Chrome skips history entries added without a user gesture when going Back.
    let guardDismissed = false;
    let guardOffTimer: ReturnType<typeof setTimeout> | null = null;
    const playing = () => {
      const player = usePlayerStore.getState();
      return player.isPlaying || player.isBuffering;
    };

    const sync = (ui: Ui) => {
      const next = layersOf(ui) + (guard ? 1 : 0);
      if (next > depth) {
        for (let i = depth; i < next; i++) history.pushState({ suwwaraLayer: i + 1 }, '');
      } else if (next < depth) {
        ownPops += 1;
        history.go(next - depth);
      }
      depth = next;
    };

    const updateGuard = () => {
      const wanted = isAndroid && !guardDismissed && playing();
      if (wanted) {
        if (guardOffTimer) clearTimeout(guardOffTimer);
        guardOffTimer = null;
        if (!guard) {
          guard = true;
          sync(useUiStore.getState());
        }
      } else if (guard && !guardOffTimer) {
        guardOffTimer = setTimeout(() => {
          guardOffTimer = null;
          if (guardDismissed || playing()) return;
          guard = false;
          sync(useUiStore.getState());
        }, GUARD_OFF_DELAY_MS);
      }
    };

    const onPopState = () => {
      if (ownPops > 0) {
        ownPops -= 1;
        return;
      }
      if (depth === 0) return;
      depth -= 1;
      const ui = useUiStore.getState();
      const layer = LAYERS.find((candidate) => candidate.isOpen(ui));
      if (layer || ui.detailStack.length > 1) {
        layer?.close(ui);
        return;
      }
      if (!guard) return;
      // The guard was the entry consumed: Back with nothing left to close.
      guard = false;
      if (ui.currentView !== 'home') {
        ui.setView('home');
        guard = true; // sync below puts it back (setView's own sync already ran with guard off)
        sync(useUiStore.getState());
        return;
      }
      guardDismissed = true;
      showToast(t('Tekan Kembali sekali lagi untuk keluar. Musik akan berhenti; pakai tombol Home supaya tetap diputar.'));
    };

    const onTap = () => {
      if (!guardDismissed) return;
      guardDismissed = false;
      updateGuard();
    };

    sync(useUiStore.getState());
    updateGuard();
    const unsubscribe = useUiStore.subscribe(sync);
    const unsubscribePlayer = usePlayerStore.subscribe(updateGuard);
    window.addEventListener('popstate', onPopState);
    window.addEventListener('pointerdown', onTap, true);
    return () => {
      unsubscribe();
      unsubscribePlayer();
      if (guardOffTimer) clearTimeout(guardOffTimer);
      window.removeEventListener('popstate', onPopState);
      window.removeEventListener('pointerdown', onTap, true);
    };
  }, [showToast]);
}
