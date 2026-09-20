import { useSyncExternalStore } from 'react';

const DESKTOP_QUERY = '(min-width: 960px)';

/** True at the desktop breakpoint (the same 960px every stylesheet uses); follows a window resize. */
export function useIsDesktop(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const query = window.matchMedia(DESKTOP_QUERY);
      query.addEventListener('change', onChange);
      return () => query.removeEventListener('change', onChange);
    },
    () => window.matchMedia(DESKTOP_QUERY).matches,
    () => false,
  );
}
