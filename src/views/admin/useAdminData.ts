import { useCallback, useEffect, useRef, useState } from 'react';

/** Loads something for a panel now and (optionally) every `refreshMs` while the tab is visible; `reload` for buttons; a changed `reloadKey` (say, the selected range) loads again. */
export function useAdminData<T>(load: () => Promise<T>, refreshMs?: number, reloadKey = ''): { data: T | null; error: string | null; reload: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const loadRef = useRef(load);
  // Keeps the latest loader without re-running the load effect every render; declared first so it is current when that effect runs.
  useEffect(() => {
    loadRef.current = load;
  });

  const reload = useCallback(() => {
    loadRef.current().then(
      (value) => {
        setData(value);
        setError(null);
      },
      (failure: unknown) => setError(failure instanceof Error ? failure.message : 'Gagal memuat.'),
    );
  }, []);

  useEffect(() => {
    reload();
    if (!refreshMs) return;
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') reload();
    }, refreshMs);
    return () => clearInterval(timer);
  }, [reload, refreshMs, reloadKey]);

  return { data, error, reload };
}
