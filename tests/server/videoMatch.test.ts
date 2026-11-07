import { describe, expect, it } from 'vitest';
import { pickMusicVideo } from '../../server/src/youtube/videoMatch';

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
    const match = pickMusicVideo({ id: 'danMusicId', title: 'double take', artist: 'dhruv', durationSec: 172 }, [
      { videoId: 'danMusicId', name: 'dhruv - double take (Lyrics)', artist: 'Dan Music', durationSec: 172 },
      { videoId: 'myh5xtfUG-I', name: 'double take', artist: 'Dhruv', durationSec: 172 },
    ]);
    expect(match).toEqual({ videoId: 'myh5xtfUG-I', durationSec: 172, synced: true });
  });
});
