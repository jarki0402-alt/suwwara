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
const VERSION_FETCH_TIMEOUT_MS = 8000;

/**
 * True once the server is known to serve a newer build than this one while the service worker itself reports nothing
 * new — i.e. something between us and the server keeps serving a stale sw.js. Applying the update then has to bypass
 * the worker (see hardUpdate).
 */
let workerLooksStale = false;

/**
 * The build stamp the server serves right now, or null if it cannot be read. Read around every cache: a unique query
 * so a CDN keyed on the URL cannot answer from an old copy, and `no-store` for the browser.
 */
async function fetchServedBuild(): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), VERSION_FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(`/version.json?_=${Date.now()}`, { cache: 'no-store', signal: controller.signal });
    if (!response.ok) return null;
    const body = (await response.json()) as { build?: unknown };
    return typeof body.build === 'string' ? body.build : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Marks the app as outdated when the server serves a different build than the one running. */
async function serverHasNewerBuild(): Promise<boolean> {
  const served = await fetchServedBuild();
  workerLooksStale = served !== null && served !== __APP_BUILD__;
  return workerLooksStale;
}

/**
 * The update that does not need the service worker to cooperate: drop every worker and cache, then reload straight from
 * the network. Only ever on a tap — a reload here that could repeat by itself would be a loop.
 */
async function hardUpdate(): Promise<void> {
  try {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map((item) => item.unregister()));
    const keys = await caches.keys();
    await Promise.all(keys.map((key) => caches.delete(key)));
  } finally {
    window.location.reload();
  }
}

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
    // The worker says nothing is new — ask the server directly before believing it.
    if (await serverHasNewerBuild()) {
      store.set('available');
      return 'available';
    }
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

/** How long "Perbarui" waits for a reload to actually start before assuming a step silently didn't (see applyUpdate). */
const APPLY_FALLBACK_MS = 5000;

/**
 * Takes the waiting version live: tells it to skip waiting, and reloads once it has taken control. Done here rather
 * than through the plugin's own updateSW(true), which only reloads if its "waiting" prompt happened to run first —
 * a check started from Pengaturan found the update, the new worker activated, and the page just stayed on the old
 * version. The controllerchange reload doesn't depend on how the update was discovered.
 *
 * Every branch is guaranteed to end in a reload within APPLY_FALLBACK_MS — a tap on "Perbarui" that looked like it did
 * nothing (no `controllerchange` fired, or the plugin's own updateSW() resolved without one) used to just sit there
 * with no feedback and no next step. `location.reload()` unloads the page, which cancels any of this file's still-
 * pending timers on its own, so a fallback firing after a reload already started is harmless — it just never runs.
 */
export function applyUpdate(): void {
  const fallback = setTimeout(() => window.location.reload(), APPLY_FALLBACK_MS);

  const waiting = registration?.waiting;
  if (!waiting && workerLooksStale) {
    clearTimeout(fallback); // hardUpdate() reloads unconditionally in its own `finally` — no need for a second one
    void hardUpdate();
    return;
  }
  if (!waiting) {
    // The plugin's own updateSW(true) — kept as the fallback's fallback since its exact timing isn't ours to observe.
    void applyWaitingUpdate?.(true);
    return;
  }
  navigator.serviceWorker.addEventListener(
    'controllerchange',
    () => {
      clearTimeout(fallback);
      window.location.reload();
    },
    { once: true },
  );
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
      const check = () => {
        void swRegistration.update().catch(() => {});
        // Also the second opinion: surfaces "versi baru tersedia" in Pengaturan when the worker could not see it.
        void serverHasNewerBuild().then((newer) => {
          if (newer && useUpdateStore.getState().status !== 'checking') useUpdateStore.getState().set('available');
        });
      };
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
