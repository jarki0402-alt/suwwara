import { useCallback } from 'react';

type IdleWindow = Window & {
  requestIdleCallback?: (callback: IdleRequestCallback, options?: IdleRequestOptions) => number;
  cancelIdleCallback?: (handle: number) => void;
};

/**
 * Returns a scheduler that runs work only when the main thread is genuinely
 * idle, deferring automatically if the user is mid-scroll/interaction — this
 * is what keeps the recommendation engine's recompute invisible to the UI.
 * Falls back to setTimeout on Safari, which has no requestIdleCallback.
 */
export function useIdleCallback(): (callback: () => void, timeoutMs?: number) => () => void {
  return useCallback((callback: () => void, timeoutMs = 2000) => {
    const idleWindow = window as IdleWindow;
    if (typeof idleWindow.requestIdleCallback === 'function') {
      const handle = idleWindow.requestIdleCallback(() => callback(), { timeout: timeoutMs });
      return () => idleWindow.cancelIdleCallback?.(handle);
    }
    const timeoutId = setTimeout(callback, 200);
    return () => clearTimeout(timeoutId);
  }, []);
}
