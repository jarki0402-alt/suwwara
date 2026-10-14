import { useSyncExternalStore } from 'react';
import { useSettingsStore, type GlassMode, type GlassTier } from '../stores/settingsStore';

/*
 * How much of the Liquid Glass material a device draws:
 *   full — frost + the SVG lens (refraction, rainbow rim). Chromium only.
 *   lite — frost + painted rim light/fringe, no SVG filter. What Apple WebKit always gets.
 *   off  — near-opaque fill, no backdrop filter at all.
 * The cost was measured, not guessed: the lens is cheap while the glass sits still and expensive while its box
 * moves (the dock fold re-laid-out and re-filtered every frame — 8× the layouts of the same fold without it), and
 * a phone's core count says nothing about its GPU. So Otomatis starts from a cautious guess and then watches the
 * real glass animations, stepping down for good on this device once they keep missing frames.
 */

const TIERS: readonly GlassTier[] = ['off', 'lite', 'full'];
export const lowerTier = (a: GlassTier, b: GlassTier): GlassTier => TIERS[Math.min(TIERS.indexOf(a), TIERS.indexOf(b))];

export interface DeviceHints {
  reducedTransparency: boolean;
  reducedMotion: boolean;
  lensSupported: boolean;
  deviceMemory?: number;
  cores?: number;
}

/** Apple WebKit (every iOS browser) accepts backdrop-filter: url(#...) but renders it unreliably;
 *  -apple-system-body is a font keyword only Apple's WebKit accepts. */
export function supportsLens(): boolean {
  return typeof CSS !== 'undefined' && CSS.supports('backdrop-filter', 'url(#a)') && !CSS.supports('font', '-apple-system-body');
}

const media = (query: string) => typeof window !== 'undefined' && window.matchMedia(query).matches;

function readHints(): DeviceHints {
  const nav = navigator as Navigator & { deviceMemory?: number };
  return {
    reducedTransparency: media('(prefers-reduced-transparency: reduce)'),
    reducedMotion: media('(prefers-reduced-motion: reduce)'),
    lensSupported: supportsLens(),
    deviceMemory: nav.deviceMemory,
    cores: nav.hardwareConcurrency || undefined,
  };
}

/** Otomatis before anything has been measured. A ≤4GB phone starts at lite rather than paying for a janky first fold. */
export function guessTier(hints: DeviceHints): GlassTier {
  if (hints.reducedTransparency) return 'off';
  if (!hints.lensSupported || hints.reducedMotion) return 'lite';
  if ((hints.deviceMemory !== undefined && hints.deviceMemory <= 4) || (hints.cores !== undefined && hints.cores <= 4)) return 'lite';
  return 'full';
}

export function resolveTier(mode: GlassMode, measured: GlassTier | null, hints: DeviceHints): GlassTier {
  if (mode !== 'auto') return mode;
  const guess = guessTier(hints);
  return measured ? lowerTier(guess, measured) : guess;
}

export type FrameVerdict = 'smooth' | 'janky' | 'severe' | 'unknown';

// Shorter than this and there is too little to judge (a tap that barely lifted the pill).
const MIN_SAMPLE_MS = 200;
const SIXTY_HZ_MS = 1000 / 60;

/**
 * Judges one glass animation from its rAF intervals (ms), by the share of frames the display should have shown in
 * that time but didn't. Counting frames instead of judging each interval matters on the phones this is for: a fold
 * that crawls at 6fps leaves only four intervals behind, and every one of them is a real stall the user saw.
 */
export function judgeFrames(intervals: readonly number[]): FrameVerdict {
  const total = intervals.reduce((sum, gap) => sum + gap, 0);
  if (intervals.length < 2 || total < MIN_SAMPLE_MS) return 'unknown';
  const sorted = [...intervals].sort((a, b) => a - b);
  // The display's own frame time is the fastest the page managed (10th percentile, so one early callback doesn't
  // count). Capped at 60Hz: a phone that never reached 60fps during the animation must not set its own bar at 30.
  const refresh = Math.min(sorted[Math.floor(sorted.length * 0.1)], SIXTY_HZ_MS + 1);
  const dropped = 1 - intervals.length / (total / refresh);
  // 30fps on a 60Hz screen is half the frames gone — severe; one frame in five already reads as stutter.
  if (dropped >= 0.45) return 'severe';
  if (dropped >= 0.2) return 'janky';
  return 'smooth';
}

/** Whether recent verdicts call for stepping down from `tier`; null = stay. One busy moment (a list rendering
 *  during a fold) must not cost a device its glass, so it takes repeated misses — full needs 2 of the last 4,
 *  and going lite → off needs 3 of the last 5 to be severe. */
