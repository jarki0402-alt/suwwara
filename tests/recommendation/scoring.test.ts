import { describe, expect, it } from 'vitest';
import type { Song } from '../../src/api/types';
import type { PlayEvent } from '../../src/recommendation/historyLog';
import { computeArtistAffinity, recencyWeight, scoreCandidate } from '../../src/recommendation/scoring';

function makeSong(id: string, artistIds: string[]): Song {
  return {
    id,
    name: `Song ${id}`,
    duration: 200,
    album: null,
    year: null,
    language: '',
    hasLyrics: false,
    lyricsId: null,
    artists: {
      primary: artistIds.map((artistId) => ({ id: artistId, name: artistId, role: 'singer', image: [], url: '' })),
      featured: [],
      all: [],
    },
    image: [],
  };
}

describe('recencyWeight', () => {
  it('is close to 1 for an event that just happened and completed', () => {
    const now = Date.now();
    const event: PlayEvent = { songId: 's1', artistIds: ['a1'], timestamp: now, completed: true };
    expect(recencyWeight(event, now)).toBeCloseTo(1, 5);
  });

  it('decays to about half after one half-life (14 days), and applies the skip penalty', () => {
    const now = Date.now();
    const fourteenDaysAgo = now - 14 * 86_400_000;
    const completed: PlayEvent = { songId: 's1', artistIds: ['a1'], timestamp: fourteenDaysAgo, completed: true };
    const skippedNow: PlayEvent = { songId: 's1', artistIds: ['a1'], timestamp: now, completed: false };
    expect(recencyWeight(completed, now)).toBeCloseTo(0.5, 2);
    expect(recencyWeight(skippedNow, now)).toBeCloseTo(0.4, 5);
  });
});

describe('computeArtistAffinity', () => {
  it('normalizes so the most-played artist has affinity 1', () => {
    const now = Date.now();
    const history: PlayEvent[] = [
      { songId: 's1', artistIds: ['a1'], timestamp: now, completed: true },
      { songId: 's2', artistIds: ['a1'], timestamp: now, completed: true },
      { songId: 's3', artistIds: ['a2'], timestamp: now, completed: true },
    ];
    const affinity = computeArtistAffinity(history, now);
    expect(affinity.get('a1')).toBeCloseTo(1, 5);
    expect(affinity.get('a2')).toBeCloseTo(0.5, 5);
  });

  it('returns an empty map for empty history', () => {
    expect(computeArtistAffinity([], Date.now()).size).toBe(0);
  });
});

describe('scoreCandidate', () => {
  it('scores an unplayed song from a favorite artist above an unplayed song from an unknown artist', () => {
    const now = Date.now();
    const history: PlayEvent[] = [{ songId: 'played', artistIds: ['favorite'], timestamp: now, completed: true }];
    const affinity = computeArtistAffinity(history, now);

    const fromFavorite = makeSong('new1', ['favorite']);
    const fromUnknown = makeSong('new2', ['stranger']);

    expect(scoreCandidate(fromFavorite, history, affinity, now)).toBeGreaterThan(
      scoreCandidate(fromUnknown, history, affinity, now),
    );
    expect(scoreCandidate(fromUnknown, history, affinity, now)).toBe(0);
  });

  it('scores a frequently and recently played song higher than a rarely played one', () => {
    const now = Date.now();
    const history: PlayEvent[] = [
      { songId: 'frequent', artistIds: ['a1'], timestamp: now, completed: true },
      { songId: 'frequent', artistIds: ['a1'], timestamp: now, completed: true },
      { songId: 'frequent', artistIds: ['a1'], timestamp: now, completed: true },
      { songId: 'rare', artistIds: ['a1'], timestamp: now, completed: true },
    ];
    const affinity = computeArtistAffinity(history, now);
    const frequentSong = makeSong('frequent', ['a1']);
    const rareSong = makeSong('rare', ['a1']);

    expect(scoreCandidate(frequentSong, history, affinity, now)).toBeGreaterThan(
      scoreCandidate(rareSong, history, affinity, now),
    );
  });
});
