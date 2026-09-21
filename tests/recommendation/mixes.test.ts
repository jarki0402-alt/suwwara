import { describe, expect, it } from 'vitest';
import { dayKey } from '../../src/recommendation/dailyDiscovery';
import type { PlayEvent } from '../../src/recommendation/historyLog';
import { rankByPlays } from '../../src/recommendation/onRepeat';

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-09-21T12:00:00').getTime();
const play = (songId: string, ageMs: number): PlayEvent => ({ songId, artistIds: [], timestamp: NOW - ageMs, completed: true });

describe('rankByPlays (Sering Kamu Putar)', () => {
  it('puts the most-played song first', () => {
    const history = [play('a', DAY), play('b', 2 * DAY), play('b', 3 * DAY), play('b', 4 * DAY), play('c', DAY), play('c', 2 * DAY)];
    expect(rankByPlays(history, NOW)).toEqual(['b', 'c', 'a']);
  });

  it('breaks a tie with the more recent play', () => {
    expect(rankByPlays([play('old', 5 * DAY), play('new', DAY)], NOW)).toEqual(['new', 'old']);
  });

  it('ignores plays older than 30 days and respects the size cap', () => {
    expect(rankByPlays([play('ancient', 31 * DAY), play('recent', DAY)], NOW)).toEqual(['recent']);
    expect(rankByPlays([play('a', DAY), play('b', DAY), play('c', DAY)], NOW, 2)).toHaveLength(2);
  });
});

describe('dayKey (Temuan Harian)', () => {
  it('is the local calendar day, zero-padded, and changes at midnight', () => {
    expect(dayKey(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
    expect(dayKey(new Date(2026, 0, 6, 0, 0))).toBe('2026-01-06');
  });
});
