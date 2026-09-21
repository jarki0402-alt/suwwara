import { registerSW } from 'virtual:pwa-register';
import { usePlayerStore } from '../stores/playerStore';
import { useUpdateStore, type UpdateStatus } from './updateStore';

interface ToastAction {
  label: string;
  onClick: () => void;
}

type ShowToastFn = (message: string, options?: { action?: ToastAction }) => void;

// How often a long-lived session re-checks for a new version, on top of every resume.
const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;

let registration: ServiceWorkerRegistration | null = null;
let applyWaitingUpdate: ((reload?: boolean) => Promise<void>) | null = null;

/** How long a manual check waits for a found update to finish downloading before giving up. */
const CHECK_TIMEOUT_MS = 30_000;

/**
 * Asks the server whether a newer version exists, and says what it found. This is the button in Pengaturan: the
 * automatic checks (on resume, hourly) only ever surface a toast, which is easy to miss.
 */
export async function checkForUpdate(): Promise<UpdateStatus> {
  const store = useUpdateStore.getState();
  if (!registration) {
    store.set('unsupported');
    return 'unsupported';
  }
  if (registration.waiting) {
    store.set('available');
    return 'available';
  }
  store.set('checking');
  try {
    await registration.update();
  } catch {
    store.set('error');
    return 'error';
  }
  if (registration.waiting) {
    store.set('available');
    return 'available';
  }
  const installing = registration.installing;
  if (!installing) {
    store.set('latest');
    return 'latest';
  }
  // A newer worker was found and is still downloading: wait for it to be ready before answering.
  const outcome = await new Promise<UpdateStatus>((resolve) => {
    const timer = setTimeout(() => resolve('error'), CHECK_TIMEOUT_MS);
    installing.addEventListener('statechange', () => {
      if (installing.state === 'installed') {
        clearTimeout(timer);
        resolve('available');
      } else if (installing.state === 'redundant') {
        clearTimeout(timer);
        resolve('error');
      }
    });
  });
  store.set(outcome);
  return outcome;
}

/**
 * Takes the waiting version live: tells it to skip waiting, and reloads once it has taken control. Done here rather
 * than through the plugin's own updateSW(true), which only reloads if its "waiting" prompt happened to run first —
 * a check started from Pengaturan found the update, the new worker activated, and the page just stayed on the old
 * version. The controllerchange reload doesn't depend on how the update was discovered.
 */
export function applyUpdate(): void {
  const waiting = registration?.waiting;
  if (!waiting) {
    void applyWaitingUpdate?.(true);
    return;
  }
  navigator.serviceWorker.addEventListener('controllerchange', () => window.location.reload(), { once: true });
  waiting.postMessage({ type: 'SKIP_WAITING' });
}

export function initServiceWorker(showToast: ShowToastFn): void {
  const updateSW = registerSW({
    immediate: true,
    onRegisteredSW(_swUrl, swRegistration) {
      if (!swRegistration) return;
      registration = swRegistration;
      // An installed iOS PWA is normally *resumed*, not reloaded, so the browser's own
      // "check for a new service worker on navigation" never fires — a phone could keep
      // running an old bundle for days. Checking whenever the app comes back to the
      // foreground (and hourly while it stays open) is what actually gets updates to it.
      const check = () => void swRegistration.update().catch(() => {});
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') check();
      });
      setInterval(check, UPDATE_CHECK_INTERVAL_MS);
    },
    onNeedRefresh() {
      useUpdateStore.getState().set('available');
      // Nothing loaded in the player = nothing to interrupt: apply the update right away
      // instead of waiting for a tap on a toast that is easy to miss (or dismiss).
      if (usePlayerStore.getState().currentSongId === null) {
        applyUpdate();
        return;
      }
      showToast('Versi baru Suwwara tersedia.', {
        action: { label: 'Muat ulang', onClick: applyUpdate },
      });
    },
    onOfflineReady() {
      showToast('Suwwara siap digunakan secara offline.');
    },
  });
  applyWaitingUpdate = updateSW;
}
