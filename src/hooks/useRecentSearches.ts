import { useCallback, useState } from 'react';

const STORAGE_KEY = 'suwwara-recent-searches';
const MAX_ITEMS = 8;

function load(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

function save(items: string[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    // storage unavailable/full — recent searches just won't persist this session
  }
}

/** The user's own search history, kept entirely client-side (never sent to the
 * backend) — distinct from getSearchSuggestions, which is YT Music's autocomplete. */
export function useRecentSearches() {
  const [items, setItems] = useState<string[]>(() => load());

  const add = useCallback((term: string) => {
    const trimmed = term.trim();
    if (trimmed.length === 0) return;
    setItems((current) => {
      const deduped = [trimmed, ...current.filter((item) => item.toLowerCase() !== trimmed.toLowerCase())].slice(0, MAX_ITEMS);
      save(deduped);
      return deduped;
    });
  }, []);

  const remove = useCallback((term: string) => {
    setItems((current) => {
      const next = current.filter((item) => item !== term);
      save(next);
      return next;
    });
  }, []);

  const clear = useCallback(() => {
    setItems([]);
    save([]);
  }, []);

  return { items, add, remove, clear };
}
