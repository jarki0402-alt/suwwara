// Imports backend code (server/src) — see the note in tests/server/priorityLimiter.test.ts.
import { describe, expect, it } from 'vitest';
import { mergeLibraries } from '../../server/src/library/merge';

const song = (id: string, extra: Record<string, unknown> = {}) => ({ id, ...extra });

describe('mergeLibraries', () => {
  it('keeps songs and playlists from both sides', () => {
    const merged = mergeLibraries(
      { likedSongs: [song('a')], playlists: [{ id: 'p1', name: 'Gym' }] },
      { likedSongs: [song('b')], playlists: [{ id: 'p2', name: 'Kerja' }] },
    );
    expect(merged.likedSongs.map((s) => s.id)).toEqual(['a', 'b']);
    expect(merged.playlists.map((p) => p.id)).toEqual(['p1', 'p2']);
  });

  it('does not duplicate an item present on both sides, and prefers the first argument', () => {
    const merged = mergeLibraries(
      { likedSongs: [song('a', { from: 'phone' })], playlists: [{ id: 'p1', name: 'Phone version' }] },
      { likedSongs: [song('a', { from: 'laptop' })], playlists: [{ id: 'p1', name: 'Laptop version' }] },
    );
    expect(merged.likedSongs).toEqual([{ id: 'a', from: 'phone' }]);
    expect(merged.playlists).toEqual([{ id: 'p1', name: 'Phone version' }]);
  });

  it('handles an empty side', () => {
    const merged = mergeLibraries({ likedSongs: [], playlists: [] }, { likedSongs: [song('x')], playlists: [] });
    expect(merged.likedSongs.map((s) => s.id)).toEqual(['x']);
  });
});
