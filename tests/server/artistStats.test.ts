// Imports backend code (server/src) — see the note in tests/server/priorityLimiter.test.ts.
import { describe, expect, it } from 'vitest';
import { parseCompactCount, readArtistStats, readTopSongsEndpoint } from '../../server/src/youtube/artistStats';

describe('parseCompactCount', () => {
  it('expands K / M / B suffixes', () => {
    expect(parseCompactCount('17.1M monthly audience')).toBe(17_100_000);
    expect(parseCompactCount('312M plays')).toBe(312_000_000);
    expect(parseCompactCount('1.2B plays')).toBe(1_200_000_000);
    expect(parseCompactCount('980K plays')).toBe(980_000);
    expect(parseCompactCount('4.14M')).toBe(4_140_000);
  });

  it('reads plain counts, with or without a thousands separator', () => {
    expect(parseCompactCount('523 plays')).toBe(523);
    expect(parseCompactCount('1,234 plays')).toBe(1234);
  });

  it('does not mistake the word "monthly" for the M suffix', () => {
    expect(parseCompactCount('5 monthly audience')).toBe(5);
  });

  it('refuses text it cannot read instead of guessing', () => {
    expect(parseCompactCount('')).toBeNull();
    expect(parseCompactCount('plays')).toBeNull();
    expect(parseCompactCount('17,1M audiens bulanan')).toBeNull();
  });
});

const runs = (text: string) => ({ runs: [{ text }] });
const song = (videoId: string, ...columns: string[]) => ({
  musicResponsiveListItemRenderer: {
    playlistItemData: { videoId },
    flexColumns: columns.map((text) => ({ musicResponsiveListItemFlexColumnRenderer: { text: runs(text) } })),
  },
});

describe('readArtistStats', () => {
  const response = {
    header: { musicImmersiveHeaderRenderer: { monthlyListenerCount: runs('17.1M monthly audience') } },
    contents: {
      singleColumnBrowseResultsRenderer: {
        tabs: [{ tabRenderer: { content: { sectionListRenderer: { contents: [
          { musicShelfRenderer: { contents: [song('aaa', 'Backburner', 'NIKI', '139M plays', 'Nicole'), song('bbb', 'Untitled', 'NIKI', 'Nicole')] } },
          { musicCarouselShelfRenderer: {} },
        ] } } } }],
      },
    },
  };

  it('reads monthly listeners and the play count of each top song that has one', () => {
    expect(readArtistStats(response)).toEqual({ monthlyListeners: 17_100_000, playCounts: { aaa: 139_000_000 } });
  });

  it('returns empty stats for anything unexpected instead of throwing', () => {
    expect(readArtistStats(null)).toEqual({ monthlyListeners: null, playCounts: {} });
    expect(readArtistStats({ header: 'nope', contents: [] })).toEqual({ monthlyListeners: null, playCounts: {} });
  });
});

describe('readTopSongsEndpoint', () => {
  it('reads the browseEndpoint from shelf bottomEndpoint', () => {
    const raw = {
      contents: {
        singleColumnBrowseResultsRenderer: {
          tabs: [{ tabRenderer: { content: { sectionListRenderer: { contents: [
            {
              musicShelfRenderer: {
                title: { runs: [{ text: 'Top songs' }] },
                bottomEndpoint: { browseEndpoint: { browseId: 'VLOLAK5uy_test', params: 'ggMCCAI%3D' } },
              },
            },
          ] } } } }],
        },
      },
    };
    expect(readTopSongsEndpoint(raw)).toEqual({ browseId: 'VLOLAK5uy_test', params: 'ggMCCAI%3D' });
  });

  it('reads the browseEndpoint from title navigationEndpoint as fallback', () => {
    const raw = {
      contents: {
        singleColumnBrowseResultsRenderer: {
          tabs: [{ tabRenderer: { content: { sectionListRenderer: { contents: [
            {
              musicShelfRenderer: {
                title: { runs: [{ text: 'Top songs', navigationEndpoint: { browseEndpoint: { browseId: 'VLOLAK5uy_title', params: 'abc' } } }] },
              },
            },
          ] } } } }],
        },
      },
    };
    expect(readTopSongsEndpoint(raw)).toEqual({ browseId: 'VLOLAK5uy_title', params: 'abc' });
  });

  it('returns null when no top songs shelf or endpoint is present', () => {
    expect(readTopSongsEndpoint(null)).toBeNull();
    expect(readTopSongsEndpoint({})).toBeNull();
  });
});

