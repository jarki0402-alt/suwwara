import { useEffect, useId, useRef, type PointerEvent, type RefObject } from 'react';
import { gradientMap } from '../app-shell/liquidGlassFilters';
import { useSettingsStore } from '../stores/settingsStore';

const SVG_NS = 'http://www.w3.org/2000/svg';
const SETTLE_DELAY_MS = 80;
const MAP_SAMPLES = 48;
// Press: a quick, slightly bouncy swell (Apple's glass grows under the finger, it doesn't sink).
const PRESS_STIFFNESS = 520;
const PRESS_DAMPING = 2 * Math.sqrt(PRESS_STIFFNESS) * 0.55;

let sharedDefs: SVGDefsElement | null = null;

function defs() {
  if (!sharedDefs) {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('width', '0');
    svg.setAttribute('height', '0');
    svg.setAttribute('aria-hidden', 'true');
    svg.style.position = 'absolute';
    sharedDefs = document.createElementNS(SVG_NS, 'defs');
    svg.append(sharedDefs);
    document.body.append(svg);
  }
  return sharedDefs;
}

// A convex bezel, like the edge of a lens: at the rim the glass shows what lies just OUTSIDE it,
// squeezed inward (that's why the glass layer reaches --lg-margin past the element — see global.css
// — so there is something out there to sample), easing off over the edge zone (half cosine: flat
// where it ends, so no kink and no terrace in a blurred backdrop).
//
// Horizontally the lens is two fixed-width strips pinned to the left and right ends
// (preserveAspectRatio xMin/xMax "meet" — the strip is exactly as tall as the filter box, so it
// renders at its own width whatever the element's width is) over a neutral flood. A single map
// stretched across the width bent the rims wrongly all the while the dock was folding and only
// looked right once rebuilt for the final width, which read as the side refraction arriving late.
// Vertically it's one full map (the height never changes in a fold) with a slight magnification
// through the middle.
function rimStops(margin: number, edgeZone: number, scale: number, side: 'start' | 'end'): [number, number][] {
  const span = margin + edgeZone;
  return Array.from({ length: MAP_SAMPLES + 1 }, (_, i) => {
    const p = (i / MAP_SAMPLES) * span;
    const fromEdge = (side === 'start' ? p : span - p) - margin;
    const rim = fromEdge <= 0 ? 1 : fromEdge >= edgeZone ? 0 : 0.5 * (1 + Math.cos((Math.PI * fromEdge) / edgeZone));
    const dx = (side === 'start' ? -1 : 1) * margin * rim;
    return [i / MAP_SAMPLES, 0.5 + dx / scale];
  });
}

function verticalStops(height: number, margin: number, edgeZone: number, magnify: number, scale: number): [number, number][] {
  const total = height + margin * 2;
  const slope = (magnify * 2) / height;
  return Array.from({ length: MAP_SAMPLES + 1 }, (_, i) => {
    const p = (i / MAP_SAMPLES) * total;
    const fromEdge = Math.min(p, total - p) - margin;
    const rim = fromEdge <= 0 ? 1 : fromEdge >= edgeZone ? 0 : 0.5 * (1 + Math.cos((Math.PI * fromEdge) / edgeZone));
    const dy = (p < total / 2 ? -1 : 1) * margin * rim - slope * (p - total / 2);
    return [i / MAP_SAMPLES, 0.5 + dy / scale];
  });
}

type Lens = { markup: string; margin: number; fullScale: number; height: number };

