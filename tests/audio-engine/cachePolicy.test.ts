import { describe, expect, it } from 'vitest';
import { planEviction, type CacheLimits, type CacheRecord } from '../../src/audio-engine/cachePolicy';

const MB = 1024 * 1024;
const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 8, 21);
const record = (key: string, mb: number, daysAgo: number): CacheRecord => ({ key, size: mb * MB, timestamp: NOW - daysAgo * DAY });
const limits = (over: Partial<CacheLimits> = {}): CacheLimits => ({ maxBytes: 100 * MB, maxAgeMs: Infinity, maxEntries: 1000, ...over });

describe('planEviction', () => {
  it('keeps everything that fits', () => {
    expect(planEviction([record('a', 4, 1), record('b', 4, 2)], limits(), NOW)).toEqual([]);
  });

  it('drops the least recently played first until under the budget', () => {
    const records = [record('new', 40, 1), record('old', 40, 30), record('mid', 40, 10)];
    expect(planEviction(records, limits({ maxBytes: 100 * MB }), NOW)).toEqual(['old']);
    expect(planEviction(records, limits({ maxBytes: 50 * MB }), NOW).sort()).toEqual(['mid', 'old']);
  });

  it('drops tracks nobody played within the retention window, whatever the budget', () => {
    const records = [record('fresh', 4, 2), record('stale', 4, 40)];
    expect(planEviction(records, limits({ maxAgeMs: 30 * DAY }), NOW)).toEqual(['stale']);
  });

  it('never expires anything when retention is unlimited', () => {
    expect(planEviction([record('ancient', 4, 3650)], limits({ maxAgeMs: Infinity }), NOW)).toEqual([]);
  });

  it('never drops the newest track for the budget, even if it alone is over', () => {
    expect(planEviction([record('only', 150, 0)], limits({ maxBytes: 100 * MB }), NOW)).toEqual([]);
    expect(planEviction([record('big', 150, 0), record('older', 10, 5)], limits({ maxBytes: 100 * MB }), NOW)).toEqual(['older']);
  });

  it('applies the entry cap as well', () => {
    const records = [record('a', 1, 3), record('b', 1, 2), record('c', 1, 1)];
    expect(planEviction(records, limits({ maxEntries: 2 }), NOW)).toEqual(['a']);
  });

  it('does not count an expired track towards the budget', () => {
    const records = [record('stale', 90, 60), record('fresh', 60, 1)];
    expect(planEviction(records, limits({ maxBytes: 100 * MB, maxAgeMs: 30 * DAY }), NOW)).toEqual(['stale']);
  });
});
