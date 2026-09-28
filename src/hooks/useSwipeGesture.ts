import { useEffect, useRef, type RefObject } from 'react';

type Direction = 'down' | 'right';

const DECIDE_DISTANCE = 8;
const COMMIT_OUT_MS = 220;
const SNAP_BACK_MS = 420;
// Touches that start on these never become a swipe: sliders and the queue's reorder grip own
// their own drags.
const EXCLUDED = 'input, textarea, [role="slider"], [data-no-swipe]';

function isScrolledPastTop(from: Element, stopAt: Element) {
  for (let node: Element | null = from; node && node !== stopAt.parentElement; node = node.parentElement) {
    if (node.scrollTop > 0 && node.scrollHeight > node.clientHeight + 1) {
      const overflow = getComputedStyle(node).overflowY;
      if (overflow === 'auto' || overflow === 'scroll') return true;
    }
  }
  return false;
}

/**
 * A dismiss swipe that follows the finger: `down` for sheets (Now Playing, the queue), `right`
 * from the left edge for pages (iOS-style back). Released past a quarter/third of the way, or
 * flicked, it slides the rest of the way out and calls `onCommit`; otherwise it springs back.
 *
 * Native touch events, not pointer events: the element has to keep scrolling normally (lyrics,
 * the queue) until the gesture is unmistakably a dismiss — a downward drag while its scroller is
 * already at the top, or a sideways drag from the edge — and only then take over with
 * preventDefault on a non-passive touchmove. Moves are transform-only (compositor).
 */
export function useSwipeGesture(
  ref: RefObject<HTMLElement | null>,
  {
    direction,
    enabled,
    onCommit,
    edgeWidth,
    rebindKey,
    listenOnParent,
  }: {
    direction: Direction;
    enabled: boolean;
    onCommit: () => void;
    edgeWidth?: number;
    rebindKey?: unknown;
    /** Catch touches anywhere in the parent (e.g. a page shorter than its scroll area), still moving the element. */
    listenOnParent?: boolean;
  },
) {
  const commitRef = useRef(onCommit);
  useEffect(() => {
    commitRef.current = onCommit;
  });

  useEffect(() => {
    const element = ref.current;
    const surface = listenOnParent ? element?.parentElement : element;
    if (!element || !surface || !enabled) return;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let start: { x: number; y: number } | null = null;
    let owned = false;
    let offset = 0;
    let samples: { t: number; d: number }[] = [];

    const place = (value: number, transition: string) => {
      element.style.transition = transition;
      element.style.transform = value === 0 ? '' : direction === 'down' ? `translateY(${value}px)` : `translateX(${value}px)`;
      // A page swiped back gets a shadow on its leading edge, only while it's moving (at rest a
      // page-tall element's shadow would show as a dark band below the content).
      if (direction === 'right') element.style.boxShadow = value === 0 ? '' : '-12px 0 28px rgba(0, 0, 0, 0.35)';
    };

    const onStart = (event: TouchEvent) => {
      start = null;
      owned = false;
      if (event.touches.length !== 1) return;
      const touch = event.touches[0];
      const target = event.target as Element;
      if (target.closest(EXCLUDED)) return;
      if (edgeWidth !== undefined && touch.clientX > edgeWidth) return;
      if (direction === 'down' && isScrolledPastTop(target, element)) return;
      start = { x: touch.clientX, y: touch.clientY };
      samples = [];
    };

    const onMove = (event: TouchEvent) => {
      if (!start) return;
      const touch = event.touches[0];
      const dx = touch.clientX - start.x;
      const dy = touch.clientY - start.y;
      if (!owned) {
        if (Math.abs(dx) + Math.abs(dy) < DECIDE_DISTANCE) return;
        const along = direction === 'down' ? dy : dx;
        const across = direction === 'down' ? dx : dy;
        if (along <= 0 || Math.abs(along) < Math.abs(across)) {
          start = null;
          return;
        }
        owned = true;
      }
      event.preventDefault();
      offset = Math.max(0, direction === 'down' ? dy : dx);
      const now = performance.now();
      samples.push({ t: now, d: offset });
      samples = samples.filter((sample) => now - sample.t < 100);
      if (!reducedMotion) place(offset, 'none');
    };

    const onEnd = () => {
      if (!start || !owned) {
        start = null;
        return;
      }
      start = null;
      owned = false;
      const size = direction === 'down' ? element.offsetHeight : element.offsetWidth;
      const first = samples[0];
      const last = samples[samples.length - 1];
      const velocity = first && last && last.t > first.t ? (last.d - first.d) / (last.t - first.t) : 0;
      const commit = offset > size * (direction === 'down' ? 0.25 : 0.33) || (velocity > 0.5 && offset > 24);
      if (!commit) {
        place(0, reducedMotion ? 'none' : `transform ${SNAP_BACK_MS}ms var(--ease-liquid)`);
        return;
      }
      const finish = () => {
        commitRef.current();
        // If the element survives the commit (a page whose content just changed underneath), put
        // it back in place for what it now shows.
        requestAnimationFrame(() => place(0, 'none'));
      };
      if (reducedMotion) {
        finish();
        return;
      }
      place(size, `transform ${COMMIT_OUT_MS}ms cubic-bezier(0.2, 0.7, 0.3, 1)`);
      window.setTimeout(finish, COMMIT_OUT_MS);
    };

    surface.addEventListener('touchstart', onStart, { passive: true });
    surface.addEventListener('touchmove', onMove, { passive: false });
    surface.addEventListener('touchend', onEnd);
    surface.addEventListener('touchcancel', onEnd);
    return () => {
      surface.removeEventListener('touchstart', onStart);
      surface.removeEventListener('touchmove', onMove);
      surface.removeEventListener('touchend', onEnd);
      surface.removeEventListener('touchcancel', onEnd);
      element.style.transition = '';
      element.style.transform = '';
      element.style.boxShadow = '';
    };
  }, [ref, enabled, direction, edgeWidth, rebindKey, listenOnParent]);
}
