import { flushSync } from 'react-dom';

interface ViewTransitionDocument {
  startViewTransition?: (update: () => void) => unknown;
}

/**
 * Runs a state change that re-lays out the whole desktop page (opening/closing the docked Now Playing
 * panel) as ONE cross-fade between the old and the new layout, instead of letting the page re-flow on
 * every frame of a padding transition. Measured on the old approach: the main column took ~10 different
 * widths in ~50 frames while the panel opened, i.e. every grid and image re-laid out again and again —
 * that is the stutter. Here the DOM changes once (flushSync makes React commit inside the callback, which
 * the browser needs to snapshot the "after" state) and the browser animates between two pictures.
 * Falls back to a plain instant change where the API is missing, on phones, or with reduced motion.
 */
export function withViewTransition(update: () => void): void {
  const doc = document as unknown as ViewTransitionDocument;
  const canAnimate =
    typeof doc.startViewTransition === 'function' &&
    !window.matchMedia('(prefers-reduced-motion: reduce)').matches &&
    window.matchMedia('(min-width: 960px)').matches;
  if (!canAnimate) {
    update();
    return;
  }
  doc.startViewTransition!(() => flushSync(update));
}