export function nextAutoTier(tier: GlassTier, verdicts: readonly FrameVerdict[]): GlassTier | null {
  const known = verdicts.filter((verdict) => verdict !== 'unknown');
  if (tier === 'full') {
    const recent = known.slice(-4);
    const bad = recent.filter((verdict) => verdict !== 'smooth').length;
    return bad >= 2 || (recent.length >= 2 && recent.at(-1) === 'severe') ? 'lite' : null;
  }
  if (tier === 'lite') {
    return known.slice(-5).filter((verdict) => verdict === 'severe').length >= 3 ? 'off' : null;
  }
  return null;
}

// --- device hints as an external store, so a system setting flipped while the app is open applies at once ---

let hints: DeviceHints | null = null;
const listeners = new Set<() => void>();
let detachMedia: (() => void) | null = null;

function getHints(): DeviceHints {
  hints ??= readHints();
  return hints;
}

function subscribeHints(listener: () => void) {
  listeners.add(listener);
  if (!detachMedia) {
    const queries = ['(prefers-reduced-transparency: reduce)', '(prefers-reduced-motion: reduce)'].map((query) => window.matchMedia(query));
    const onChange = () => {
      hints = readHints();
      listeners.forEach((notify) => notify());
    };
    queries.forEach((query) => query.addEventListener('change', onChange));
    detachMedia = () => queries.forEach((query) => query.removeEventListener('change', onChange));
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      detachMedia?.();
      detachMedia = null;
    }
  };
}

export function currentGlassTier(): GlassTier {
  const { glassMode, glassAutoTier } = useSettingsStore.getState();
  return resolveTier(glassMode, glassAutoTier, getHints());
}

export function useGlassTier(): GlassTier {
  const mode = useSettingsStore((state) => state.glassMode);
  const measured = useSettingsStore((state) => state.glassAutoTier);
  const deviceHints = useSyncExternalStore(subscribeHints, getHints, getHints);
  return resolveTier(mode, measured, deviceHints);
}

/** Whether this device draws the SVG lens right now. */
export function useLensEnabled(): boolean {
  return useGlassTier() === 'full' && getHints().lensSupported;
}

// --- watching real glass animations (Otomatis only) ---

const verdicts: FrameVerdict[] = [];
// The first seconds after launch are React mounting and images decoding — frames missed then say nothing about glass.
const WARMUP_MS = 4000;

/**
 * Call when a glass animation starts (pill travel, dock fold); call the returned function when it ends. Its own rAF
 * loop only runs for the animation's length, and nothing at all happens unless Otomatis is the chosen mode.
 */
export function watchGlassAnimation(): () => void {
  if (useSettingsStore.getState().glassMode !== 'auto' || performance.now() < WARMUP_MS) return () => {};
  const intervals: number[] = [];
  let last = 0;
  let raf = 0;
  // Frames stop while the tab is hidden; that gap is the user leaving, not the glass stalling.
  let wasHidden = document.hidden;
  const onVisibility = () => {
    wasHidden ||= document.hidden;
  };
  document.addEventListener('visibilitychange', onVisibility);
  // A tab switch also mounts the next view. On a slow CPU that JavaScript alone drops frames, glass or no glass, and
  // must not cost the device its glass — so a sample that overlapped a long main-thread task is not judged. The
  // glass's own cost is GPU work, which never shows up as a long task. (Safari has no longtask entries; there every
  // sample counts, and the lite → off bar is high.)
  let sawLongTask = false;
  let longTasks: PerformanceObserver | null = null;
  if (typeof PerformanceObserver !== 'undefined' && PerformanceObserver.supportedEntryTypes?.includes('longtask')) {
    longTasks = new PerformanceObserver((list) => {
      sawLongTask ||= list.getEntries().length > 0;
    });
    longTasks.observe({ type: 'longtask' });
  }
  const loop = (now: number) => {
    if (last) intervals.push(now - last);
    last = now;
    raf = requestAnimationFrame(loop);
  };
  raf = requestAnimationFrame(loop);
  let done = false;
  return () => {
    if (done) return;
    done = true;
    cancelAnimationFrame(raf);
    document.removeEventListener('visibilitychange', onVisibility);
    if (longTasks) {
      sawLongTask ||= longTasks.takeRecords().length > 0;
      longTasks.disconnect();
    }
    if (wasHidden || document.hidden || sawLongTask) return;
    verdicts.push(judgeFrames(intervals));
    if (verdicts.length > 8) verdicts.shift();
    const tier = currentGlassTier();
    const next = nextAutoTier(tier, verdicts);
    if (next) {
      verdicts.length = 0;
      useSettingsStore.getState().setGlassAutoTier(next);
    }
  };
}
