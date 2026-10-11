import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Song } from '../../src/api/types';
import * as similarApi from '../../src/api/endpoints/similar';
import * as historyLog from '../../src/recommendation/historyLog';
import { buildRadioQueue } from '../../src/playback/playSongRadio';

function mockSong(id: string, name: string, artistName = 'Artist'): Song {
  const artist = {
    id: `art-${id}`,
    name: artistName,
    role: 'Primary',
    image: [],
    url: '',
  };
  return {
    id,
    name,
    duration: 180,
    album: { id: 'alb', name: 'Album', url: '' },
    year: '2024',
    language: 'id',
    hasLyrics: false,
    lyricsId: null,
    artists: {
      primary: [artist],
      featured: [],
      all: [artist],
    },
    image: [{ quality: '500x500', url: 'http://thumb' }],
  };
}

describe('buildRadioQueue', () => {
  const seedSong = mockSong('seed-1', 'Galau Slow Song', 'Slow Artist');

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(historyLog, 'loadHistory').mockReturnValue([]);
    vi.spyOn(historyLog, 'recentlyPlayedIds').mockReturnValue(new Set());
  });

  it('anchors recommendations to the seed song and preserves ranking order', async () => {
    const candidates = [
      mockSong('c-1', 'Slow Similar 1'),
      mockSong('c-2', 'Slow Similar 2'),
      mockSong('c-3', 'Slow Similar 3'),
    ];
    const getSimilarSpy = vi.spyOn(similarApi, 'getSimilarSongs').mockResolvedValue(candidates);

    const result = await buildRadioQueue(seedSong);

    expect(getSimilarSpy).toHaveBeenCalledWith('seed-1', 25);
    expect(result.map((s) => s.id)).toEqual(['c-1', 'c-2', 'c-3']);
  });

  it('filters out the seed song, excludeIds, and cooldownIds', async () => {
    const candidates = [
      mockSong('seed-1', 'Galau Slow Song'), // Seed song itself
      mockSong('c-1', 'Slow Similar 1'),     // Kept
      mockSong('c-exclude', 'Excluded Song'), // In excludeIds
      mockSong('c-cooldown', 'Cooldown Song'), // In cooldown
      mockSong('c-2', 'Slow Similar 2'),     // Kept
    ];
    vi.spyOn(similarApi, 'getSimilarSongs').mockResolvedValue(candidates);
    vi.spyOn(historyLog, 'recentlyPlayedIds').mockReturnValue(new Set(['c-cooldown']));

    const result = await buildRadioQueue(seedSong, new Set(['c-exclude']));

    expect(result.map((s) => s.id)).toEqual(['c-1', 'c-2']);
  });

  it('gracefully recovers cooldown tracks if cooldown would leave the queue completely empty', async () => {
    const candidates = [
      mockSong('c-1', 'Slow 1'),
      mockSong('c-2', 'Slow 2'),
    ];
    vi.spyOn(similarApi, 'getSimilarSongs').mockResolvedValue(candidates);
    // All candidates are in cooldown:
    vi.spyOn(historyLog, 'recentlyPlayedIds').mockReturnValue(new Set(['c-1', 'c-2']));

    const result = await buildRadioQueue(seedSong);

    // Should recover c-1 and c-2 rather than returning empty []
    expect(result.map((s) => s.id)).toEqual(['c-1', 'c-2']);
  });

  it('tops up using the top candidate from the same session if candidate count is low', async () => {
    const primary = [mockSong('p-1', 'Primary 1')];
    const topup = [mockSong('t-1', 'Topup 1'), mockSong('t-2', 'Topup 2')];

    vi.spyOn(similarApi, 'getSimilarSongs').mockImplementation(async (id) => {
      if (id === 'seed-1') return primary;
      if (id === 'p-1') return topup;
      return [];
    });

    const result = await buildRadioQueue(seedSong);

    expect(result.map((s) => s.id)).toEqual(['p-1', 't-1', 't-2']);
  });

  it('handles network failure gracefully by returning an empty array without throwing', async () => {
    vi.spyOn(similarApi, 'getSimilarSongs').mockRejectedValue(new Error('Network down'));

    const result = await buildRadioQueue(seedSong);

    expect(result).toEqual([]);
  });
});
