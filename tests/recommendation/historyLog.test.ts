import { describe, expect, it } from 'vitest';
import type { PlayEvent } from '../../src/recommendation/historyLog';
import { recentlyPlayedIds } from '../../src/recommendation/historyLog';

function makeEvent(songId: string, timestamp: number): PlayEvent {
  return { songId, artistIds: [], timestamp, completed: true };
}

describe('recentlyPlayedIds', () => {
  const now = Date.now();
  const windowMs = 3 * 60 * 60 * 1000;

  it('includes songs played within the cooldown window', () => {
    const history = [makeEvent('a', now - 1000), makeEvent('b', now - windowMs + 1000)];
    const result = recentlyPlayedIds(windowMs, history);
    expect(result.has('a')).toBe(true);
    expect(result.has('b')).toBe(true);
  });

  it('excludes songs played before the cooldown window so they can resurface', () => {
    const history = [makeEvent('old', now - windowMs - 1000)];
    const result = recentlyPlayedIds(windowMs, history);
    expect(result.has('old')).toBe(false);
  });

  it('keeps the most recent event for a song replayed multiple times', () => {
    const history = [makeEvent('c', now - windowMs - 1000), makeEvent('c', now - 1000)];
    const result = recentlyPlayedIds(windowMs, history);
    expect(result.has('c')).toBe(true);
  });

  it('returns an empty set for empty history', () => {
    expect(recentlyPlayedIds(windowMs, []).size).toBe(0);
  });
});