function buildLens(id: string, height: number): Lens {
  const margin = Math.round(Math.min(12, Math.max(6, height * 0.16)));
  const magnify = height * 0.04;
  const edgeZone = height * 0.45;
  const fullScale = 2 * (margin + magnify * 1.6);
  const boxHeight = Math.round(height + margin * 2);
  const strip = { width: Math.round(margin + edgeZone), height: boxHeight };
  const left = gradientMap('x', rimStops(margin, edgeZone, fullScale, 'start'), strip);
  const right = gradientMap('x', rimStops(margin, edgeZone, fullScale, 'end'), strip);
  const vertical = gradientMap('y', verticalStops(height, margin, edgeZone, magnify, fullScale), { width: 8, height: boxHeight });
  const markup =
    `<filter id="${id}" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">` +
    `<feFlood flood-color="rgb(128,0,0)" result="neutral"/>` +
    `<feImage href="${left}" preserveAspectRatio="xMinYMid meet" result="left"/>` +
    `<feImage href="${right}" preserveAspectRatio="xMaxYMid meet" result="right"/>` +
    `<feComposite in="left" in2="neutral" operator="over" result="withLeft"/>` +
    `<feComposite in="right" in2="withLeft" operator="over" result="mapX"/>` +
    `<feImage href="${vertical}" preserveAspectRatio="none" result="mapY"/>` +
    `<feComposite in="mapX" in2="mapY" operator="arithmetic" k2="1" k3="1" result="map"/>` +
    `<feDisplacementMap in="SourceGraphic" in2="map" scale="0" xChannelSelector="R" yChannelSelector="G"/>` +
    `</filter>`;
  return { markup, margin, fullScale, height };
}

// Phones that would drop frames under a live lens get the plain frost (which still follows the
// slider) — as do people who asked their system for less motion or transparency.
export function canAffordLens() {
  const media = (query: string) => window.matchMedia(query).matches;
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  return !(
    media('(prefers-reduced-motion: reduce)') ||
    media('(prefers-reduced-transparency: reduce)') ||
    (memory !== undefined && memory <= 4) ||
    navigator.hardwareConcurrency <= 4
  );
}

const easeOut = (t: number) => 1 - (1 - t) ** 3;

/**
 * Liquid Glass material for a floating surface carrying the global `liquid-glass` class (see
 * global.css): frost, then a convex lens over what's behind it. How much it bends follows the
 * Liquid Glass slider — none at "Berwarna" (plain frost), strongest at "Bening". Pressing it
 * (spread the returned handlers onto whatever the finger lands on) swells the glass and briefly
 * strengthens the lens. Only engines that render backdrop-filter: url(#...) get the lens;
 * elsewhere the data attributes set here are never matched by the gated CSS, and the press swell
 * still works.
 */
