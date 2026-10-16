import { useSyncExternalStore } from 'react';

/**
 * Real fullscreen (the Fullscreen API): no window title bar, no dock, no browser chrome. Used two ways, by two owners:
 * - 'app': the whole of Suwwara (top bar button, the F key, "Buka dalam layar penuh" in Pengaturan);
 * - 'view': Now Playing's "Perbesar layar penuh" lyrics view.
 * Only the owner that started fullscreen ends it, so stepping out of the lyrics view while the whole app is fullscreen
 * keeps the app fullscreen. Safari on the Mac still only has the prefixed webkit* names, so both are tried. Where a page
 * may not go fullscreen at all (iPhone Safari allows it for <video> only) isFullscreenSupported is false, the buttons
 * aren't shown, and the lyrics view simply fills the window as it always did.
 */
type FullscreenDocument = Document & {
  webkitFullscreenElement?: Element | null;
  webkitFullscreenEnabled?: boolean;
  webkitExitFullscreen?: () => Promise<void> | void;
};
type FullscreenElement = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> | void };
export type FullscreenOwner = 'app' | 'view';

const doc = () => document as FullscreenDocument;
let owner: FullscreenOwner | null = null;

export const isFullscreenSupported: boolean =
  typeof document !== 'undefined' && Boolean(document.fullscreenEnabled ?? (document as FullscreenDocument).webkitFullscreenEnabled);

export function isDocumentFullscreen(): boolean {
  return Boolean(doc().fullscreenElement ?? doc().webkitFullscreenElement);
}

/** Fires when fullscreen starts or ends, whoever ended it (Esc, the browser's own UI, our own exit). */
export function onDocumentFullscreenChange(listener: () => void): () => void {
  document.addEventListener('fullscreenchange', listener);
  document.addEventListener('webkitfullscreenchange', listener);
  return () => {
    document.removeEventListener('fullscreenchange', listener);
    document.removeEventListener('webkitfullscreenchange', listener);
  };
}

if (typeof document !== 'undefined') {
  onDocumentFullscreenChange(() => {
    if (!isDocumentFullscreen()) owner = null;
  });
}

/** Must be called inside the tap/click/key press itself: browsers only allow fullscreen from a user gesture. */
export function enterFullscreen(by: FullscreenOwner): void {
  if (!isFullscreenSupported || isDocumentFullscreen()) return;
  const root = document.documentElement as FullscreenElement;
  owner = by;
  try {
    if (root.requestFullscreen) void root.requestFullscreen({ navigationUI: 'hide' }).catch(() => (owner = null));
    else void root.webkitRequestFullscreen?.();
  } catch {
    owner = null; // refused (no gesture, an iframe without permission): the page just stays as it is
  }
}

function exitNow(): void {
  try {
    if (document.exitFullscreen) void document.exitFullscreen().catch(() => {});
    else void doc().webkitExitFullscreen?.();
  } catch {
    // already gone
  }
}

/** Ends fullscreen only if `by` started it. */
export function leaveFullscreen(by: FullscreenOwner): void {
  if (isDocumentFullscreen() && owner === by) exitNow();
}

/** The whole-app switch: out if fullscreen (whoever started it), else in. */
export function toggleAppFullscreen(): void {
  if (isDocumentFullscreen()) exitNow();
  else enterFullscreen('app');
}

/**
 * "Buka dalam layar penuh": a page can't go fullscreen by itself on open, only from the user's own input. So the first
 * click or key press after opening Suwwara does it (and still does whatever it was meant to do). One shot: once the
 * user leaves fullscreen with Esc, it stays left until Suwwara is opened again.
 */
export function enterAppFullscreenOnFirstInput(): () => void {
  if (!isFullscreenSupported) return () => {};
  const go = (event: Event) => {
    // F is the fullscreen key already (useAppFullscreen); arming on it too would toggle twice.
    if (event instanceof KeyboardEvent && event.code === 'KeyF') return;
    stop();
    enterFullscreen('app');
  };
  const stop = () => {
    window.removeEventListener('click', go, true);
    window.removeEventListener('keydown', go, true);
  };
  window.addEventListener('click', go, true);
  window.addEventListener('keydown', go, true);
  return stop;
}

export function useIsDocumentFullscreen(): boolean {
  return useSyncExternalStore(onDocumentFullscreenChange, isDocumentFullscreen, () => false);
}
