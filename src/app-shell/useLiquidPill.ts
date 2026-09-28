import { useEffect, useRef, type PointerEvent, type RefObject } from 'react';
import { canAffordLens } from '../hooks/useLiquidRim';
import { BUBBLE_LENS_SCALE, LENS_FILTER_ID } from './liquidGlassFilters';

type Spring = { stiffness: number; damping: number };
const spring = (stiffness: number, dampingRatio: number): Spring => ({
  stiffness,
  damping: 2 * Math.sqrt(stiffness) * dampingRatio,
});

// Real springs instead of CSS transitions: the pill has to change target mid-flight (finger moves,
// tab changes during a landing) without restarting, and its stretch is driven by live velocity,
// neither of which a transition can do.
const FOLLOW = spring(1100, 0.8); // under the finger: a hint of lag so it reads as pushed, not glued
const TRAVEL = spring(340, 0.62); // tab-to-tab and release: visible overshoot when it lands
const LIFT = spring(420, 0.5); // grow/shrink: the bouncy pop of the lens
const LIFTED_GROWTH = 0.4; // 82x50 → ~115x70, deliberately spilling past the 58px bar
const MAX_STRETCH = 0.28;
const STRETCH_AT_SPEED = 2600; // px/s
// Rainbow fringe at the rim. The lens's centre doesn't shift at all, so this only ever shows where
// the rim bends (as on Apple's), never on an icon sitting in the middle.
const LENS_CHANNEL_SPREAD = 1;
const MAX_SUBSTEP = 1 / 240;

type State = {
  x: number;
  vx: number;
  lift: number;
  vlift: number;
  liftTarget: number;
  targetIndex: number;
  fingerX: number | null;
  pressing: boolean;
  resting: boolean;
  initialized: boolean;
  raf: number;
  last: number;
  lensAllowed: boolean | null;
};

const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function step(value: number, velocity: number, target: number, s: Spring, dt: number): [number, number] {
  const nextVelocity = velocity + (-s.stiffness * (value - target) - s.damping * velocity) * dt;
  return [value + nextVelocity * dt, nextVelocity];
}

