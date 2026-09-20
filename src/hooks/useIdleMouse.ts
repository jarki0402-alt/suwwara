import { useEffect, useRef, useState } from 'react';

/**
 * True once `timeoutMs` has passed with no mouse movement/keypress — used by
 * fullscreen Now Playing (NowPlayingView.tsx) to fade its chrome (top bar,
 * transport bar) out, leaving just the ambient background + lyrics, the same
 * auto-hide pattern video players (YouTube fullscreen, etc.) use. Listeners
 * are only attached while `active` is true, so this costs nothing outside
 * fullscreen mode — the rest of the app never pays for a global mousemove
 * listener it doesn't need.
 */
export function useIdleMouse(active: boolean, timeoutMs = 2500): boolean {
  const [isIdle, setIsIdle] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!active) {
      setIsIdle(false);
      return;
    }

    const resetTimer = () => {
      setIsIdle(false);
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setIsIdle(true), timeoutMs);
    };

    resetTimer();
    window.addEventListener('mousemove', resetTimer);
    window.addEventListener('keydown', resetTimer);
    window.addEventListener('touchstart', resetTimer);

    return () => {
      window.removeEventListener('mousemove', resetTimer);
      window.removeEventListener('keydown', resetTimer);
      window.removeEventListener('touchstart', resetTimer);
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    };
  }, [active, timeoutMs]);

  return isIdle;
}
