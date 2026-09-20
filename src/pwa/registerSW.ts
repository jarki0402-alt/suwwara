import { registerSW } from 'virtual:pwa-register';
import { usePlayerStore } from '../stores/playerStore';

interface ToastAction {
  label: string;
  onClick: () => void;
}

type ShowToastFn = (message: string, options?: { action?: ToastAction }) => void;

// How often a long-lived session re-checks for a new version, on top of every resume.
const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;

export function initServiceWorker(showToast: ShowToastFn): void {
  const updateSW = registerSW({
    immediate: true,
    onRegisteredSW(_swUrl, registration) {
      if (!registration) return;
      // An installed iOS PWA is normally *resumed*, not reloaded, so the browser's own
      // "check for a new service worker on navigation" never fires — a phone could keep
      // running an old bundle for days. Checking whenever the app comes back to the
      // foreground (and hourly while it stays open) is what actually gets updates to it.
      const check = () => void registration.update().catch(() => {});
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') check();
      });
      setInterval(check, UPDATE_CHECK_INTERVAL_MS);
    },
    onNeedRefresh() {
      // Nothing loaded in the player = nothing to interrupt: apply the update right away
      // instead of waiting for a tap on a toast that is easy to miss (or dismiss).
      if (usePlayerStore.getState().currentSongId === null) {
        void updateSW(true);
        return;
      }
      showToast('Versi baru Suwwara tersedia.', {
        action: { label: 'Muat ulang', onClick: () => void updateSW(true) },
      });
    },
    onOfflineReady() {
      showToast('Suwwara siap digunakan secara offline.');
    },
  });
}
