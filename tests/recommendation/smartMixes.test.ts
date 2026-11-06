import { describe, expect, it } from 'vitest';
import type { Song } from '../../src/api/types';
import { interleaveUnique, partOfDay, songsPlayedAt } from '../../src/recommendation/smartMixes';
import { coverLines } from '../../src/views/home/mixCatalog';

const song = (id: string, duration = 200): Song => ({ id, name: id, duration, image: [], artists: { primary: [] } }) as unknown as Song;
const at = (hour: number, daysAgo = 1) => {
  const date = new Date('2026-11-06T00:00:00');
  date.setDate(date.getDate() - daysAgo);
  date.setHours(hour, 0, 0, 0);
  return date.getTime();
};

describe('smart mixes', () => {
  it('splits the day the way the greeting does', () => {
    expect([3, 4, 10, 11, 14, 15, 17, 18, 23].map(partOfDay)).toEqual(['malam', 'pagi', 'pagi', 'siang', 'siang', 'sore', 'sore', 'malam', 'malam']);
  });

  it('picks the songs played at this time of day, most played first, within 60 days', () => {
    const now = new Date('2026-11-06T21:00:00').getTime();
    const history = [
      { songId: 'night-a', artistIds: [], timestamp: at(22), completed: true },
      { songId: 'night-b', artistIds: [], timestamp: at(20), completed: true },
      { songId: 'night-b', artistIds: [], timestamp: at(23, 2), completed: true },
      { songId: 'morning', artistIds: [], timestamp: at(8), completed: true },
      { songId: 'old-night', artistIds: [], timestamp: at(22, 90), completed: true },
    ];
    expect(songsPlayedAt(history, 'malam', now)).toEqual(['night-b', 'night-a']);
  });

  it('interleaves sources without repeats and skips snippets and hour-long compilations', () => {
    const merged = interleaveUnique([[song('a'), song('b'), song('c')], [song('b'), song('x', 30), song('d'), song('long', 3600)]], 10);
    expect(merged.map((item) => item.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('caps the mix', () => {
    expect(interleaveUnique([[song('a'), song('b'), song('c')]], 2)).toHaveLength(2);
  });

  it('writes a mix name on two cover lines', () => {
    expect(coverLines('Mix Malam Ini')).toEqual(['Mix', 'Malam Ini']);
    expect(coverLines('Radio Tulus')).toEqual(['Radio', 'Tulus']);
  });
});