export function useLiquidPill({
  navRef,
  pillRef,
  fillRef,
  activeIndex,
  count,
  enabled,
  lensClassName,
  onSelect,
}: {
  navRef: RefObject<HTMLElement | null>;
  pillRef: RefObject<HTMLElement | null>;
  /** The resting capsule behind the tabs; follows the pill exactly. */
  fillRef: RefObject<HTMLElement | null>;
  activeIndex: number;
  count: number;
  enabled: boolean;
  lensClassName: string;
  onSelect: (index: number) => void;
}) {
  const state = useRef<State>({
    x: 0,
    vx: 0,
    lift: 0,
    vlift: 0,
    liftTarget: 0,
    targetIndex: activeIndex,
    fingerX: null,
    pressing: false,
    resting: true,
    initialized: false,
    raf: 0,
    last: 0,
    lensAllowed: null,
  });
  const activeIndexRef = useRef(activeIndex);

  const slotWidth = () => (navRef.current?.clientWidth ?? 0) / count;

  const fingerToX = (clientX: number) => {
    const rect = navRef.current?.getBoundingClientRect();
    if (!rect) return 0;
    const width = rect.width / count;
    return Math.min(Math.max(clientX - rect.left - width / 2, 0), rect.width - width);
  };

  const indexAt = (clientX: number) => {
    const rect = navRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return Math.max(activeIndexRef.current, 0);
    const fraction = Math.min(Math.max((clientX - rect.left) / rect.width, 0), 1);
    return Math.min(Math.floor(fraction * count), count - 1);
  };

  const render = () => {
    const s = state.current;
    const pill = pillRef.current;
    if (!pill) return;
    const stretch = Math.min(Math.abs(s.vx) / STRETCH_AT_SPEED, 1) * MAX_STRETCH;
    const growth = 1 + LIFTED_GROWTH * s.lift;
    const lift = Math.min(Math.max(s.lift, 0), 1);
    // At rest the position is a percentage, so a later resize/rotation can't strand the pill.
    const transform = s.resting ? `translateX(${Math.max(s.targetIndex, 0) * 100}%)` : `translateX(${s.x}px)`;
    for (const layer of [pill, fillRef.current]) {
      if (!layer) continue;
      layer.style.transform = transform;
      layer.style.opacity = s.targetIndex < 0 && !s.pressing ? '0' : '1';
      layer.style.setProperty('--sx', String(growth * (1 + stretch)));
      layer.style.setProperty('--sy', String(growth * (1 - stretch * 0.45)));
      layer.style.setProperty('--lift', String(lift));
    }
    s.lensAllowed ??= canAffordLens();
    const lensOn = s.lensAllowed && lift > 0.02;
    pill.classList.toggle(lensClassName, lensOn);
    if (lensOn) {
      // feDisplacementMap's scale can't come from CSS, so the lens strength is written straight
      // into the filter — this is what makes the refraction fade in/out with the lift instead of
      // snapping on.
      document
        .getElementById(LENS_FILTER_ID)
        ?.querySelectorAll('feDisplacementMap')
        .forEach((map, i) => map.setAttribute('scale', String(lift * (BUBBLE_LENS_SCALE - i * LENS_CHANNEL_SPREAD))));
    }
  };

  const frame = (now: number) => {
    const s = state.current;
    const width = slotWidth();
    const dt = Math.min((now - s.last) / 1000, 1 / 30);
    s.last = now;
    const target = s.pressing && s.fingerX !== null ? s.fingerX : Math.max(s.targetIndex, 0) * width;

    // Stays lifted (clear lens) while travelling and only shrinks back once it has nearly arrived,
    // so a tab switch reads as the glass lifting off, sliding over, and settling down.
    if (!s.pressing && s.liftTarget > 0 && Math.abs(target - s.x) < width * 0.08 && Math.abs(s.vx) < 250) {
      s.liftTarget = 0;
    }

    const substeps = Math.max(1, Math.ceil(dt / MAX_SUBSTEP));
    const h = dt / substeps;
    for (let i = 0; i < substeps; i++) {
      [s.x, s.vx] = step(s.x, s.vx, target, s.pressing ? FOLLOW : TRAVEL, h);
      [s.lift, s.vlift] = step(s.lift, s.vlift, s.liftTarget, LIFT, h);
    }

    const settled =
      !s.pressing &&
      Math.abs(target - s.x) < 0.3 &&
      Math.abs(s.vx) < 3 &&
      Math.abs(s.lift - s.liftTarget) < 0.002 &&
      Math.abs(s.vlift) < 0.02;
    if (settled) {
      Object.assign(s, { x: target, vx: 0, lift: s.liftTarget, vlift: 0, resting: true, raf: 0 });
      render();
      return;
    }
    render();
    s.raf = requestAnimationFrame(frame);
  };

  const kick = () => {
    const s = state.current;
    if (prefersReducedMotion()) {
      const width = slotWidth();
      Object.assign(s, {
        x: s.pressing && s.fingerX !== null ? s.fingerX : Math.max(s.targetIndex, 0) * width,
        vx: 0,
        lift: 0,
        vlift: 0,
        liftTarget: 0,
        resting: !s.pressing,
      });
      render();
      return;
    }
    if (s.resting) s.x = Math.max(s.targetIndex, 0) * slotWidth();
    s.resting = false;
    if (!s.raf) {
      s.last = performance.now();
      s.raf = requestAnimationFrame(frame);
    }
  };

  useEffect(() => {
    activeIndexRef.current = activeIndex;
    const s = state.current;
    if (s.pressing || (s.targetIndex === activeIndex && s.initialized)) {
      render();
      return;
    }
    const cameFromHidden = s.targetIndex < 0 || activeIndex < 0;
    s.targetIndex = activeIndex;
    if (!s.initialized || cameFromHidden) {
      s.initialized = true;
      render();
      return;
    }
    s.liftTarget = 1;
    kick();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIndex]);

  useEffect(() => () => cancelAnimationFrame(state.current.raf), []);

  const onPointerDown = (event: PointerEvent<HTMLElement>) => {
    if (!enabled || (event.pointerType === 'mouse' && event.button !== 0)) return;
    const s = state.current;
    navRef.current?.setPointerCapture(event.pointerId);
    s.pressing = true;
    s.fingerX = fingerToX(event.clientX);
    s.liftTarget = 1;
    kick();
  };

  const onPointerMove = (event: PointerEvent<HTMLElement>) => {
    const s = state.current;
    if (!s.pressing) return;
    s.fingerX = fingerToX(event.clientX);
    kick();
  };

  const release = (index: number) => {
    const s = state.current;
    s.pressing = false;
    s.fingerX = null;
    s.targetIndex = index;
    s.liftTarget = 1;
    kick();
  };

  // Commits here rather than relying on the button's onClick: with the pointer captured by the
  // nav, the click is dispatched to the nav, not the tab under the finger.
  const onPointerUp = (event: PointerEvent<HTMLElement>) => {
    if (!state.current.pressing) return;
    const index = indexAt(event.clientX);
    release(index);
    onSelect(index);
  };

  const onPointerCancel = () => {
    if (!state.current.pressing) return;
    release(activeIndexRef.current);
  };

  return { onPointerDown, onPointerMove, onPointerUp, onPointerCancel };
}
