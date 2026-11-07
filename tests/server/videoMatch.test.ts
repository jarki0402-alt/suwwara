import { describe, expect, it } from 'vitest';
import { pickMusicVideo, shortlistVideoCandidates } from '../../server/src/youtube/videoMatch';

// Real YouTube Music video-search results (2026-11), trimmed to what the matcher reads.
describe('pickMusicVideo', () => {
  it('takes the official video from the same artist and marks a different cut as not synced', () => {
    const match = pickMusicVideo({ id: 'J7p4bzqLvCw', title: 'Blinding Lights', artist: 'The Weeknd', durationSec: 202 }, [
      { videoId: '4NRXx6U8ABQ', name: 'Blinding Lights (Official Video)', artist: 'The Weeknd', durationSec: 263 },
      { videoId: 'XwxLwG2_Sxk', name: 'The Weeknd - Blinding Lights (Lyrics)', artist: '7clouds', durationSec: 200 },
    ]);
    expect(match).toEqual({ videoId: '4NRXx6U8ABQ', durationSec: 263, synced: false });
  });

  it('marks a video of the same length as synced', () => {
    const match = pickMusicVideo({ id: 'c-8abSPAPOU', title: 'back to friends', artist: 'sombr', durationSec: 200 }, [
      { videoId: 'c8zq4kAn_O0', name: 'back to friends', artist: 'sombr', durationSec: 202 },
    ]);
    expect(match?.synced).toBe(true);
  });

  it('skips lyric, live and cover uploads, and other channels', () => {
    const song = { id: 'x', title: 'Multo', artist: 'Cup of Joe', durationSec: 238 };
    expect(
      pickMusicVideo(song, [
        { videoId: 'a', name: 'Cup of Joe - Multo (Lyrics)', artist: 'DopeNetwork', durationSec: 244 },
        { videoId: 'b', name: 'Cup of Joe performs "Multo" LIVE on Wish 107.5 Bus', artist: 'Wish 107.5', durationSec: 292 },
        { videoId: 'c', name: 'Multo (Live)', artist: 'Cup of Joe', durationSec: 250 },
        { videoId: 'd', name: 'Multo', artist: 'Cup of Joe', durationSec: 241 },
      ])?.videoId,
    ).toBe('d');
  });

  it('keeps a word the song title itself has (a song that is a remix)', () => {
    const match = pickMusicVideo({ id: 'x', title: 'Song (Remix)', artist: 'Artist', durationSec: 180 }, [
      { videoId: 'v', name: 'Song (Remix) [Official Video]', artist: 'ArtistVEVO', durationSec: 181 },
    ]);
    expect(match?.videoId).toBe('v');
  });

  it('rejects a compilation or a much shorter clip under the same title', () => {
    const song = { id: 'x', title: 'Song', artist: 'Artist', durationSec: 200 };
    expect(pickMusicVideo(song, [{ videoId: 'long', name: 'Song', artist: 'Artist', durationSec: 3600 }])).toBeNull();
    expect(pickMusicVideo(song, [{ videoId: 'short', name: 'Song', artist: 'Artist', durationSec: 60 }])).toBeNull();
  });

  it('treats the song being a video itself as synced', () => {
    const match = pickMusicVideo({ id: 'same', title: 'Song', artist: 'Artist', durationSec: 200 }, [{ videoId: 'same', name: 'Song', artist: 'Artist', durationSec: 200 }]);
    expect(match).toEqual({ videoId: 'same', durationSec: 200, synced: true });
  });

  it("passes over the song itself when it is a lyric channel's upload and takes the artist's official video", () => {
    // Real results for "double take dhruv" (2026-11): YouTube Music shows Dan Music's copy as "double take" by Dhruv.
    const match = pickMusicVideo({ id: 'IYOfGK5Zos4', title: 'double take', artist: 'dhruv', durationSec: 172 }, [
      { videoId: 'myh5xtfUG-I', name: 'double take', artist: 'Dhruv', durationSec: 172, uploadTitle: 'dhruv \u2013 double take (Lyrics)', channel: 'Dan Music' },
      { videoId: 'R8FHtIhWqNo', name: 'double take', artist: 'Dhruv', durationSec: 170, uploadTitle: 'Dhruv - double take (Official Video)', channel: 'Dhruv' },
      { videoId: 'LCUfekO9SZo', name: '\u300cNightcore\u300d double take - dhruv (Lyrics)', artist: 'Dhruv', durationSec: 154, uploadTitle: 'Nightcore double take - dhruv (Lyrics)', channel: 'Nightcore Venyx' },
    ]);
    expect(match).toEqual({ videoId: 'R8FHtIhWqNo', durationSec: 170, synced: true });
  });

  it('takes the VEVO official video over a disguised lyric copy and the official audio (Kill Bill)', () => {
    const song = { id: 'AdEKgwUqPKI', title: 'Kill Bill', artist: 'SZA', durationSec: 154 };
    const results = [
      { videoId: 'SQnc1QibapQ', name: 'Kill Bill (Official Audio)', artist: 'SZA', durationSec: 156, uploadTitle: 'SZA - Kill Bill (Official Audio)', channel: 'SZAVEVO' },
      { videoId: '7cxjLsjTRZE', name: 'Kill Bill - Sza | Lyrics', artist: "Pixel's Beat", durationSec: 156, uploadTitle: 'Kill Bill - Sza | Lyrics', channel: "Pixel's Beat" },
      { videoId: 'uP_iLS38Tdo', name: 'Kill Bill', artist: 'SZA', durationSec: 156, uploadTitle: '@sza - Kill Bill (Lyrics)', channel: 'Dan Music' },
      { videoId: 'CBx6e9cZlBQ', name: 'Snooze', artist: 'SZA', durationSec: 200 },
      { videoId: 'MSRcC626prw', name: 'Kill Bill (Official Video)', artist: 'SZA', durationSec: 276, uploadTitle: 'SZA - Kill Bill (Official Video)', channel: 'SZAVEVO' },
    ];
    expect(shortlistVideoCandidates(song, results).map((c) => c.videoId)).toEqual(['SQnc1QibapQ', '7cxjLsjTRZE', 'uP_iLS38Tdo', 'MSRcC626prw']);
    expect(pickMusicVideo(song, results)).toEqual({ videoId: 'MSRcC626prw', durationSec: 276, synced: false });
  });

  it("takes an official video from the artist's label channel (K-pop), and an official performance video", () => {
    // YouTube Music sent aespa's own MV with no name and no length: still shortlisted, judged on its real title.
    expect(shortlistVideoCandidates({ id: 'x', title: 'Supernova', artist: 'aespa', durationSec: 179 }, [{ videoId: 'mv', name: '', artist: 'aespa', durationSec: 0 }])).toHaveLength(1);
    expect(
      pickMusicVideo({ id: 'x', title: 'Supernova', artist: 'aespa', durationSec: 179 }, [
        { videoId: 'lyric', name: 'Supernova', artist: 'aespa', durationSec: 179, uploadTitle: 'aespa - Supernova (Color Coded Lyrics)', channel: 'Kpop Lyrics' },
        { videoId: 'mv', name: '', artist: 'aespa', durationSec: 0, uploadTitle: "aespa \uc5d0\uc2a4\ud30c 'Supernova' MV", channel: 'SMTOWN' },
      ])?.videoId,
    ).toBe('mv');
    expect(
      pickMusicVideo({ id: 'x', title: 'Song', artist: 'Artist', durationSec: 200 }, [
        { videoId: 'live', name: 'Song', artist: 'Artist', durationSec: 210, uploadTitle: 'Artist - Song (Live Performance)', channel: 'Artist' },
        { videoId: 'perf', name: 'Song', artist: 'Artist', durationSec: 201, uploadTitle: 'Artist - Song (Official Performance Video)', channel: 'Artist' },
      ])?.videoId,
    ).toBe('perf');
  });

  it("prefers an upload titled as the video over the artist's plain-titled one", () => {
    expect(
      pickMusicVideo({ id: 'x', title: 'Song', artist: 'Artist', durationSec: 200 }, [
        { videoId: 'plain', name: 'Song', artist: 'Artist', durationSec: 200, uploadTitle: 'Song', channel: 'Artist - Topic' },
        { videoId: 'mv', name: 'Song', artist: 'Artist', durationSec: 230, uploadTitle: 'Artist - Song (Official Music Video)', channel: 'ArtistVEVO' },
      ])?.videoId,
    ).toBe('mv');
  });
});