export function useLiquidRim(ref: RefObject<HTMLElement | null>, enabled = true, { grow = 0.08 } = {}) {
  const id = `lg-rim-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const glassTint = useSettingsStore((state) => state.glassTint);
  const strengthRef = useRef(1 - glassTint);
  const retargetRef = useRef<(() => void) | null>(null);
  const pressRef = useRef<((pressed: boolean) => void) | null>(null);

  useEffect(() => {
    strengthRef.current = 1 - glassTint;
    retargetRef.current?.();
  }, [glassTint]);

  useEffect(() => {
    const element = ref.current;
    if (!element || !enabled) return;
    const useLens = canAffordLens();
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let lens: Lens | null = null;
    let base = 0;
    let press = 0;
    let pressVelocity = 0;
    let pressTarget = 0;
    let pressRaf = 0;
    let lastPressFrame = 0;
    let scaleRaf = 0;
    let settleTimer = 0;

    const filter = () => document.getElementById(id);
    const target = () => (lens ? lens.fullScale * strengthRef.current : 0);

    // The lens actually applied: the slider's strength, pulled halfway toward full while pressed.
    const render = () => {
      if (!lens) return;
      const boost = Math.min(Math.max(press, 0), 1) * 0.5;
      const scale = base + (lens.fullScale - base) * boost;
      filter()?.querySelector('feDisplacementMap')?.setAttribute('scale', String(scale));
      // At zero the filter is an identity that still costs a full pass; switch it off instead.
      if (scale === 0) element.dataset.lensOff = '';
      else delete element.dataset.lensOff;
    };

    const tweenTo = (to: number, duration: number) => {
      cancelAnimationFrame(scaleRaf);
      const from = base;
      if (from === to) {
        render();
        return;
      }
      const start = performance.now();
      const step = (now: number) => {
        const t = Math.min((now - start) / duration, 1);
        base = t === 1 ? to : from + (to - from) * easeOut(t);
        render();
        if (t < 1) scaleRaf = requestAnimationFrame(step);
      };
      scaleRaf = requestAnimationFrame(step);
    };

    const install = () => {
      const height = element.offsetHeight;
      if (height < 1 || element.offsetWidth < 1) return;
      lens = buildLens(id, height);
      filter()?.remove();
      defs().insertAdjacentHTML('beforeend', lens.markup);
      element.style.setProperty('--lg-margin', `${lens.margin}px`);
      element.style.setProperty('--rim-filter', `url(#${id})`);
      element.dataset.rim = '';
      render();
    };

    // Rounded ends are round because the radius is ≥ half the height; clip at exactly that, so the
    // clip keeps matching the element while its width animates.
    const syncRadius = () => {
      const radius = parseFloat(getComputedStyle(element).borderTopLeftRadius) || 0;
      element.style.setProperty('--lg-radius', `${Math.min(radius, element.offsetHeight / 2)}px`);
    };

    // Width changes (the dock folding) need nothing: both rims are pinned strips. Only a new height
    // (rotation, desktop ↔ phone) calls for a new lens.
    const observer = new ResizeObserver(() => {
      if (!lens || Math.abs(element.offsetHeight - lens.height) < 1) return;
      window.clearTimeout(settleTimer);
      settleTimer = window.setTimeout(() => {
        install();
        syncRadius();
      }, SETTLE_DELAY_MS);
    });

    // Its own spring, written straight to the `scale` property (independent of `transform`, which
    // the dock already animates) — a CSS transition would fight the elements' own transitions.
    const pressStep = (now: number) => {
      const dt = Math.min((now - lastPressFrame) / 1000, 1 / 30);
      lastPressFrame = now;
      pressVelocity += (-PRESS_STIFFNESS * (press - pressTarget) - PRESS_DAMPING * pressVelocity) * dt;
      press += pressVelocity * dt;
      const settled = Math.abs(press - pressTarget) < 0.002 && Math.abs(pressVelocity) < 0.02;
      if (settled) {
        press = pressTarget;
        pressVelocity = 0;
      }
      element.style.scale = press === 0 ? '' : String(1 + grow * press);
      render();
      pressRaf = settled ? 0 : requestAnimationFrame(pressStep);
    };

    pressRef.current = (pressed) => {
      if (reducedMotion) return;
      pressTarget = pressed ? 1 : 0;
      if (!pressRaf) {
        lastPressFrame = performance.now();
        pressRaf = requestAnimationFrame(pressStep);
      }
    };

    retargetRef.current = () => tweenTo(target(), 200);

    if (useLens) {
      install();
      syncRadius();
      base = target();
      render();
      observer.observe(element);
    }

    return () => {
      observer.disconnect();
      cancelAnimationFrame(scaleRaf);
      cancelAnimationFrame(pressRaf);
      window.clearTimeout(settleTimer);
      retargetRef.current = null;
      pressRef.current = null;
      filter()?.remove();
      delete element.dataset.rim;
      delete element.dataset.lensOff;
      element.style.scale = '';
      for (const name of ['--rim-filter', '--lg-margin', '--lg-radius']) element.style.removeProperty(name);
    };
  }, [ref, enabled, id, grow]);

  return {
    onPointerDown: (event: PointerEvent<HTMLElement>) => {
      if (event.pointerType !== 'mouse' || event.button === 0) pressRef.current?.(true);
    },
    onPointerUp: () => pressRef.current?.(false),
    onPointerCancel: () => pressRef.current?.(false),
    onPointerLeave: () => pressRef.current?.(false),
  };
}
