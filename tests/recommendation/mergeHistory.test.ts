import { describe, expect, it } from 'vitest';
import { mergeHistory, type PlayEvent } from '../../src/recommendation/historyLog';

const event = (songId: string, timestamp: number): PlayEvent => ({ songId, artistIds: [], timestamp, completed: true });

describe('mergeHistory', () => {
  it('unions by song and time, oldest first, without duplicates', () => {
    expect(mergeHistory([event('a', 1), event('b', 2)], [event('b', 2), event('c', 3)], 0).map((e) => e.songId)).toEqual(['a', 'b', 'c']);
  });

  it('drops everything at or before the last clear', () => {
    expect(mergeHistory([event('old', 5)], [event('new', 20)], 10).map((e) => e.songId)).toEqual(['new']);
  });

  it('keeps the newest 300', () => {
    const many = Array.from({ length: 350 }, (_, i) => event(`s${i}`, i + 1));
    const merged = mergeHistory(many, [], 0);
    expect(merged).toHaveLength(300);
    expect(merged[0].timestamp).toBe(51);
  });
});
