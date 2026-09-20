import { useEffect, useState } from 'react';

export type Loaded<T> = { status: 'loading' } | { status: 'error' } | { status: 'ready'; data: T };

/** Runs `load` when `key` changes; ignores a result that arrives after the page has moved on. */
export function useLoaded<T>(key: string, load: () => Promise<T>): Loaded<T> {
  const [state, setState] = useState<{ key: string; value: Loaded<T> }>({ key, value: { status: 'loading' } });

  useEffect(() => {
    let cancelled = false;
    load()
      .then((data) => {
        if (!cancelled) setState({ key, value: { status: 'ready', data } });
      })
      .catch(() => {
        if (!cancelled) setState({ key, value: { status: 'error' } });
      });
    return () => {
      cancelled = true;
    };
    // `load` is a fresh closure each render; `key` is what identifies the request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // A result that belongs to the previous key is not this page's — show loading, not stale data.
  return state.key === key ? state.value : { status: 'loading' };
}
