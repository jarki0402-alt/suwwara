import { registerSW } from 'virtual:pwa-register';
import { t } from '../i18n/i18n';
import { useJamStore } from '../stores/jamStore';
import { usePlayerStore } from '../stores/playerStore';
import { useUpdateStore, type UpdateStatus } from './updateStore';

type ShowToastFn = (message: string) => void;

// How often a long-lived session re-checks for a new version, on top of every resume.
const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;
// A new version that finishes downloading this soon after the app was opened (or brought back) is taken on the spot,
// like a native app updated by the store before it shows. Later than that the person is using the app: it waits for
// the moment the app goes to the background instead (see initServiceWorker).
const JUST_OPENED_MS = 60 * 1000;

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

const AUTO_APPLY_KEY = 'suwwara:autoUpdateAt';
/** An automatic update may reload the app at most once per this window — see canAutoApply. */
const AUTO_APPLY_COOLDOWN_MS = 10 * 60 * 1000;

/**
 * The automatic (no tap) update reloads the page on its own, so it must never be able to repeat: if something in front
 * of the server keeps handing out a different sw.js on every check (an edge holding an old copy next to the new one),
 * each reload would find a "new" waiting worker again and reload again, forever — even across closing and reopening
 * the app. The attempt is written down BEFORE the reload so the next start can see it; a tap on "Perbarui" is never
 * limited, since a person pressing a button cannot loop.
 */
function canAutoApply(): boolean {
  try {
    const last = Number(localStorage.getItem(AUTO_APPLY_KEY));
    if (Number.isFinite(last) && Date.now() - last < AUTO_APPLY_COOLDOWN_MS) return false;
    localStorage.setItem(AUTO_APPLY_KEY, String(Date.now()));
  } catch {
    return false; // storage blocked: can't prove it won't loop, so leave it to the toast/tap
  }
  return true;
}

/** How long "Perbarui" waits for a reload to actually start before assuming a step silently didn't (see applyUpdate). */
const APPLY_FALLBACK_MS = 5000;

/**
 * Takes the waiting version live: tells it to skip waiting, and reloads once it has taken control. Done here rather
 * than through the plugin's own updateSW(true), which only reloads if its "waiting" prompt happened to run first —
 * a check started from Pengaturan found the update, the new worker activated, and the page just stayed on the old
 * version. The controllerchange reload doesn't depend on how the update was discovered.
 *
 * Every branch is guaranteed to end in a reload of the NEW build within APPLY_FALLBACK_MS — a tap on "Perbarui" that looked like it did
 * nothing (no `controllerchange` fired, or the plugin's own updateSW() resolved without one) used to just sit there
 * with no feedback and no next step. `location.reload()` unloads the page, which cancels any of this file's still-
 * pending timers on its own, so a fallback firing after a reload already started is harmless — it just never runs.
 */
export function applyUpdate(automatic = false): void {
  // A plain reload here would just boot the same old precache again if the new worker never took over — that is the
  // "tap did nothing, only closing and reopening helps" case, so a tap drops worker + caches to guarantee the new build.
  // An automatic attempt never takes that route (see canAutoApply): it just reloads.
  const fallback = setTimeout(() => (automatic ? window.location.reload() : void hardUpdate()), APPLY_FALLBACK_MS);

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

let initialised = false;
/** When the app was last opened or brought back to the foreground (see JUST_OPENED_MS). */
let openedAt = Date.now();

/**
 * Nothing an update's reload would interrupt (2026-11): no song playing or loading (a paused one is fine, it comes back
 * where it was), and not in a Jam, where a reload would drop the person out of the room and back in.
 */
function quietForUpdate(): boolean {
  const { isPlaying, isBuffering } = usePlayerStore.getState();
  return !isPlaying && !isBuffering && !useJamStore.getState().roomId;
}

export function initServiceWorker(showToast: ShowToastFn): void {
  // Once per page: a second registration (React's development double effects) would answer every event twice.
  if (initialised) return;
  initialised = true;
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
      // Every device takes a new version by itself (2026-11), Wi-Fi or mobile data alike (it is ~1-2 MB of app files, and
      // iOS doesn't tell a web app which one it's on anyway): before, it applied itself only with nothing at all in the
      // player or after 30 minutes away, and the last song is almost always shown, so phones ran an old build for hours
      // after a deploy. Now:
      //  - opening the app (or bringing it back) with a version already waiting takes it at once;
      //  - one that finishes downloading within JUST_OPENED_MS of opening is taken then too (onNeedRefresh);
      //  - one that arrives while the app is in use waits, and is taken the moment the app goes to the background, so
      //    the reload is never seen.
      // Never while a song plays or loads, nor in a Jam (quietForUpdate): those wait for the next quiet moment.
      // canAutoApply still caps every automatic reload to one try per 10 minutes, so nothing can loop.
      const waitingReady = () => useUpdateStore.getState().status === 'available' && !!swRegistration.waiting;
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
          if (waitingReady() && quietForUpdate() && canAutoApply()) applyUpdate(true);
          return;
        }
        openedAt = Date.now();
        if (waitingReady() && quietForUpdate() && canAutoApply()) {
          applyUpdate(true);
          return;
        }
        check();
      });
      setInterval(check, UPDATE_CHECK_INTERVAL_MS);
    },
    onNeedRefresh() {
      useUpdateStore.getState().set('available');
      // Nothing loaded in the player, or the app only just opened and nothing is playing: take it right away instead of
      // waiting for a tap on a notice that is easy to miss (see the visibility handler above for the rest).
      const nothingLoaded = usePlayerStore.getState().currentSongId === null;
      const justOpened = Date.now() - openedAt < JUST_OPENED_MS;
      if ((nothingLoaded || justOpened) && quietForUpdate() && canAutoApply()) {
        applyUpdate(true);
        return;
      }
      // Otherwise the status alone: UpdateNotice shows it, once, however many times this fires.
    },
    onOfflineReady() {
      showToast(t('Suwwara siap digunakan secara offline.'));
    },
  });
  applyWaitingUpdate = updateSW;
}
