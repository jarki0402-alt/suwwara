import { describe, expect, it } from 'vitest';
import {
  artistVariants,
  artistsOverlap,
  evaluateCandidates,
  mergeFound,
  NOTHING,
  plainFromLrc,
  stripDecorations,
  stripFeaturedArtist,
  titleVariants,
  titlesMatch,
  type LrcCandidate,
} from '../../server/src/youtube/lyricsMatch';

const candidate = (over: Partial<LrcCandidate>): LrcCandidate => ({
  trackName: 'Sial',
  artistName: 'Mahalini',
  duration: 244,
  instrumental: false,
  syncedLyrics: '[00:01.00]a\n[00:05.00]b',
  plainLyrics: 'a\nb',
  ...over,
});

const wanted = { title: 'Sial', artist: 'Mahalini', durationSec: 244 };

describe('stripFeaturedArtist', () => {
  it('strips a parenthesized, bracketed or bare feat credit, case-insensitively', () => {
    expect(stripFeaturedArtist('Calon Mantu Idaman (feat. Ncum)')).toBe('Calon Mantu Idaman');
    expect(stripFeaturedArtist('Song Title [ft. Someone]')).toBe('Song Title');
    expect(stripFeaturedArtist('Song Title featuring Someone Else')).toBe('Song Title');
    expect(stripFeaturedArtist('Song Title (FEAT. Someone)')).toBe('Song Title');
  });

  it('leaves other titles alone, including words that merely contain "feat"', () => {
    expect(stripFeaturedArtist('Plain Song Title')).toBe('Plain Song Title');
    expect(stripFeaturedArtist('Defeated')).toBe('Defeated');
  });
});

describe('stripDecorations', () => {
  it('removes trailing version/soundtrack decoration', () => {
    expect(stripDecorations('Bernaung (From "Setetes Embun Cinta Niyala")')).toBe('Bernaung');
    expect(stripDecorations('Sunflower (Spider-Man: Into the Spider-Verse)')).toBe('Sunflower');
    expect(stripDecorations('Bohemian Rhapsody (Remastered 2011)')).toBe('Bohemian Rhapsody');
    expect(stripDecorations('Yellow - Live')).toBe('Yellow');
    expect(stripDecorations('Song - Remastered 2011')).toBe('Song');
    expect(stripDecorations('Song (Live) [feat. X]')).toBe('Song');
  });

  it('keeps brackets that are part of the title or change what is sung', () => {
    expect(stripDecorations('Song (Part 2)')).toBe('Song (Part 2)');
    expect(stripDecorations('Song (Instrumental)')).toBe('Song (Instrumental)');
    expect(stripDecorations('Song (Karaoke Version)')).toBe('Song (Karaoke Version)');
  });

  it('never strips a title down to nothing, and leaves hyphenated names alone', () => {
    expect(stripDecorations('(Live)')).toBe('(Live)');
    expect(stripDecorations('Hati-Hati di Jalan')).toBe('Hati-Hati di Jalan');
  });
});

describe('titleVariants', () => {
  it('lists the raw title first, then plainer ones, without duplicates', () => {
    expect(titleVariants('Song (Live) (feat. X)')).toEqual(['Song (Live) (feat. X)', 'Song (Live)', 'Song']);
    expect(titleVariants('Plain')).toEqual(['Plain']);
  });
});

describe('artists', () => {
  it('offers the lead artist of a multi-artist credit', () => {
    expect(artistVariants('NIRWANA COMEBACK x ADINDA RAHMA')).toEqual(['NIRWANA COMEBACK x ADINDA RAHMA', 'NIRWANA COMEBACK']);
    expect(artistVariants('A, B')).toEqual(['A, B', 'A']);
    expect(artistVariants('Dewa 19')).toEqual(['Dewa 19']);
  });

  it('matches artists that share a word, accents and case aside', () => {
    expect(artistsOverlap('Nissa Sabyan', 'Sabyan')).toBe(true);
    expect(artistsOverlap('ROSÉ', 'Rose')).toBe(true);
    expect(artistsOverlap('Tulus', 'Mahalini')).toBe(false);
  });

  it('compares titles ignoring decoration and punctuation', () => {
    expect(titlesMatch('APT.', 'apt')).toBe(true);
    expect(titlesMatch('Sial (Remix Version)', 'Sial')).toBe(true);
    expect(titlesMatch('Sial', 'Sialan')).toBe(false);
  });
});

describe('plainFromLrc', () => {
  it('drops timestamps and metadata tags', () => {
    expect(plainFromLrc('[ar:X]\n[00:01.00]Hello\n[00:05.50]World')).toBe('Hello\nWorld');
  });
});

describe('evaluateCandidates', () => {
  it('takes synced lyrics whose duration is within tolerance, the closest first', () => {
    const found = evaluateCandidates(
      [candidate({ duration: 246, syncedLyrics: '[00:01.00]far' }), candidate({ duration: 244.5, syncedLyrics: '[00:01.00]near' })],
      wanted,
    );
    expect(found.synced?.lrc).toBe('[00:01.00]near');
  });

  it('refuses synced lyrics from a recording of a different length, but keeps their words as plain text', () => {
    const found = evaluateCandidates([candidate({ duration: 300, plainLyrics: null })], wanted);
    expect(found.synced).toBeNull();
    expect(found.plain?.text).toBe('a\nb');
  });

  it('ignores candidates for a different song or artist', () => {
    expect(evaluateCandidates([candidate({ trackName: 'Sialan' })], wanted)).toEqual(NOTHING);
    expect(evaluateCandidates([candidate({ artistName: 'Someone Else' })], wanted)).toEqual(NOTHING);
  });

  it('reports instrumental only for a matching candidate', () => {
    const found = evaluateCandidates([candidate({ instrumental: true, syncedLyrics: null, plainLyrics: null })], wanted);
    expect(found.instrumental).toBe(true);
    expect(found.synced).toBeNull();
  });
});

describe('mergeFound', () => {
  it('keeps the nearer-duration synced finding and any plain one', () => {
    const near = evaluateCandidates([candidate({ duration: 244, syncedLyrics: '[00:01.00]near' })], wanted);
    const far = evaluateCandidates([candidate({ duration: 246, syncedLyrics: '[00:01.00]far' })], wanted);
    expect(mergeFound(far, near, wanted).synced?.lrc).toBe('[00:01.00]near');
    expect(mergeFound(NOTHING, far, wanted).plain).not.toBeNull();
  });
});
