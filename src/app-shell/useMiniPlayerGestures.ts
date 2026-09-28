import { useEffect, useRef, type RefObject } from 'react';

const DECIDE_DISTANCE = 8;
const SKIP_DISTANCE = 56;
const OPEN_DISTANCE = 40;
const FLICK_VELOCITY = 0.4; // px/ms
const SLIDE_OUT_MS = 150;
const SLIDE_IN_MS = 320;

// Past the threshold the finger keeps moving but the element follows less and less.
const rubber = (value: number, limit: number) => Math.sign(value) * limit * (1 - Math.exp(-Math.abs(value) / limit));

/**
 * Apple Music's mini player: swipe up opens Now Playing, swipe left/right skips to the next/previous
 * song (the art and title slide out one side and the next one in from the other). The direction is
 * locked from the first few px, so a diagonal drag or a tap never does both — and a plain tap still
 * reaches the buttons. Native touch events with a non-passive touchmove, transform/translate only.
 */
export function useMiniPlayerGestures(
  wrapperRef: RefObject<HTMLElement | null>,
  contentRef: RefObject<HTMLElement | null>,
  { enabled, onOpen, onNext, onPrevious }: { enabled: boolean; onOpen: () => void; onNext: () => void; onPrevious: () => void },
) {
  const actionsRef = useRef({ onOpen, onNext, onPrevious });
  useEffect(() => {
    actionsRef.current = { onOpen, onNext, onPrevious };
  });

  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper || !enabled) return;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let start: { x: number; y: number } | null = null;
    let axis: 'x' | 'up' | null = null;
    let delta = 0;
    let samples: { t: number; d: number }[] = [];
    let suppressClickUntil = 0;
    const timers: number[] = [];

    const content = () => contentRef.current;
    const moveContent = (x: number, transition: string) => {
      const el = content();
      if (!el) return;
      el.style.transition = transition;
      el.style.transform = x === 0 ? '' : `translateX(${x}px)`;
      el.style.opacity = x === 0 ? '' : String(Math.max(0, 1 - Math.abs(x) / (wrapper.offsetWidth * 0.8)));
    };
    const lift = (y: number, transition: string) => {
      wrapper.style.transition = transition ? `${getComputedStyle(wrapper).transition}, ${transition}` : '';
      // `translate`, not `transform`: the dock's fold already animates this element's transform.
      wrapper.style.translate = y === 0 ? '' : `0 ${y}px`;
    };

    const onStart = (event: TouchEvent) => {
      start = null;
      axis = null;
      if (event.touches.length !== 1) return;
      start = { x: event.touches[0].clientX, y: event.touches[0].clientY };
      samples = [];
    };

    const onMove = (event: TouchEvent) => {
      if (!start) return;
      const dx = event.touches[0].clientX - start.x;
      const dy = event.touches[0].clientY - start.y;
      if (!axis) {
        if (Math.abs(dx) + Math.abs(dy) < DECIDE_DISTANCE) return;
        if (Math.abs(dx) > Math.abs(dy)) axis = 'x';
        else if (dy < 0) axis = 'up';
        else {
          start = null;
          return;
        }
      }
      event.preventDefault();
      delta = axis === 'x' ? dx : dy;
      const now = performance.now();
      samples.push({ t: now, d: delta });
      samples = samples.filter((sample) => now - sample.t < 100);
      if (reducedMotion) return;
      if (axis === 'x') moveContent(rubber(delta, wrapper.offsetWidth * 0.5), 'none');
      else lift(rubber(Math.min(delta, 0), 28), '');
    };

    const onEnd = () => {
      if (!start || !axis) {
        start = null;
        return;
      }
      const first = samples[0];
      const last = samples[samples.length - 1];
      const velocity = first && last && last.t > first.t ? (last.d - first.d) / (last.t - first.t) : 0;
      const gesture = axis;
      start = null;
      axis = null;
      suppressClickUntil = performance.now() + 350;

      if (gesture === 'up') {
        lift(0, reducedMotion ? '' : `translate ${SLIDE_IN_MS}ms var(--ease-liquid)`);
        // Hand transitions back to the stylesheet (the dock's fold) once the spring is done.
        timers.push(window.setTimeout(() => (wrapper.style.transition = ''), SLIDE_IN_MS + 20));
        if (delta < -OPEN_DISTANCE || velocity < -FLICK_VELOCITY) actionsRef.current.onOpen();
        return;
      }

      const skip = Math.abs(delta) > SKIP_DISTANCE || Math.abs(velocity) > FLICK_VELOCITY;
      if (!skip) {
        moveContent(0, reducedMotion ? 'none' : `transform ${SLIDE_IN_MS}ms var(--ease-liquid), opacity 200ms ease`);
        return;
      }
      const toNext = delta < 0;
      const run = () => (toNext ? actionsRef.current.onNext() : actionsRef.current.onPrevious());
      if (reducedMotion) {
        run();
        return;
      }
      const width = wrapper.offsetWidth * 0.6;
      moveContent(toNext ? -width : width, `transform ${SLIDE_OUT_MS}ms ease-in, opacity ${SLIDE_OUT_MS}ms ease-in`);
      timers.push(
        window.setTimeout(() => {
          run();
          // In from the other side once the next song is asked for.
          moveContent(toNext ? width * 0.5 : -width * 0.5, 'none');
          requestAnimationFrame(() =>
            requestAnimationFrame(() => moveContent(0, `transform ${SLIDE_IN_MS}ms var(--ease-liquid), opacity 220ms ease`)),
          );
        }, SLIDE_OUT_MS),
      );
    };

    // A swipe that ends over a button shouldn't also press it.
    const onClickCapture = (event: MouseEvent) => {
      if (performance.now() < suppressClickUntil) {
        event.preventDefault();
        event.stopPropagation();
      }
    };

    wrapper.addEventListener('touchstart', onStart, { passive: true });
    wrapper.addEventListener('touchmove', onMove, { passive: false });
    wrapper.addEventListener('touchend', onEnd);
    wrapper.addEventListener('touchcancel', onEnd);
    wrapper.addEventListener('click', onClickCapture, true);
    return () => {
      wrapper.removeEventListener('touchstart', onStart);
      wrapper.removeEventListener('touchmove', onMove);
      wrapper.removeEventListener('touchend', onEnd);
      wrapper.removeEventListener('touchcancel', onEnd);
      wrapper.removeEventListener('click', onClickCapture, true);
      timers.forEach((timer) => window.clearTimeout(timer));
      wrapper.style.translate = '';
      wrapper.style.transition = '';
      moveContent(0, '');
    };
  }, [wrapperRef, contentRef, enabled]);
}
