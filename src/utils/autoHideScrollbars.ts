/*
 * Scrollbars that show only while something scrolls, like macOS overlay scrollbars and Spotify: at rest the thumb is
 * transparent (global.css), and the scrolling element carries .is-scrolling for a moment after its last scroll event.
 * One capturing listener for the whole page (scroll doesn't bubble, but it does go through the capture phase), no
 * per-component wiring, so every scroll area in the app gets it, the ones added later included.
 */
const VISIBLE_AFTER_SCROLL_MS = 900;
const timers = new WeakMap<Element, ReturnType<typeof setTimeout>>();

export function installAutoHideScrollbars(): void {
  if (typeof document === 'undefined') return;
  document.addEventListener(
    'scroll',
    (event) => {
      const target = event.target === document ? document.scrollingElement : event.target;
      if (!(target instanceof Element)) return;
      if (!target.classList.contains('is-scrolling')) target.classList.add('is-scrolling');
      const pending = timers.get(target);
      if (pending) clearTimeout(pending);
      timers.set(
        target,
        setTimeout(() => {
          target.classList.remove('is-scrolling');
          timers.delete(target);
        }, VISIBLE_AFTER_SCROLL_MS),
      );
    },
    { capture: true, passive: true },
  );
}
