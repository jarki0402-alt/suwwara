import { describe, expect, it } from 'vitest';
import type { Song } from '../../src/api/types';
import { collectionMeta } from '../../src/utils/collectionMeta';

const songs = (...durations: number[]) => durations.map((duration) => ({ duration }) as Song);

describe('collectionMeta', () => {
  it('counts songs and rounds the total to minutes', () => {
    expect(collectionMeta(songs(200, 200, 200))).toBe('3 lagu · 10 mnt');
  });
  it('switches to hours from 60 minutes', () => {
    expect(collectionMeta(songs(3600, 1800))).toBe('2 lagu · 1 j 30 mnt');
  });
  it('leaves the duration out when there are no songs or no durations', () => {
    expect(collectionMeta([])).toBe('0 lagu');
    expect(collectionMeta(songs(0))).toBe('1 lagu');
  });
});
