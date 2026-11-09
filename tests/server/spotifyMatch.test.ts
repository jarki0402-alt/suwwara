import { describe, expect, it } from 'vitest';
import { coreTitle, pickBest, scoreCandidate, searchQueries, versionWords } from '../../server/src/importer/spotifyMatch';

// Candidates as YT Music's song search returned them for a real Exportify export (2026-11).
describe('Spotify -> YT Music matching', () => {
  it('matches the same recording with Spotify suffixes and featured artists', () => {
    const scored = scoreCandidate(
      { name: 'Dusk Till Dawn (feat. Sia) - Radio Edit', artists: ['ZAYN', 'Sia'], durationSec: 239 },
      { id: 'j-0kLu3O7qU', title: 'Dusk Till Dawn (Radio Edit) (feat. Sia)', artist: 'ZAYN', durationSec: 239 },
    );
    expect(scored.verdict).toBe('yakin');
  });

  it("keeps Taylor's Version and the original apart even though they are the same length", () => {
    const track = { name: 'You Belong With Me', artists: ['Taylor Swift'], durationSec: 231 };
    const best = pickBest(track, [
      { id: 'uD8d1KrDQcY', title: 'You Belong With Me (Taylor’s Version)', artist: 'Taylor Swift', durationSec: 232 },
      { id: 'LYyUr75fs_o', title: 'You Belong With Me', artist: 'Taylor Swift', durationSec: 232 },
    ]);
    expect(best?.candidate.id).toBe('LYyUr75fs_o');
    expect(best?.verdict).toBe('yakin');
  });

  it('keeps a sped-up edit sped up and never picks a ukulele cover for the original', () => {
    expect(
      scoreCandidate(
        { name: 'Nevada - Sped Up', artists: ['Vicetone', 'Cozi Zuehlsdorff'], durationSec: 185 },
        { id: 'K4rX1pqBnik', title: 'Nevada (Sped Up) (feat. Cozi Zuehlsdorff)', artist: 'Vicetone', durationSec: 185 },
      ).verdict,
    ).toBe('yakin');
    expect(
      scoreCandidate(
        { name: 'Lemonade', artists: ['Jeremy Passion'], durationSec: 184 },
        { id: 'Vd9_kJkGcGs', title: 'Lemonade (Ukulele Version)', artist: 'Jeremy Passion', durationSec: 182 },
      ).verdict,
    ).not.toBe('yakin');
  });

  it('accepts any of the Spotify artists (YT Music names one)', () => {
    expect(
      scoreCandidate(
        { name: 'Starving', artists: ['Hailee Steinfeld', 'Grey', 'Zedd'], durationSec: 182 },
        { id: 'tUUoS_j3wWw', title: 'Starving (feat. Zedd)', artist: 'Hailee Steinfeld', durationSec: 182 },
      ).verdict,
    ).toBe('yakin');
  });

  it('calls a different edit of the right song doubtful, not confident', () => {
    expect(
      scoreCandidate(
        { name: 'A Sky Full of Stars', artists: ['Coldplay'], durationSec: 236 },
        { id: 'KWuyx6yZ21U', title: 'A Sky Full of Stars', artist: 'Coldplay', durationSec: 268 },
      ).verdict,
    ).toBe('ragu');
  });

  it('rejects an unrelated song', () => {
    expect(
      scoreCandidate(
        { name: 'Wood', artists: ['Taylor Swift'], durationSec: 151 },
        { id: 'x', title: 'Norwegian Wood', artist: 'The Beatles', durationSec: 125 },
      ).verdict,
    ).toBe('none');
  });

  it('needs the exact title when the artist does not match', () => {
    expect(
      scoreCandidate(
        { name: '12:45 - Stripped', artists: ['Etham'], durationSec: 179 },
        { id: 'x', title: 'DJ ETHAM 12.45 FULL JJ KANE', artist: 'SENSEI ALFIAN', durationSec: 181 },
      ).verdict,
    ).toBe('none');
    expect(
      scoreCandidate(
        { name: 'Before spring ends（在春天消失之前）', artists: ['Wang OK', '李天责'], durationSec: 178 },
        { id: 'y', title: 'Before spring ends', artist: '王OK', durationSec: 179 },
      ).verdict,
    ).toBe('ragu');
  });

  it('builds the queries from the main artist and the bare title', () => {
    expect(searchQueries({ name: 'Pretty Girl - Cheat Codes X CADE Remix', artists: ['Maggie Lindemann', 'Cheat Codes'], durationSec: 194 })[0]).toBe(
      'Maggie Lindemann Pretty Girl remix',
    );
    expect(coreTitle('Let It Go - From "Frozen"/Soundtrack Version')).toBe('let it go');
    expect(versionWords("Mr. Perfectly Fine (Taylor’s Version) (From The Vault)")).toEqual(['taylor s version', 'from the vault']);
  });
});
